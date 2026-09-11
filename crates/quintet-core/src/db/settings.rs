use rusqlite::{params, OptionalExtension};

use super::{now_iso, ulid, Db};
use crate::error::Result;

pub fn get(db: &Db, key: &str) -> Result<Option<String>> {
    let guard = db.conn()?;
    Ok(guard
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set(db: &Db, key: &str, value: &str) -> Result<()> {
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT INTO settings(id, key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![ulid(), key, value, now],
    )?;
    Ok(())
}

pub fn all(db: &Db) -> Result<Vec<(String, String)>> {
    let guard = db.conn()?;
    let mut stmt = guard.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
