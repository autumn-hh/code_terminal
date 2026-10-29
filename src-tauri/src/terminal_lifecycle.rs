use std::time::{Duration, Instant};
#[cfg(target_os = "linux")]
use std::{fs, path::PathBuf};

pub(crate) const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(600);
pub(crate) const DEFAULT_MAX_SESSIONS: usize = 32;

pub(crate) fn expired(last_seen: Instant, keep_alive: bool, now: Instant, timeout: Duration) -> bool {
    !keep_alive && now.saturating_duration_since(last_seen) >= timeout
}

// Reserve space for HTTP/file I/O and cleanup before admitting more subprocesses.
pub(crate) fn check_task_capacity() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(cgroup) = fs::read_to_string("/proc/self/cgroup") {
            if let Some(path) = cgroup.lines().find_map(|line| line.strip_prefix("0::")) {
                let directory = PathBuf::from("/sys/fs/cgroup").join(path.trim_start_matches('/'));
                let current = fs::read_to_string(directory.join("pids.current")).ok()
                    .and_then(|s| s.trim().parse::<usize>().ok());
                let max = fs::read_to_string(directory.join("pids.max")).ok()
                    .and_then(|s| s.trim().parse::<usize>().ok());
                if let (Some(current), Some(max)) = (current, max) {
                    if !has_task_capacity(current, max) {
                        return Err("服务器进程额度接近上限，请先结束不需要的终端或后台会话".into());
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn has_task_capacity(current: usize, max: usize) -> bool {
    let reserve = 128.min(max / 4).max(8);
    current.saturating_add(reserve) < max
}

// A PTY shell is a session leader. Include its foreground jobs (which have a
// different process group), but never unrelated Codex daemons in another session.
#[cfg(target_os = "linux")]
fn process_identity(pid: u32) -> Option<(u32, u64)> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields: Vec<_> = stat.rsplit_once(") ")?.1.split_whitespace().collect();
    Some((fields.get(3)?.parse().ok()?, fields.get(19)?.parse().ok()?))
}

#[cfg(target_os = "linux")]
pub(crate) fn stop_pty_processes(pid: u32) {
    // The unreaped child handle held by the caller pins the session leader PID.
    let Some((sid, _)) = process_identity(pid) else { return };
    if sid != pid { return; }
    for signal in [libc::SIGTERM, libc::SIGKILL] {
        // Rescan after TERM: a shutdown trap may have started another child.
        let processes: Vec<_> = fs::read_dir("/proc").into_iter().flatten().filter_map(|entry| {
            let pid = entry.ok()?.file_name().to_str()?.parse::<u32>().ok()?;
            let (session, started) = process_identity(pid)?;
            (session == sid).then_some((pid, started))
        }).collect();
        for &(target, started) in &processes {
            if process_identity(target) == Some((sid, started)) {
                unsafe { libc::kill(target as i32, signal); }
            }
        }
        if signal == libc::SIGTERM { std::thread::sleep(Duration::from_millis(150)); }
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
pub(crate) fn stop_pty_processes(pid: u32) {
    unsafe {
        if libc::getsid(pid as i32) == pid as i32 {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
    }
}

#[cfg(windows)]
pub(crate) fn stop_pty_processes(pid: u32) {
    use std::os::windows::process::CommandExt;
    if let Ok(mut killer) = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn() {
        let deadline = Instant::now() + Duration::from_secs(1);
        while matches!(killer.try_wait(), Ok(None)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = killer.kill();
        let _ = killer.try_wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn heartbeat_and_background_retention_are_independent_of_output() {
        let now = Instant::now();
        let old = now - DEFAULT_IDLE_TIMEOUT;
        assert!(expired(old, false, now, DEFAULT_IDLE_TIMEOUT));
        assert!(!expired(old, true, now, DEFAULT_IDLE_TIMEOUT));
        assert!(!expired(now, false, now, DEFAULT_IDLE_TIMEOUT));
        assert!(!expired(old + Duration::from_secs(1), false, now, DEFAULT_IDLE_TIMEOUT));
    }
    #[test]
    fn capacity_preserves_room_for_web_and_cleanup() {
        assert!(has_task_capacity(259, 1024));
        assert!(!has_task_capacity(896, 1024));
        assert!(!has_task_capacity(255, 256));
        assert!(!has_task_capacity(usize::MAX, 1024));
    }
}
