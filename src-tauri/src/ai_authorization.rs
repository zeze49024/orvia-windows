//! Setup-time grants are bound to this data directory, provider, key and policy.
//! They are not workspace preferences and never travel in backups.
use crate::ai_credentials as credentials;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {
    version: u32,
    fingerprint: String,
}
fn path(root: &Path, provider: &str) -> Result<PathBuf, String> {
    credentials::target(root, provider)?;
    Ok(root.join(format!("ai-authorization-{provider}.json")))
}
fn fingerprint(root: &Path, provider: &str, key: &str) -> String {
    let mut h = Sha256::new();
    h.update(b"Orvia AI direct-send policy v1\0");
    h.update(root.to_string_lossy().as_bytes());
    h.update([0]);
    h.update(provider.as_bytes());
    h.update([0]);
    h.update(key.as_bytes());
    format!("{:x}", h.finalize())
}
pub fn authorized(root: &Path, provider: &str, key: &str) -> Result<bool, String> {
    let p = path(root, provider)?;
    let meta = match fs::symlink_metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("AI_AUTHORIZATION_STORE".into()),
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 1024 {
        return Ok(false);
    }
    let bytes = fs::read(p).map_err(|_| "AI_AUTHORIZATION_STORE")?;
    Ok(serde_json::from_slice::<Grant>(&bytes)
        .is_ok_and(|g| g.version == 1 && g.fingerprint == fingerprint(root, provider, key)))
}
pub fn save(root: &Path, provider: &str, key: &str) -> Result<(), String> {
    let p = path(root, provider)?;
    let temp = root.join(format!("ai-authorization-{}.tmp", uuid::Uuid::new_v4()));
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| "AI_AUTHORIZATION_STORE")?;
    let result = (|| {
        f.write_all(
            &serde_json::to_vec(&Grant {
                version: 1,
                fingerprint: fingerprint(root, provider, key),
            })
            .map_err(|_| "AI_AUTHORIZATION_STORE")?,
        )
        .and_then(|_| f.sync_all())
        .map_err(|_| "AI_AUTHORIZATION_STORE")?;
        drop(f);
        fs::rename(&temp, p).map_err(|_| "AI_AUTHORIZATION_STORE".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn revoke(root: &Path, provider: &str) -> Result<(), String> {
    match fs::remove_file(path(root, provider)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("AI_AUTHORIZATION_STORE".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grants_require_the_same_key_provider_root_and_policy() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let key = "test-key-that-is-not-real";
        assert!(!authorized(a.path(), "deepseek", key).unwrap());
        save(a.path(), "deepseek", key).unwrap();
        assert!(authorized(a.path(), "deepseek", key).unwrap());
        assert!(!authorized(a.path(), "deepseek", "a-different-fake-key").unwrap());
        assert!(!authorized(a.path(), "openai", key).unwrap());
        let bytes = fs::read(path(a.path(), "deepseek").unwrap()).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(key));
        fs::write(path(b.path(), "deepseek").unwrap(), &bytes).unwrap();
        assert!(!authorized(b.path(), "deepseek", key).unwrap());
        fs::write(
            path(a.path(), "deepseek").unwrap(),
            br#"{"version":99,"fingerprint":"bad"}"#,
        )
        .unwrap();
        assert!(!authorized(a.path(), "deepseek", key).unwrap());
        save(a.path(), "deepseek", key).unwrap();
        revoke(a.path(), "deepseek").unwrap();
        assert!(!authorized(a.path(), "deepseek", key).unwrap());
        assert!(save(a.path(), "../../outside", key).is_err());
    }
}
