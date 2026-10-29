use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    process::{Child, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

const CODEX_APP_SERVER_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_HISTORY_QUERIES: usize = 2;
const MAX_HISTORY_RESPONSE_BYTES: usize = 1024 * 1024;
// Keep the initial write within the empty pipe's capacity, even if the helper
// never reads stdin. This makes the response deadline effective on that path too.
const MAX_HISTORY_REQUEST_BYTES: usize = 2048;
static HISTORY_QUERIES: AtomicUsize = AtomicUsize::new(0);

struct HistoryQueryPermit;

impl HistoryQueryPermit {
    fn acquire() -> Result<Self, String> {
        HISTORY_QUERIES
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_HISTORY_QUERIES).then_some(count + 1)
            })
            .map(|_| Self)
            .map_err(|_| "历史会话查询繁忙，请稍后重试".to_string())
    }
}

impl Drop for HistoryQueryPermit {
    fn drop(&mut self) {
        HISTORY_QUERIES.fetch_sub(1, Ordering::AcqRel);
    }
}

// Own only this short-lived app-server invocation, never the user's shared
// Codex daemon. Keeping the child unreaped until cleanup also pins its PID.
struct HistoryProcess(Child);

impl Drop for HistoryProcess {
    fn drop(&mut self) {
        drop(self.0.stdin.take());
        terminate_history_process(&mut self.0);
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match self.0.try_wait() {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                Ok(None) => {
                    eprintln!("Codex history helper did not exit after termination");
                    break;
                }
            }
        }
    }
}

#[cfg(unix)]
fn configure_history_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_history_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(unix)]
fn terminate_history_process(child: &mut Child) {
    // Only our newly created group; detached shared daemons have their own group.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_history_process(child: &mut Child) {
    use std::os::windows::process::CommandExt;
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    // The Windows codex launcher may be a .cmd shim. Limit taskkill to this PID
    // and its descendants; never kill all processes named codex.
    if let Ok(mut killer) = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let deadline = Instant::now() + Duration::from_secs(1);
        while matches!(killer.try_wait(), Ok(None)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let _ = killer.kill();
        let _ = killer.try_wait();
    }
    let _ = child.kill();
}

#[cfg(unix)]
fn configure_history_output(stdout: &ChildStdout) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    let fd = stdout.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn configure_history_output(_: &ChildStdout) -> std::io::Result<()> {
    Ok(())
}

fn read_history_output(
    stdout: &mut ChildStdout,
    bytes: &mut [u8],
) -> std::io::Result<Option<usize>> {
    let readable;
    #[cfg(windows)]
    {
        use std::{ffi::c_void, os::windows::io::AsRawHandle};
        #[link(name = "kernel32")]
        extern "system" {
            fn PeekNamedPipe(
                handle: *mut c_void,
                buffer: *mut c_void,
                size: u32,
                read: *mut u32,
                available: *mut u32,
                left: *mut u32,
            ) -> i32;
        }
        let mut available = 0;
        let ok = unsafe {
            PeekNamedPipe(
                stdout.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(109) {
                Ok(Some(0))
            } else {
                Err(error)
            };
        }
        if available == 0 {
            return Ok(None);
        }
        readable = bytes.len().min(available as usize);
    }
    #[cfg(unix)]
    {
        readable = bytes.len();
    }
    match stdout.read(&mut bytes[..readable]) {
        Ok(size) => Ok(Some(size)),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
        Err(error) => Err(error),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSessionSummary {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) cwd: String,
    pub(crate) updated_at: u64,
}

pub(crate) fn list_codex_sessions(
    cwd: &str,
    limit: usize,
) -> Result<Vec<CodexSessionSummary>, String> {
    let _permit = HistoryQueryPermit::acquire()?;
    let mut command = codex_app_server_command();
    query_codex_sessions(&mut command, cwd, limit, CODEX_APP_SERVER_TIMEOUT)
}

fn query_codex_sessions(
    command: &mut Command,
    cwd: &str,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<CodexSessionSummary>, String> {
    configure_history_process(command);
    let mut child = HistoryProcess(
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("无法启动 Codex 会话服务：{error}"))?,
    );

    let mut stdout = child
        .0
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Codex 会话服务输出".to_string())?;
    configure_history_output(&stdout)
        .map_err(|error| format!("无法读取 Codex 会话服务输出：{error}"))?;

    let result = (|| {
        let stdin = child
            .0
            .stdin
            .as_mut()
            .ok_or_else(|| "无法连接 Codex 会话服务".to_string())?;
        let requests = [
            json!({
                "method": "initialize",
                "id": 0,
                "params": {
                    "clientInfo": {
                        "name": "code_terminal",
                        "title": "Code Terminal",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }),
            json!({ "method": "initialized", "params": {} }),
            json!({
                "method": "thread/list",
                "id": 1,
                "params": {
                    "archived": false,
                    "cwd": cwd,
                    "limit": limit.clamp(1, 50)
                }
            }),
        ];

        let request = requests
            .iter()
            .map(|request| format!("{request}\n"))
            .collect::<String>();
        if request.len() > MAX_HISTORY_REQUEST_BYTES {
            return Err("Codex 历史会话查询路径过长".into());
        }
        stdin
            .write_all(request.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("请求 Codex 历史会话失败：{error}"))?;

        let deadline = Instant::now() + timeout;
        let mut pending = Vec::new();
        let mut buffer = [0_u8; 8192];
        let mut received = 0;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("读取 Codex 历史会话超时".into());
            }

            let size = match read_history_output(&mut stdout, &mut buffer) {
                Ok(Some(0)) => return Err("Codex 会话服务提前退出".into()),
                Ok(Some(size)) => size,
                Ok(None) => {
                    thread::sleep(Duration::from_millis(10).min(remaining));
                    continue;
                }
                Err(error) => return Err(format!("读取 Codex 历史会话失败：{error}")),
            };
            received += size;
            if received > MAX_HISTORY_RESPONSE_BYTES {
                return Err("Codex 历史会话响应过大".into());
            }
            pending.extend_from_slice(&buffer[..size]);
            while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                let line = pending.drain(..=end).collect::<Vec<_>>();
                let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                    continue;
                };
                if message.get("id").and_then(Value::as_u64) != Some(1) {
                    continue;
                }

                if let Some(error) = message.get("error") {
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex 会话服务返回错误");
                    return Err(message.to_string());
                }

                let sessions = message
                    .pointer("/result/data")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(session_summary_from_value)
                            .take(limit)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                return Ok(sessions);
            }
        }
    })();

    drop(stdout);
    drop(child);
    result
}

fn session_summary_from_value(value: &Value) -> Option<CodexSessionSummary> {
    if !value
        .get("parentThreadId")
        .unwrap_or(&Value::Null)
        .is_null()
        || !value.get("agentRole").unwrap_or(&Value::Null).is_null()
    {
        return None;
    }

    let id = value.get("id")?.as_str()?.trim();
    let cwd = value.get("cwd")?.as_str()?.trim();
    if Uuid::parse_str(id).is_err() || cwd.is_empty() {
        return None;
    }

    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let preview = value
        .get("preview")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let title = normalize_title(if name.trim().is_empty() {
        preview
    } else {
        name
    });
    if title.is_empty() {
        return None;
    }

    Some(CodexSessionSummary {
        id: id.to_string(),
        title,
        cwd: cwd.to_string(),
        updated_at: value
            .get("recencyAt")
            .and_then(Value::as_u64)
            .or_else(|| value.get("updatedAt").and_then(Value::as_u64))
            .unwrap_or_default(),
    })
}

fn normalize_title(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(96).collect()
}

#[cfg(windows)]
fn codex_app_server_command() -> Command {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("cmd.exe");
    command
        .args(["/D", "/S", "/C", "codex app-server --stdio"])
        .creation_flags(0x08000000);
    command
}

#[cfg(not(windows))]
fn codex_app_server_command() -> Command {
    let mut command = Command::new("codex");
    command.args(["app-server", "--stdio"]);
    command
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_title, query_codex_sessions, session_summary_from_value, HistoryProcess,
        HistoryQueryPermit,
    };
    use serde_json::json;
    use std::{
        env, fs,
        io::{BufRead, Write},
        path::{Path, PathBuf},
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    fn fixture_command(mode: &str, marker: &Path) -> Command {
        let mut command = Command::new(env::current_exe().unwrap());
        let fixture_name = concat!(module_path!(), "::history_process_fixture")
            .split_once("::")
            .unwrap()
            .1;
        command.args([
            "--ignored",
            "--exact",
            fixture_name,
            "--nocapture",
            "--test-threads=1",
        ]);
        command
            .env("CODE_TERMINAL_HISTORY_FIXTURE", mode)
            .env("CODE_TERMINAL_HISTORY_MARKER", marker);
        command
    }

    #[test]
    #[ignore = "child process fixture; invoked only by lifecycle tests"]
    fn history_process_fixture() {
        let Ok(mode) = env::var("CODE_TERMINAL_HISTORY_FIXTURE") else {
            return;
        };
        let marker = PathBuf::from(env::var_os("CODE_TERMINAL_HISTORY_MARKER").unwrap());
        fs::write(&marker, std::process::id().to_string()).unwrap();
        if mode == "descendant" || mode == "no-stdin" {
            thread::sleep(Duration::from_secs(30));
            return;
        }
        let stdin = std::io::stdin();
        for _ in stdin.lock().lines().take(3) {}
        // Separate the JSON protocol from the Rust test harness's inline label.
        println!();
        match mode.as_str() {
            "success" => println!("{}", json!({"id":1,"result":{"data":[]}})),
            "error" => println!("{}", json!({"id":1,"error":{"message":"fixture rejected"}})),
            "oversized" => println!("{}", "x".repeat(super::MAX_HISTORY_RESPONSE_BYTES + 1)),
            "eof" => return,
            "tree" => {
                let child_marker = marker.with_extension("child");
                let _child = fixture_command("descendant", &child_marker)
                    .spawn()
                    .unwrap();
                let deadline = Instant::now() + Duration::from_secs(2);
                while !child_marker.exists() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                assert!(child_marker.exists());
                println!();
                println!("{}", json!({"id":1,"result":{"data":[]}}));
            }
            "timeout" => {}
            _ => panic!("unknown fixture"),
        }
        std::io::stdout().flush().unwrap();
        // Even successful helpers that ignore EOF must be terminated.
        thread::sleep(Duration::from_secs(30));
    }

    #[cfg(unix)]
    fn process_is_running(pid: u32) -> bool {
        if unsafe { libc::kill(pid as i32, 0) } != 0 {
            return false;
        }
        // A killed grandchild may be awaiting reaping by the container's init.
        #[cfg(target_os = "linux")]
        if let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status")) {
            if status
                .lines()
                .any(|line| line.starts_with("State:") && line.contains('Z'))
            {
                return false;
            }
        }
        true
    }

    #[cfg(windows)]
    fn process_is_running(pid: u32) -> bool {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn GetExitCodeProcess(handle: *mut c_void, exit: *mut u32) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        unsafe {
            let handle = OpenProcess(0x1000, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0;
            let running = GetExitCodeProcess(handle, &mut code) != 0 && code == 259;
            CloseHandle(handle);
            running
        }
    }

    #[test]
    fn history_helpers_exit_on_success_error_timeout_and_large_output() {
        let directory =
            env::temp_dir().join(format!("code-terminal-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let survivor_marker = directory.join("unrelated");
        let mut unrelated = fixture_command("descendant", &survivor_marker);
        super::configure_history_process(&mut unrelated);
        let survivor = HistoryProcess(unrelated.spawn().unwrap());
        for mode in [
            "success",
            "error",
            "timeout",
            "no-stdin",
            "oversized",
            "eof",
            "tree",
        ] {
            let marker = directory.join(mode);
            let mut command = fixture_command(mode, &marker);
            let started = Instant::now();
            let result =
                query_codex_sessions(&mut command, "/test", 12, Duration::from_millis(800));
            assert!(
                started.elapsed() < Duration::from_secs(4),
                "unbounded cleanup: {mode}"
            );
            if mode == "success" || mode == "tree" {
                assert!(result.is_ok(), "{mode}: {result:?}");
            } else {
                assert!(result.is_err(), "{mode}");
            }
            let pid = fs::read_to_string(&marker).unwrap().parse().unwrap();
            assert!(!process_is_running(pid), "helper leaked: {mode}");
            assert!(
                process_is_running(survivor.0.id()),
                "unrelated process was stopped"
            );
            if mode == "tree" {
                let child_pid = fs::read_to_string(marker.with_extension("child"))
                    .unwrap()
                    .parse()
                    .unwrap();
                let deadline = Instant::now() + Duration::from_secs(1);
                while process_is_running(child_pid) && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                assert!(!process_is_running(child_pid), "helper descendant leaked");
            }
        }
        drop(survivor);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn history_query_limit_is_released_on_drop() {
        let first = HistoryQueryPermit::acquire().unwrap();
        let second = HistoryQueryPermit::acquire().unwrap();
        assert!(HistoryQueryPermit::acquire().is_err());
        drop(first);
        assert!(HistoryQueryPermit::acquire().is_ok());
        drop(second);
    }

    #[test]
    fn normalizes_multiline_session_titles() {
        assert_eq!(normalize_title("  first\n  second  "), "first second");
    }

    #[test]
    fn maps_root_session_summary() {
        let session = session_summary_from_value(&json!({
            "id": "019ff945-339a-7f40-ab6b-cbbcf2138ecd",
            "cwd": "D:\\repo",
            "preview": "Improve the sidebar",
            "name": null,
            "parentThreadId": null,
            "agentRole": null,
            "updatedAt": 12,
            "recencyAt": 18
        }))
        .expect("session summary");

        assert_eq!(session.title, "Improve the sidebar");
        assert_eq!(session.updated_at, 18);
    }

    #[test]
    fn ignores_child_agent_sessions() {
        assert!(session_summary_from_value(&json!({
            "id": "child",
            "cwd": "D:\\repo",
            "preview": "child task",
            "parentThreadId": "parent",
            "agentRole": "worker"
        }))
        .is_none());
    }
}
