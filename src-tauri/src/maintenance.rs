use crate::{validate_asset_id, Storage};
use serde::Serialize;
use std::{collections::HashSet, fs, path::Path};
use tauri::State;
fn collect(text: &str, ids: &mut HashSet<String>) {
    for suffix in text.split("asset:").skip(1) {
        if let Some(id) = suffix.get(..64) {
            if validate_asset_id(id).is_ok() {
                ids.insert(id.into());
            }
        }
    }
}
fn references(storage: &Storage, c: &rusqlite::Connection) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    for table in ["documents", "document_history"] {
        let mut q = c
            .prepare(&format!("SELECT payload FROM {table}"))
            .map_err(|_| "DATABASE_READ")?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "DATABASE_READ")?;
        for row in rows {
            collect(&row.map_err(|_| "DATABASE_READ")?, &mut ids)
        }
    }
    for e in fs::read_dir(&storage.root).map_err(|_| "STORAGE_SCAN")? {
        let e = e.map_err(|_| "STORAGE_SCAN")?;
        let n = e.file_name().to_string_lossy().to_string();
        if n.starts_with("writing-recovery.corrupt-") {
            for asset in fs::read_dir(storage.root.join("assets")).map_err(|_| "STORAGE_SCAN")? {
                let id = asset
                    .map_err(|_| "STORAGE_SCAN")?
                    .file_name()
                    .to_string_lossy()
                    .to_string();
                if validate_asset_id(&id).is_ok() {
                    ids.insert(id);
                }
            }
        }
        if n == "writing-recovery.json"
            || n == "writing-recovery.tmp"
            || (n.starts_with("writing-recovery.corrupt-") && n.ends_with(".json"))
        {
            let m = fs::symlink_metadata(e.path()).map_err(|_| "STORAGE_SCAN")?;
            if !m.is_file() || m.file_type().is_symlink() || m.len() > 64 * 1024 * 1024 {
                return Err("RECOVERY_SCAN_BLOCKED".into());
            }
            collect(
                &fs::read_to_string(e.path()).map_err(|_| "RECOVERY_SCAN_BLOCKED")?,
                &mut ids,
            );
        }
    }
    Ok(ids)
}
#[derive(Serialize)]
pub struct AssetFile {
    id: String,
    size: u64,
    referenced: bool,
}
#[derive(Serialize)]
pub struct Inventory {
    assets: Vec<AssetFile>,
    database: u64,
    recovery: u64,
    vault: u64,
}
fn file_size(root: &Path, name: &str) -> u64 {
    fs::metadata(root.join(name)).map(|m| m.len()).unwrap_or(0)
}
#[tauri::command]
pub fn storage_inventory(storage: State<Storage>) -> Result<Inventory, String> {
    let _recovery = storage.recovery_lock.lock().map_err(|_| "RECOVERY_LOCK")?;
    let c = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    let refs = references(&storage, &c)?;
    let mut assets = Vec::new();
    for e in fs::read_dir(storage.root.join("assets")).map_err(|_| "STORAGE_SCAN")? {
        let e = e.map_err(|_| "STORAGE_SCAN")?;
        let id = e.file_name().to_string_lossy().to_string();
        if validate_asset_id(&id).is_err() {
            continue;
        }
        let m = fs::symlink_metadata(e.path()).map_err(|_| "STORAGE_SCAN")?;
        if !m.is_file() || m.file_type().is_symlink() {
            return Err("STORAGE_SCAN".into());
        }
        assets.push(AssetFile {
            referenced: refs.contains(&id),
            id,
            size: m.len(),
        });
    }
    Ok(Inventory {
        assets,
        database: file_size(&storage.root, "orvia.sqlite3")
            + file_size(&storage.root, "orvia.sqlite3-wal"),
        recovery: file_size(&storage.root, "writing-recovery.json"),
        vault: file_size(&storage.root, "knowledge-vault.orvia-vault")
            + file_size(&storage.root, "knowledge-vault-recovery.orvia-vault"),
    })
}
#[tauri::command]
pub fn cleanup_assets(storage: State<Storage>, ids: Vec<String>) -> Result<usize, String> {
    if ids.len() > 10000 {
        return Err("STORAGE_LIMIT".into());
    }
    for id in &ids {
        validate_asset_id(id)?;
    }
    let _recovery = storage.recovery_lock.lock().map_err(|_| "RECOVERY_LOCK")?;
    let c = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    let refs = references(&storage, &c)?;
    // A stale preview must never authorize deleting a newly referenced asset.
    if ids.iter().any(|id| refs.contains(id)) {
        return Err("ASSET_REFERENCED".into());
    }
    let mut count = 0;
    for id in ids {
        let p = storage.root.join("assets").join(id);
        match fs::symlink_metadata(&p) {
            Ok(m) => {
                if !m.is_file() || m.file_type().is_symlink() {
                    return Err("STORAGE_SCAN".into());
                }
                fs::remove_file(p).map_err(|_| "ASSET_DELETE")?;
                count += 1
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("STORAGE_SCAN".into()),
        }
    }
    Ok(count)
}
fn quarantine_name(name: &str) -> bool {
    name.strip_prefix("writing-recovery.corrupt-")
        .and_then(|s| s.strip_suffix(".json"))
        .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
        || name
            .strip_prefix("vault-recovery.corrupt-")
            .and_then(|s| s.strip_suffix(".orvia-vault"))
            .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}
#[tauri::command]
pub fn recovery_quarantines(storage: State<Storage>) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for e in fs::read_dir(&storage.root).map_err(|_| "RECOVERY_SCAN")? {
        let n = e
            .map_err(|_| "RECOVERY_SCAN")?
            .file_name()
            .to_string_lossy()
            .to_string();
        if quarantine_name(&n) {
            names.push(n)
        }
    }
    Ok(names)
}
#[tauri::command]
pub fn read_quarantine(storage: State<Storage>, name: String) -> Result<Vec<u8>, String> {
    if !quarantine_name(&name) {
        return Err("RECOVERY_NAME".into());
    }
    let p = storage.root.join(name);
    let m = fs::symlink_metadata(&p).map_err(|_| "RECOVERY_READ")?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() > 128 * 1024 * 1024 {
        return Err("RECOVERY_SIZE".into());
    }
    fs::read(p).map_err(|_| "RECOVERY_READ".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quarantine_paths_and_reference_scan() {
        assert!(!quarantine_name("../writing-recovery.json"));
        assert!(!quarantine_name("writing-recovery.corrupt-user.json"));
        let id = "a".repeat(64);
        let mut s = HashSet::new();
        collect(&format!("before asset:{id} after"), &mut s);
        assert!(s.contains(&id));
    }
}
