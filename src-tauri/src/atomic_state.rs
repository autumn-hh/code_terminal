use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub fn load_json<T: DeserializeOwned + Serialize>(path: &Path) -> Result<Option<T>, String> {
    if path.exists() {
        match read_json(path) {
            Ok(value) => return Ok(Some(value)),
            Err(primary_error) => {
                let backup = backup_path(path);
                let value = read_json(&backup).map_err(|backup_error| {
                    format!(
                        "状态文件损坏，且备份无法恢复（主文件：{primary_error}；备份：{backup_error}）"
                    )
                })?;
                let bytes = serialize_json(&value)?;
                replace_primary(path, &bytes)
                    .map_err(|error| format!("已读取状态备份，但恢复主文件失败：{error}"))?;
                return Ok(Some(value));
            }
        }
    }

    let backup = backup_path(path);
    if !backup.exists() {
        return Ok(None);
    }

    let value =
        read_json(&backup).map_err(|error| format!("状态主文件缺失，且备份无法恢复：{error}"))?;
    let bytes = serialize_json(&value)?;
    replace_primary(path, &bytes)
        .map_err(|error| format!("已读取状态备份，但恢复主文件失败：{error}"))?;
    Ok(Some(value))
}

pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serialize_json(value)?;
    ensure_parent(path).map_err(|error| error.to_string())?;
    let had_primary = path.exists();

    if had_primary {
        let backup = backup_path(path);
        let backup_temp = sibling_path(path, "backup.tmp");
        fs::copy(path, &backup_temp).map_err(|error| error.to_string())?;
        sync_file(&backup_temp).map_err(|error| error.to_string())?;
        replace_file(&backup_temp, &backup).map_err(|error| error.to_string())?;
    }

    replace_primary(path, &bytes).map_err(|error| error.to_string())?;
    if !had_primary {
        replace_primary(&backup_path(path), &bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

fn serialize_json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn replace_primary(path: &Path, bytes: &[u8]) -> io::Result<()> {
    ensure_parent(path)?;
    let temp = sibling_path(path, "write.tmp");
    let result = (|| {
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        replace_file(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)
    }

    #[cfg(windows)]
    {
        if !destination.exists() {
            return fs::rename(source, destination);
        }

        let displaced = sibling_path(destination, "replace.old");
        fs::rename(destination, &displaced)?;
        match fs::rename(source, destination) {
            Ok(()) => {
                let _ = fs::remove_file(displaced);
                Ok(())
            }
            Err(error) => {
                let _ = fs::rename(displaced, destination);
                Err(error)
            }
        }
    }
}

fn ensure_parent(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn sync_file(path: &Path) -> io::Result<()> {
    OpenOptions::new().write(true).open(path)?.sync_all()
}

fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    path.with_file_name(format!("{file_name}.bak"))
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    path.with_file_name(format!(".{file_name}.{}.{}", Uuid::new_v4(), suffix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct TestState {
        value: String,
    }

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("code-terminal-{name}-{}", Uuid::new_v4()))
    }

    #[test]
    fn save_creates_backup_and_load_recovers_corrupt_primary() {
        let dir = test_dir("atomic-state-recovery");
        let path = dir.join("workbench-state.json");
        let first = TestState {
            value: "first".into(),
        };
        let second = TestState {
            value: "second".into(),
        };

        save_json(&path, &first).unwrap();
        save_json(&path, &second).unwrap();
        fs::write(&path, b"not-json").unwrap();

        let recovered = load_json::<TestState>(&path).unwrap().unwrap();
        assert_eq!(recovered, first);
        assert_eq!(load_json::<TestState>(&path).unwrap(), Some(first));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn load_reports_when_primary_and_backup_are_both_invalid() {
        let dir = test_dir("atomic-state-invalid");
        let path = dir.join("workbench-state.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, b"bad-primary").unwrap();
        fs::write(backup_path(&path), b"bad-backup").unwrap();

        let error = load_json::<TestState>(&path).unwrap_err();
        assert!(error.contains("状态文件损坏"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn first_save_creates_a_recovery_backup() {
        let dir = test_dir("atomic-state-first-backup");
        let path = dir.join("workbench-state.json");
        let state = TestState {
            value: "saved".into(),
        };

        save_json(&path, &state).unwrap();
        fs::write(&path, b"not-json").unwrap();

        assert_eq!(load_json::<TestState>(&path).unwrap(), Some(state));
        let _ = fs::remove_dir_all(dir);
    }
}
