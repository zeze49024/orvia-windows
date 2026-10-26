use crate::Storage;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::State;
fn filename(record: &str) -> Result<&'static str, String> {
    match record {
        "main" => Ok("knowledge-vault.orvia-vault"),
        "recovery" => Ok("knowledge-vault-recovery.orvia-vault"),
        _ => Err("VAULT_RECORD".into()),
    }
}
#[derive(Serialize)]
pub struct Record {
    bytes: Vec<u8>,
    hash: String,
}
fn read(path: &Path) -> Result<Option<Record>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let m = fs::symlink_metadata(path).map_err(|_| "VAULT_READ")?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() > 128 * 1024 * 1024 {
        return Err("VAULT_SIZE_OR_PATH".into());
    }
    let bytes = fs::read(path).map_err(|_| "VAULT_READ")?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    Ok(Some(Record { bytes, hash }))
}
#[tauri::command]
pub fn read_private_record(
    storage: State<Storage>,
    record: String,
) -> Result<Option<Record>, String> {
    let _guard = storage.vault_lock.lock().map_err(|_| "VAULT_LOCK")?;
    read(&storage.root.join(filename(&record)?))
}
#[tauri::command]
pub fn write_private_record(
    storage: State<Storage>,
    record: String,
    bytes: Vec<u8>,
    expected: Option<String>,
) -> Result<(), String> {
    let _guard = storage.vault_lock.lock().map_err(|_| "VAULT_LOCK")?;
    let path = storage.root.join(filename(&record)?);
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("VAULT_SIZE".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "VAULT_FORMAT")?;
    if value["format"] != "orvia-encrypted-vault"
        || value["version"] != 1
        || !value["ciphertext"].is_string()
    {
        return Err("VAULT_FORMAT".into());
    }
    if read(&path)?.map(|r| r.hash) != expected {
        return Err("VAULT_CONFLICT".into());
    }
    let temp: PathBuf = path.with_extension(format!("{}.orvia-vault.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| "VAULT_WRITE")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "VAULT_WRITE")?;
    drop(file);
    fs::rename(temp, path).map_err(|_| "VAULT_WRITE".into())
}
#[tauri::command]
pub fn quarantine_private_recovery(storage: State<Storage>) -> Result<(), String> {
    let _guard = storage.vault_lock.lock().map_err(|_| "VAULT_LOCK")?;
    let source = storage.root.join(filename("recovery")?);
    if source.exists() {
        fs::rename(
            source,
            storage.root.join(format!(
                "vault-recovery.corrupt-{}.orvia-vault",
                uuid::Uuid::new_v4()
            )),
        )
        .map_err(|_| "VAULT_QUARANTINE")?;
    }
    Ok(())
}
#[tauri::command]
pub fn delete_private_recovery(
    storage: State<Storage>,
    expected: Option<String>,
) -> Result<(), String> {
    let _guard = storage.vault_lock.lock().map_err(|_| "VAULT_LOCK")?;
    let path = storage.root.join(filename("recovery")?);
    if read(&path)?.map(|r| r.hash) != expected {
        return Err("VAULT_CONFLICT".into());
    }
    if path.exists() {
        fs::remove_file(path).map_err(|_| "VAULT_WRITE")?;
    }
    Ok(())
}
