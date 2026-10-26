use sha2::{Digest, Sha256};
use std::path::Path;
pub struct Secret(pub String);
impl Drop for Secret {
    fn drop(&mut self) {
        unsafe { self.0.as_bytes_mut().fill(0) }
    }
}
pub fn target(root: &Path, provider: &str) -> Result<String, String> {
    if !["openai", "deepseek"].contains(&provider) {
        return Err("AI_PROVIDER".into());
    }
    let hash = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    Ok(format!("Orvia/AI/{}/{provider}", &hash[..24]))
}
pub fn validate(key: &str) -> Result<(), String> {
    if key.len() < 16 || key.len() > 2048 || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("AI_KEY_FORMAT".into());
    }
    Ok(())
}
#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read(name: &str) -> Result<Option<Secret>, String> {
        unsafe {
            let name = wide(name);
            let mut ptr = std::ptr::null_mut();
            if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err("AI_KEY_STORE".into())
                };
            }
            let len = (*ptr).CredentialBlobSize as usize;
            if len > 2048 || (*ptr).CredentialBlob.is_null() {
                CredFree(ptr.cast());
                return Err("AI_KEY_STORE".into());
            }
            let blob = std::slice::from_raw_parts_mut((*ptr).CredentialBlob, len);
            let bytes = blob.to_vec();
            blob.fill(0);
            CredFree(ptr.cast());
            let value = Secret(String::from_utf8(bytes).map_err(|_| "AI_KEY_STORE")?);
            validate(&value.0)?;
            Ok(Some(value))
        }
    }
    pub fn write(name: &str, key: &str) -> Result<(), String> {
        validate(key)?;
        unsafe {
            let mut name = wide(name);
            let mut user = wide("Orvia user-provided API key");
            let mut bytes = key.as_bytes().to_vec();
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: name.as_mut_ptr(),
                CredentialBlobSize: bytes.len() as u32,
                CredentialBlob: bytes.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                UserName: user.as_mut_ptr(),
                ..std::mem::zeroed()
            };
            let ok = CredWriteW(&credential, 0) != 0;
            bytes.fill(0);
            if ok {
                Ok(())
            } else {
                Err("AI_KEY_STORE".into())
            }
        }
    }
    pub fn delete(name: &str) -> Result<(), String> {
        unsafe {
            if CredDeleteW(wide(name).as_ptr(), CRED_TYPE_GENERIC, 0) != 0
                || GetLastError() == ERROR_NOT_FOUND
            {
                Ok(())
            } else {
                Err("AI_KEY_STORE".into())
            }
        }
    }
}
#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn read(_: &str) -> Result<Option<Secret>, String> {
        Err("AI_DESKTOP_ONLY".into())
    }
    pub fn write(_: &str, _: &str) -> Result<(), String> {
        Err("AI_DESKTOP_ONLY".into())
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Err("AI_DESKTOP_ONLY".into())
    }
}
pub use platform::{delete, read, write};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_are_scoped_and_keys_are_bounded() {
        assert_ne!(
            target(Path::new("a"), "openai").unwrap(),
            target(Path::new("b"), "openai").unwrap()
        );
        assert!(target(Path::new("a"), "https://evil.test").is_err());
        assert!(validate("key\ninvalid").is_err());
        assert!(validate(&"a".repeat(2049)).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn native_key_round_trip_does_not_need_network() {
        let root = tempfile::tempdir().unwrap();
        let name = target(root.path(), "deepseek").unwrap();
        let result = write(&name, "orvia-validation-only-not-a-real-api-key");
        if std::env::var_os("CI").is_some() {
            result.unwrap();
        } else if result.is_err() {
            return;
        }
        let value = read(&name).unwrap().unwrap();
        assert!(value.0.starts_with("orvia-validation-only"));
        delete(&name).unwrap();
        assert!(read(&name).unwrap().is_none());
    }
}
