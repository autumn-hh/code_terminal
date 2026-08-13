use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

const CODEX_APP_SERVER_TIMEOUT: Duration = Duration::from_secs(8);

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
    let mut command = codex_app_server_command();
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 Codex 会话服务：{error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Codex 会话服务输出".to_string())?;
    let (line_tx, line_rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else {
                break;
            };
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let result = (|| {
        let stdin = child
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

        for request in requests {
            writeln!(stdin, "{request}")
                .map_err(|error| format!("请求 Codex 历史会话失败：{error}"))?;
        }
        stdin
            .flush()
            .map_err(|error| format!("请求 Codex 历史会话失败：{error}"))?;

        let deadline = Instant::now() + CODEX_APP_SERVER_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("读取 Codex 历史会话超时".into());
            }

            let line = line_rx
                .recv_timeout(remaining)
                .map_err(|_| "读取 Codex 历史会话超时".to_string())?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
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
    })();

    drop(child.stdin.take());
    thread::spawn(move || {
        let _ = child.wait();
        let _ = reader.join();
    });
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
        .args(["/D", "/S", "/C", "codex app-server"])
        .creation_flags(0x08000000);
    command
}

#[cfg(not(windows))]
fn codex_app_server_command() -> Command {
    let mut command = Command::new("codex");
    command.arg("app-server");
    command
}

#[cfg(test)]
mod tests {
    use super::{normalize_title, session_summary_from_value};
    use serde_json::json;

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
