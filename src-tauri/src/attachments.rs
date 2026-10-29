use std::{fs, io::Write, path::Path};
use uuid::Uuid;

pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

// Keep a readable name, but never accept a destination path or shell syntax.
fn safe_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let name = name.trim_matches('.');
    let (stem, extension) = name
        .rsplit_once('.')
        .filter(|(_, ext)| ext.len() <= 12 && ext.chars().all(char::is_alphanumeric))
        .map(|(stem, ext)| (stem, format!(".{ext}")))
        .unwrap_or((name, String::new()));
    let stem: String = stem.chars().take(60).collect();
    format!(
        "file-{}{}",
        if stem.is_empty() { "attachment" } else { &stem },
        extension
    )
}

pub fn save_attachment(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("单个文件不能超过 25 MB".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let metadata = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("附件保存目录不可用".into());
    }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let dir = root.join(Uuid::new_v4().to_string());
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let mut builder = builder;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(name));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&path)?.write_all(bytes)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
        return Err(error.to_string());
    }
    let value = path.to_string_lossy();
    Ok(if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", unc)
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_escape_or_inject_terminal_syntax() {
        for name in [
            "../../secret",
            "C:\\secret\\file.png",
            "$(touch bad)`bad`\n.txt",
            "CON",
            "...",
        ] {
            let safe = safe_name(name);
            assert!(safe.starts_with("file-"));
            assert!(safe
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_')));
            assert_eq!(Path::new(&safe).components().count(), 1);
        }
        assert_eq!(safe_name("中文截图.png"), "file-中文截图.png");
        assert!(safe_name(&("长".repeat(150) + ".png")).ends_with(".png"));
    }

    #[test]
    fn saves_bytes_in_unique_private_directories_without_overwriting() {
        let root = std::env::temp_dir().join(format!("attachment-test-{}", Uuid::new_v4()));
        let first = save_attachment(&root, "same.txt", b"first").unwrap();
        let second = save_attachment(&root, "same.txt", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"first");
        assert_eq!(fs::read(&second).unwrap(), b"second");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(save_attachment(&root, "big", &vec![0; MAX_ATTACHMENT_BYTES + 1]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
