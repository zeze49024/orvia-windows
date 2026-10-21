#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    schema_version: u32,
    libraries: Vec<Value>,
    documents: Vec<Value>,
    assets: Vec<Value>,
    settings: Value,
}
fn open_db(root: &std::path::Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join("assets")).map_err(|_| "STORAGE_DIRECTORY")?;
    let c = Connection::open(root.join("orvia.sqlite3")).map_err(|_| "DATABASE_OPEN")?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, settings TEXT NOT NULL, schema_version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES libraries(id),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,payload TEXT NOT NULL);").map_err(|_|"DATABASE_SCHEMA")?;
    Ok(c)
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
fn save(c: &mut Connection, data: Value, expected: i64) -> Result<i64, String> {
    let parsed: Workspace = serde_json::from_value(data).map_err(|_| "INVALID_DATA")?;
    if parsed.schema_version != 1
        || parsed.libraries.is_empty()
        || parsed.libraries.len() > 200
        || parsed.documents.len() > 20000
        || parsed.assets.len() > 10000
    {
        return Err("INVALID_DATA".into());
    }
    let tx = c.transaction().map_err(|_| "DATABASE_WRITE")?;
    let revision: i64 = tx
        .query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|_| "DATABASE_READ")?
        .unwrap_or(0);
    if revision != expected {
        return Err("CONFLICT".into());
    }
    tx.execute("DELETE FROM documents", [])
        .map_err(|_| "DATABASE_WRITE")?;
    tx.execute("DELETE FROM libraries", [])
        .map_err(|_| "DATABASE_WRITE")?;
    tx.execute("DELETE FROM assets", [])
        .map_err(|_| "DATABASE_WRITE")?;
    for l in parsed.libraries {
        let id = l["id"].as_str().ok_or("INVALID_LIBRARY")?;
        tx.execute(
            "INSERT INTO libraries VALUES(?1,?2)",
            params![id, l.to_string()],
        )
        .map_err(|_| "INVALID_LIBRARY")?;
    }
    for d in parsed.documents {
        let id = d["id"].as_str().ok_or("INVALID_DOCUMENT")?;
        let library = d["libraryId"].as_str().ok_or("INVALID_DOCUMENT")?;
        tx.execute(
            "INSERT INTO documents VALUES(?1,?2,?3)",
            params![id, library, d.to_string()],
        )
        .map_err(|_| "INVALID_DOCUMENT")?;
    }
    for a in parsed.assets {
        let id = a["id"].as_str().ok_or("INVALID_ASSET")?;
        validate_asset_id(id)?;
        tx.execute(
            "INSERT INTO assets VALUES(?1,?2)",
            params![id, a.to_string()],
        )
        .map_err(|_| "INVALID_ASSET")?;
    }
    let next = revision + 1;
    tx.execute("INSERT INTO workspace VALUES(1,?1,?2,1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,settings=excluded.settings",params![next,parsed.settings.to_string()]).map_err(|_|"DATABASE_WRITE")?;
    tx.commit().map_err(|_| "DATABASE_COMMIT")?;
    Ok(next)
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
fn validate_asset_id(id: &str) -> Result<(), String> {
    if id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("INVALID_ASSET_ID".into())
    }
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
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Explicit RGBA window icon avoids relying on Shell's cached icon or
            // a resource decoder's alpha/mask conversion for the running window.
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::image::Image::new_owned(
                    include_bytes!("../icons/window-icon.rgba").to_vec(),
                    256,
                    256,
                ))?;
            }
            let root = app.path().app_local_data_dir()?;
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
            put_asset,
            read_asset
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
        let payload: String = reopened.query_row("SELECT payload FROM documents WHERE id='doc'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["body"], "persistent text");
        assert_eq!(reopened.query_row("SELECT revision FROM workspace", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
    }
}
