//! Numbered, forward-only, embedded at compile time. Every migration has a test (§9).

use super::Db;
use crate::error::Result;

pub const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../../../../db/migrations/001_init.sql"))];

/// Apply anything not yet recorded. Each migration runs in its own transaction, so a failure
/// leaves the database on the last good version rather than half-migrated.
pub fn apply(db: &Db) -> Result<Vec<i64>> {
    let mut guard = db.conn()?;
    guard.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);")?;
    let mut applied = Vec::new();
    for (version, sql) in MIGRATIONS {
        let done: bool =
            guard.query_row("SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?1)", [version], |r| r.get(0))?;
        if done {
            continue;
        }
        let tx = guard.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("INSERT INTO schema_version(version, applied_at) VALUES (?1, ?2)", rusqlite::params![version, super::now()])?;
        tx.commit()?;
        tracing::info!(version, "migration applied");
        applied.push(*version);
    }
    Ok(applied)
}

pub fn version(db: &Db) -> Result<i64> {
    let v: Option<i64> = db.conn()?.query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))?;
    Ok(v.unwrap_or(0))
}
