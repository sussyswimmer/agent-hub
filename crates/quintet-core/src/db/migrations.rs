//! Numbered SQL migrations embedded at compile time from `db/migrations/`.

use super::{now_iso, Db};
use crate::error::Result;

/// (version, sql). Add new entries at the end; never edit an applied migration.
pub const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../../../../db/migrations/0001_init.sql"))];

pub fn apply(db: &Db) -> Result<Vec<i64>> {
    let mut applied = Vec::new();
    let mut guard = db.conn()?;
    guard.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    )?;
    for (version, sql) in MIGRATIONS {
        let exists: bool = guard.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            [version],
            |r| r.get(0),
        )?;
        if exists {
            continue;
        }
        let tx = guard.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, now_iso()],
        )?;
        tx.commit()?;
        tracing::info!(version, "applied migration");
        applied.push(*version);
    }
    Ok(applied)
}

pub fn current_version(db: &Db) -> Result<i64> {
    let guard = db.conn()?;
    let v: Option<i64> = guard.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))?;
    Ok(v.unwrap_or(0))
}
