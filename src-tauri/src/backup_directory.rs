use crate::Storage;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf};
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;
#[derive(Serialize, Deserialize)]
struct Approval {
    path: PathBuf,
    owner: String,
}
fn approved(root: &std::path::Path) -> Result<Approval, String> {
    let a: Approval = serde_json::from_slice(
        &fs::read(root.join("backup-directory.json")).map_err(|_| "BACKUP_DIRECTORY_NOT_SET")?,
    )
    .map_err(|_| "BACKUP_DIRECTORY_INVALID")?;
    let meta = fs::symlink_metadata(&a.path).map_err(|_| "BACKUP_DIRECTORY_MISSING")?;
    if a.path.canonicalize().map_err(|_| "BACKUP_DIRECTORY_PATH")? != a.path
        || !meta.is_dir()
        || meta.file_type().is_symlink()
        || fs::read_to_string(a.path.join(".orvia-owner")).map_err(|_| "BACKUP_DIRECTORY_MARKER")?
            != a.owner
    {
        return Err("BACKUP_DIRECTORY_MARKER".into());
    }
    Ok(a)
}
#[tauri::command]
pub async fn pick_backup_directory(
    window: Window,
    storage: State<'_, Storage>,
) -> Result<Option<String>, String> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let parent = selected
        .into_path()
        .map_err(|_| "BACKUP_DIRECTORY_PATH")?
        .canonicalize()
        .map_err(|_| "BACKUP_DIRECTORY_PATH")?;
    let owner = uuid::Uuid::new_v4().to_string();
    let path = parent.join(format!("Orvia Backups {}", &owner[..8]));
    fs::create_dir(&path).map_err(|_| "BACKUP_DIRECTORY_CREATE")?;
    fs::write(path.join(".orvia-owner"), &owner).map_err(|_| "BACKUP_DIRECTORY_CREATE")?;
    fs::write(
        storage.root.join("backup-directory.json"),
        serde_json::to_vec(&Approval {
            path: path.clone(),
            owner,
        })
        .map_err(|_| "BACKUP_DIRECTORY_CREATE")?,
    )
    .map_err(|_| "BACKUP_DIRECTORY_CREATE")?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
pub fn backup_directory(storage: State<Storage>) -> Result<String, String> {
    Ok(approved(&storage.root)?.path.display().to_string())
}
fn valid_name(name: &str, private: bool) -> bool {
    let prefix = if private {
        "Orvia-auto-private-"
    } else {
        "Orvia-auto-public-"
    };
    let suffix = if private { ".orvia-vault" } else { ".orvia" };
    name.strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(suffix))
        .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}
#[tauri::command]
pub fn write_auto_backup(
    storage: State<Storage>,
    bytes: Vec<u8>,
    private: bool,
    keep: usize,
) -> Result<String, String> {
    write_backup(&storage.root, bytes, private, keep)
}
fn write_backup(
    root: &std::path::Path,
    bytes: Vec<u8>,
    private: bool,
    keep: usize,
) -> Result<String, String> {
    if bytes.len() > 128 * 1024 * 1024 || bytes.len() < 16 || !(3..=50).contains(&keep) {
        return Err("BACKUP_SIZE_OR_RETENTION".into());
    }
    if private {
        let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "BACKUP_INVALID")?;
        if v["format"] != "orvia-encrypted-vault" {
            return Err("BACKUP_INVALID".into());
        }
    } else if !bytes.starts_with(b"PK") {
        return Err("BACKUP_INVALID".into());
    }
    let a = approved(root)?;
    let name = format!(
        "Orvia-auto-{}-{}.{}",
        if private { "private" } else { "public" },
        uuid::Uuid::new_v4(),
        if private { "orvia-vault" } else { "orvia" }
    );
    let temp = a.path.join(format!("{}.tmp", name));
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| "BACKUP_WRITE")?;
    f.write_all(&bytes)
        .and_then(|_| f.sync_all())
        .map_err(|_| "BACKUP_WRITE")?;
    drop(f);
    fs::rename(&temp, a.path.join(&name)).map_err(|_| "BACKUP_WRITE")?;
    let mut entries = Vec::new();
    for e in fs::read_dir(&a.path).map_err(|_| "BACKUP_LIST")? {
        let e = e.map_err(|_| "BACKUP_LIST")?;
        let n = e.file_name().to_string_lossy().to_string();
        let m = fs::symlink_metadata(e.path()).map_err(|_| "BACKUP_LIST")?;
        if valid_name(&n, private) && m.is_file() && !m.file_type().is_symlink() {
            entries.push((m.modified().map_err(|_| "BACKUP_LIST")?, n));
        }
    }
    entries.sort_by(|a, b| {
        (b.1 == name)
            .cmp(&(a.1 == name))
            .then_with(|| b.0.cmp(&a.0))
    });
    for (_, n) in entries.into_iter().skip(keep) {
        if n != name {
            fs::remove_file(a.path.join(n)).map_err(|_| "BACKUP_RETENTION")?;
        }
    }
    Ok(name)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_only_owned() {
        assert!(valid_name(
            "Orvia-auto-public-73535d4d-821b-48e9-a683-94dc21378748.orvia",
            false
        ));
        assert!(!valid_name("../user.orvia", false));
        assert!(!valid_name("Orvia-auto-public-user.orvia", false));
    }
}

#[cfg(test)]
mod retention_tests {
    use super::*;
    #[test]
    fn backup_retention_never_deletes_unowned_files_and_refuses_lost_marker() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("backups");
        fs::create_dir(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        fs::write(dir.join(".orvia-owner"), "test-owner").unwrap();
        fs::write(
            root.path().join("backup-directory.json"),
            serde_json::to_vec(&Approval {
                path: dir.clone(),
                owner: "test-owner".into(),
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(dir.join("user-notes.orvia"), b"keep me").unwrap();
        for _ in 0..5 {
            write_backup(root.path(), b"PK valid fixture padded".to_vec(), false, 3).unwrap();
        }
        let files: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(files.iter().filter(|n| valid_name(n, false)).count(), 3);
        assert_eq!(fs::read(dir.join("user-notes.orvia")).unwrap(), b"keep me");
        fs::remove_file(dir.join(".orvia-owner")).unwrap();
        assert!(write_backup(root.path(), b"PK valid fixture padded".to_vec(), false, 3).is_err());
    }
}
