use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    schema_version: u32,
    libraries: Vec<Value>,
    documents: Vec<Value>,
    assets: Vec<Value>,
    settings: Value,
}
pub(crate) fn open_db(root: &std::path::Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join("assets")).map_err(|_| "STORAGE_DIRECTORY")?;
    let c = Connection::open(root.join("orvia.sqlite3")).map_err(|_| "DATABASE_OPEN")?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, settings TEXT NOT NULL, schema_version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES libraries(id),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS document_history(id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL,saved_at TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS history_document ON document_history(document_id,id DESC);").map_err(|_|"DATABASE_SCHEMA")?;
    Ok(c)
}
pub(crate) fn save(c: &mut Connection, data: Value, expected: i64) -> Result<i64, String> {
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
#[derive(Deserialize, Default)]
struct Changes {
    upsert: Vec<Value>,
    remove: Vec<String>,
}
#[derive(Deserialize)]
pub(crate) struct Delta {
    libraries: Changes,
    documents: Changes,
    assets: Changes,
    settings: Option<Value>,
    #[serde(default)]
    history: std::collections::HashMap<String, Vec<Value>>,
}
pub(crate) fn apply_delta(
    c: &mut Connection,
    delta: Delta,
    expected: i64,
    force: &[String],
) -> Result<i64, String> {
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
    for l in delta.libraries.upsert {
        let id = l["id"].as_str().ok_or("INVALID_LIBRARY")?;
        tx.execute("INSERT INTO libraries VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![id,l.to_string()]).map_err(|_|"INVALID_LIBRARY")?;
    }
    for d in delta.documents.upsert {
        let id = d["id"].as_str().ok_or("INVALID_DOCUMENT")?;
        let library = d["libraryId"].as_str().ok_or("INVALID_DOCUMENT")?;
        let old: Option<String> = tx
            .query_row("SELECT payload FROM documents WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "DATABASE_READ")?;
        if let Some(old) = old {
            let previous: Value = serde_json::from_str(&old).map_err(|_| "INVALID_DATA")?;
            if previous["body"] != d["body"] || previous["title"] != d["title"] {
                let due: bool=tx.query_row("SELECT NOT EXISTS(SELECT 1 FROM document_history WHERE document_id=?1 AND saved_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds'))",[id],|r|r.get(0)).map_err(|_|"DATABASE_READ")?;
                if due || force.iter().any(|v| v == id) {
                    let mut assets = vec![];
                    let mut statement = tx
                        .prepare("SELECT id,payload FROM assets")
                        .map_err(|_| "DATABASE_READ")?;
                    let rows = statement
                        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                        .map_err(|_| "DATABASE_READ")?;
                    for row in rows {
                        let (aid, payload) = row.map_err(|_| "DATABASE_READ")?;
                        if previous["body"]
                            .as_str()
                            .unwrap_or("")
                            .contains(&format!("asset:{aid}"))
                        {
                            assets.push(
                                serde_json::from_str::<Value>(&payload)
                                    .map_err(|_| "INVALID_DATA")?,
                            );
                        }
                    }
                    let payload =
                        serde_json::json!({"document":previous,"assets":assets}).to_string();
                    tx.execute("INSERT INTO document_history(document_id,saved_at,payload) VALUES(?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?2)",params![id,payload]).map_err(|_|"DATABASE_WRITE")?;
                    tx.execute("DELETE FROM document_history WHERE document_id=?1 AND id NOT IN(SELECT id FROM document_history WHERE document_id=?1 ORDER BY id DESC LIMIT 20)",[id]).map_err(|_|"DATABASE_WRITE")?;
                    loop {
                        let size:i64=tx.query_row("SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM document_history WHERE document_id=?1",[id],|r|r.get(0)).map_err(|_|"DATABASE_READ")?;
                        if size <= 20_000_000 {
                            break;
                        }
                        tx.execute("DELETE FROM document_history WHERE id=(SELECT min(id) FROM document_history WHERE document_id=?1)",[id]).map_err(|_|"DATABASE_WRITE")?;
                    }
                }
            }
        }
        tx.execute("INSERT INTO documents VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET library_id=excluded.library_id,payload=excluded.payload",params![id,library,d.to_string()]).map_err(|_|"INVALID_DOCUMENT")?;
    }
    for id in delta.documents.remove {
        tx.execute("DELETE FROM documents WHERE id=?1", [&id])
            .map_err(|_| "DATABASE_WRITE")?;
        tx.execute("DELETE FROM document_history WHERE document_id=?1", [&id])
            .map_err(|_| "DATABASE_WRITE")?;
    }
    for id in delta.libraries.remove {
        tx.execute("DELETE FROM libraries WHERE id=?1", [id])
            .map_err(|_| "INVALID_LIBRARY")?;
    }
    for a in delta.assets.upsert {
        let id = a["id"].as_str().ok_or("INVALID_ASSET")?;
        validate_asset_id(id)?;
        tx.execute("INSERT INTO assets VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![id,a.to_string()]).map_err(|_|"INVALID_ASSET")?;
    }
    for id in delta.assets.remove {
        tx.execute("DELETE FROM assets WHERE id=?1", [id])
            .map_err(|_| "DATABASE_WRITE")?;
    }
    for (table, min, max) in [
        ("libraries", 1, 200),
        ("documents", 0, 20000),
        ("assets", 0, 10000),
    ] {
        let count: i64 = tx
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .map_err(|_| "DATABASE_READ")?;
        if count < min || count > max {
            return Err("INVALID_DATA".into());
        }
    }
    if delta.history.len() > 20000 {
        return Err("INVALID_HISTORY".into());
    }
    let mut total_history = 0usize;
    for (id, entries) in delta.history {
        if entries.len() > 20
            || !tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1)",
                    [&id],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(|_| "DATABASE_READ")?
        {
            return Err("INVALID_HISTORY".into());
        }
        let size = serde_json::to_vec(&entries)
            .map_err(|_| "INVALID_HISTORY")?
            .len();
        total_history += size;
        if size > 20_000_000 || total_history > 32 * 1024 * 1024 {
            return Err("INVALID_HISTORY".into());
        }
        tx.execute("DELETE FROM document_history WHERE document_id=?1", [&id])
            .map_err(|_| "DATABASE_WRITE")?;
        for entry in entries {
            if entry["document"]["id"].as_str() != Some(id.as_str())
                || !entry["savedAt"].is_string()
                || !entry["document"]["body"].is_string()
            {
                return Err("INVALID_HISTORY".into());
            }
            let payload =
                serde_json::json!({"document":entry["document"],"assets":entry["assets"]})
                    .to_string();
            tx.execute(
                "INSERT INTO document_history(document_id,saved_at,payload) VALUES(?1,?2,?3)",
                params![id, entry["savedAt"].as_str().unwrap(), payload],
            )
            .map_err(|_| "DATABASE_WRITE")?;
        }
    }
    if let Some(settings) = delta.settings {
        tx.execute("INSERT INTO workspace VALUES(1,?1,?2,1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,settings=excluded.settings",params![revision+1,settings.to_string()]).map_err(|_|"DATABASE_WRITE")?;
    } else {
        tx.execute(
            "UPDATE workspace SET revision=?1 WHERE id=1",
            [revision + 1],
        )
        .map_err(|_| "DATABASE_WRITE")?;
    }
    tx.commit().map_err(|_| "DATABASE_COMMIT")?;
    Ok(revision + 1)
}
pub(crate) fn validate_asset_id(id: &str) -> Result<(), String> {
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
