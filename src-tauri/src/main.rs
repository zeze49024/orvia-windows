#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use rusqlite::{Connection, OptionalExtension};
mod persistence;
mod pdf;
use persistence::{apply_delta, open_db, save, validate_asset_id, Delta};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct Storage {
    connection: Mutex<Connection>,
    root: PathBuf,
}
#[derive(Serialize)]
struct Loaded {
    revision: i64,
    data: Option<Value>,
    path: String,
}
#[tauri::command]
fn read_recovery(storage: State<Storage>) -> Result<Option<Value>,String> {
 let file=storage.root.join("writing-recovery.json");
 if !file.exists(){return Ok(None);}
 if fs::metadata(&file).map_err(|_|"RECOVERY_READ")?.len()>64*1024*1024{return Err("RECOVERY_SIZE".into());}
 let bytes=fs::read(&file).map_err(|_|"RECOVERY_READ")?;
 serde_json::from_slice(&bytes).map(Some).map_err(|_|"RECOVERY_INVALID".into())
}
#[tauri::command]
fn write_recovery(storage: State<Storage>,data: Value) -> Result<(),String> {
 use std::io::Write;
 let bytes=serde_json::to_vec(&data).map_err(|_|"RECOVERY_INVALID")?;
 if bytes.len()>64*1024*1024{return Err("RECOVERY_SIZE".into());}
 let temp=storage.root.join("writing-recovery.tmp");
 let mut file=fs::File::create(&temp).map_err(|_|"RECOVERY_WRITE")?;
 file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"RECOVERY_WRITE")?;
 drop(file);
 fs::rename(temp,storage.root.join("writing-recovery.json")).map_err(|_|"RECOVERY_WRITE".into())
}
#[tauri::command]
fn load_workspace(storage: State<Storage>) -> Result<Loaded, String> {
    let c = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    let meta: Option<(i64, String, u32)> = c
        .query_row(
            "SELECT revision,settings,schema_version FROM workspace WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|_| "DATABASE_READ")?;
    let Some((revision, settings, version)) = meta else {
        return Ok(Loaded {
            revision: 0,
            data: None,
            path: storage.root.display().to_string(),
        });
    };
    if version != 1 {
        return Err("UNSUPPORTED_SCHEMA".into());
    }
    let mut data = serde_json::json!({"schemaVersion":version,"settings":serde_json::from_str::<Value>(&settings).map_err(|_|"INVALID_DATA")?});
    for table in ["libraries", "documents", "assets"] {
        let mut statement = c
            .prepare(&format!("SELECT payload FROM {table} ORDER BY rowid"))
            .map_err(|_| "DATABASE_READ")?;
        let rows = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "DATABASE_READ")?;
        let mut values = vec![];
        for row in rows {
            values.push(
                serde_json::from_str::<Value>(&row.map_err(|_| "DATABASE_READ")?)
                    .map_err(|_| "INVALID_DATA")?,
            )
        }
        data[table] = Value::Array(values)
    }
    Ok(Loaded {
        revision,
        data: Some(data),
        path: storage.root.display().to_string(),
    })
}
#[tauri::command]
fn save_workspace(
    storage: State<Storage>,
    data: Value,
    expected_revision: i64,
) -> Result<i64, String> {
    let mut c = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    save(&mut c, data, expected_revision)
}
#[tauri::command]
fn save_delta(
    storage: State<Storage>,
    delta: Delta,
    expected_revision: i64,
    force_history: Vec<String>,
) -> Result<i64, String> {
    let mut connection = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    apply_delta(&mut connection, delta, expected_revision, &force_history)
}
#[tauri::command]
fn document_history(storage: State<Storage>, id: String) -> Result<Vec<Value>, String> {
    let c = storage.connection.lock().map_err(|_| "STORAGE_LOCK")?;
    let mut statement=c.prepare("SELECT id,saved_at,payload FROM document_history WHERE document_id=?1 ORDER BY id DESC").map_err(|_|"DATABASE_READ")?;
    let rows = statement
        .query_map([id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "DATABASE_READ")?;
    let mut result = vec![];
    for row in rows {
        let (id, date, payload) = row.map_err(|_| "DATABASE_READ")?;
        let mut value: Value = serde_json::from_str(&payload).map_err(|_| "INVALID_DATA")?;
        value["id"] = id.into();
        value["savedAt"] = date.into();
        result.push(value);
    }
    Ok(result)
}
#[tauri::command]
fn put_asset(storage: State<Storage>, bytes: Vec<u8>, mime: String) -> Result<String, String> {
    if bytes.is_empty()
        || bytes.len() > 20 * 1024 * 1024
        || !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime.as_str())
    {
        return Err("IMAGE_SIZE_OR_TYPE".into());
    }
    let id = format!("{:x}", Sha256::digest(&bytes));
    let path = storage.root.join("assets").join(&id);
    if !path.exists() {
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, &bytes).map_err(|_| "ASSET_WRITE")?;
        fs::rename(&temporary, &path).map_err(|_| "ASSET_COMMIT")?;
    }
    Ok(id)
}
#[tauri::command]
fn read_asset(storage: State<Storage>, id: String) -> Result<Vec<u8>, String> {
    validate_asset_id(&id)?;
    let bytes = fs::read(storage.root.join("assets").join(&id)).map_err(|_| "ASSET_READ")?;
    if format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("ASSET_INTEGRITY".into());
    }
    Ok(bytes)
}
// Explicit, marker-gated validation mode never reads the normal user profile.
fn validation_root() -> Option<PathBuf> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|v| v == "--validation-root") {
        let root = PathBuf::from(args.get(2).expect("validation directory required"));
        assert!(
            root.is_absolute() && root.join(".orvia-validation").is_file(),
            "validation marker missing"
        );
        Some(root)
    } else {
        None
    }
}
fn main() {
    let validation = validation_root();
    let mut builder = tauri::Builder::default();
    if validation.is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            // Explicit RGBA window icon avoids relying on Shell's cached icon or
            // a resource decoder's alpha/mask conversion for the running window.
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::image::Image::new_owned(
                    include_bytes!("../icons/window-icon.rgba").to_vec(),
                    256,
                    256,
                ))?;
            }
            let root = validation
                .clone()
                .unwrap_or(app.path().app_local_data_dir()?);
            let connection = open_db(&root).map_err(std::io::Error::other)?;
            app.manage(Storage {
                connection: Mutex::new(connection),
                root,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            save_delta,
            document_history,
            put_asset,
            read_asset,
            read_recovery,
            write_recovery,
            pdf::export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("Orvia startup failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revision_conflict_preserves_data() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_db(dir.path()).unwrap();
        let data = serde_json::json!({"schemaVersion":1,"libraries":[{"id":"one"}],"documents":[],"assets":[],"settings":{}});
        assert_eq!(save(&mut c, data.clone(), 0).unwrap(), 1);
        assert_eq!(save(&mut c, data, 0).unwrap_err(), "CONFLICT");
        assert_eq!(
            c.query_row("SELECT revision FROM workspace", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn invalid_asset_paths_rejected() {
        assert!(validate_asset_id("../../config").is_err());
        assert!(validate_asset_id(&"a".repeat(64)).is_ok());
    }
    #[test]
    fn bulk_metadata_survives_reopen_and_invalid_batch_rolls_back() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_db(dir.path()).unwrap();
        save(&mut c,serde_json::json!({"schemaVersion":1,"libraries":[{"id":"one"},{"id":"two"}],"documents":[{"id":"a","libraryId":"one","title":"A","body":"original","starred":true},{"id":"b","libraryId":"one","title":"B","body":"original","starred":false}],"assets":[],"settings":{}}),0).unwrap();
        let make_delta = |target: &str| -> Delta { serde_json::from_value(serde_json::json!({"libraries":{"upsert":[],"remove":[]},"documents":{"upsert":[{"id":"a","libraryId":"two","title":"A","body":"original","starred":true,"pinned":true,"deletedAt":"2026-10-23T00:00:00Z"},{"id":"b","libraryId":target,"title":"B","body":"original","starred":false,"pinned":true}],"remove":[]},"assets":{"upsert":[],"remove":[]},"settings":null})).unwrap() };
        assert!(apply_delta(&mut c, make_delta("missing"), 1, &[]).is_err());
        let before: String = c.query_row("SELECT payload FROM documents WHERE id='a'",[],|r|r.get(0)).unwrap();
        assert!(!before.contains("pinned"));
        apply_delta(&mut c, make_delta("two"), 1, &[]).unwrap();
        drop(c);
        let c = open_db(dir.path()).unwrap();
        for id in ["a", "b"] {
            let payload:String = c.query_row("SELECT payload FROM documents WHERE id=?1",[id],|r|r.get(0)).unwrap();
            let doc:Value=serde_json::from_str(&payload).unwrap();
            assert_eq!(doc["libraryId"],"two"); assert_eq!(doc["pinned"],true);
            assert_eq!(doc["starred"],id=="a");
        }
        assert_eq!(c.query_row("SELECT count(*) FROM document_history",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    #[test]
    fn sqlite_reopen_and_failed_transaction_preserve_document() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_db(dir.path()).unwrap();
        let data = serde_json::json!({"schemaVersion":1,"libraries":[{"id":"one"}],"documents":[{"id":"doc","libraryId":"one","body":"persistent text"}],"assets":[],"settings":{"locale":"en"}});
        save(&mut c, data.clone(), 0).unwrap();
        let mut invalid = data;
        invalid["documents"][0]["libraryId"] = serde_json::json!("missing");
        assert!(save(&mut c, invalid, 1).is_err());
        drop(c);
        let reopened = open_db(dir.path()).unwrap();
        let payload: String = reopened
            .query_row("SELECT payload FROM documents WHERE id='doc'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&payload).unwrap()["body"],
            "persistent text"
        );
        assert_eq!(
            reopened
                .query_row("SELECT revision FROM workspace", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn delta_updates_one_row_and_history_survives_rollback_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_db(dir.path()).unwrap();
        let docs:Vec<Value>=(0..1000).map(|i|serde_json::json!({"id":format!("doc{i}"),"libraryId":"one","title":"Note","body":"original"})).collect();
        save(&mut c,serde_json::json!({"schemaVersion":1,"libraries":[{"id":"one"}],"documents":docs,"assets":[],"settings":{}}),0).unwrap();
        let before = c.total_changes();
        let delta:Delta=serde_json::from_value(serde_json::json!({"libraries":{"upsert":[],"remove":[]},"documents":{"upsert":[{"id":"doc5","libraryId":"one","title":"Note","body":"changed"}],"remove":[]},"assets":{"upsert":[],"remove":[]},"settings":null})).unwrap();
        apply_delta(&mut c, delta, 1, &[]).unwrap();
        assert_eq!(c.total_changes() - before, 3); // note, history, revision; no full-table rewrite
        let old: String = c
            .query_row("SELECT payload FROM document_history", [], |r| r.get(0))
            .unwrap();
        assert!(old.contains("original"));
        let invalid:Delta=serde_json::from_value(serde_json::json!({"libraries":{"upsert":[],"remove":[]},"documents":{"upsert":[{"id":"doc5","libraryId":"missing","body":"bad"}],"remove":[]},"assets":{"upsert":[],"remove":[]},"settings":null})).unwrap();
        assert!(apply_delta(&mut c, invalid, 2, &["doc5".into()]).is_err());
        drop(c);
        let c = open_db(dir.path()).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM documents", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1000
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM document_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(c
            .query_row("SELECT payload FROM documents WHERE id='doc5'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
            .contains("changed"));
    }
}
