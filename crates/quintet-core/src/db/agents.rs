use rusqlite::params;

use super::{now_iso, Db};
use crate::error::Result;

/// Cache one parsed agent (or its error) in the `agents` table.
pub fn upsert(db: &Db, id: &str, json: Option<&str>, hash: &str, error: Option<&str>, path: &str) -> Result<()> {
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT INTO agents(id, json, hash, error, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, hash = excluded.hash, error = excluded.error,
           path = excluded.path, updated_at = excluded.updated_at",
        params![id, json, hash, error, path, now],
    )?;
    Ok(())
}

pub fn remove_missing(db: &Db, keep: &[String]) -> Result<usize> {
    let guard = db.conn()?;
    let mut stmt = guard.prepare("SELECT id FROM agents")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<_, _>>()?;
    let mut removed = 0;
    for id in ids.into_iter().filter(|id| !keep.contains(id)) {
        guard.execute("DELETE FROM agents WHERE id = ?1", [id])?;
        removed += 1;
    }
    Ok(removed)
}
