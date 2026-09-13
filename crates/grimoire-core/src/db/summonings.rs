//! The `summonings` table (§9): one row per time a familiar was started.

use crate::db::{Db, id, now};
use crate::error::Result;

/// Open a summoning row. Returns its id.
pub fn open(
    db: &Db,
    familiar_id: &str,
    engine: &str,
    model: &str,
    cwd: &str,
    isolation: &str,
    pid: u32,
) -> Result<String> {
    let summoning_id = id();
    db.conn()?.execute(
        "INSERT INTO summonings(id, familiar_id, engine, model, cwd, isolation, pid, started)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![summoning_id, familiar_id, engine, model, cwd, isolation, pid, now()],
    )?;
    Ok(summoning_id)
}

/// Close a summoning. `reason` is one of quit | banished | crashed | restored (§9).
pub fn close(db: &Db, summoning_id: &str, reason: &str) -> Result<()> {
    db.conn()?.execute(
        "UPDATE summonings SET ended = ?2, exit_reason = ?3 WHERE id = ?1 AND ended IS NULL",
        rusqlite::params![summoning_id, now(), reason],
    )?;
    Ok(())
}

/// Summonings still recorded as live.
///
/// After a restart this is a lie by definition — those processes died with the application — so
/// the caller closes them. Kept as a query rather than folded into recovery because the restore
/// banner in §6.1 needs the same list.
pub fn live(db: &Db) -> Result<Vec<(String, String)>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare("SELECT id, familiar_id FROM summonings WHERE ended IS NULL")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

/// Close everything left open by an earlier run of the application.
pub fn recover(db: &Db) -> Result<usize> {
    let stranded = live(db)?;
    for (summoning_id, _) in &stranded {
        close(db, summoning_id, "crashed")?;
    }
    if !stranded.is_empty() {
        tracing::info!(count = stranded.len(), "closed summonings left open by an earlier stop");
    }
    Ok(stranded.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::familiars;

    fn db_with_familiar() -> Db {
        let db = Db::memory().expect("db");
        familiars::upsert(&db, "v", "Vellum", "quill", "/b/v.binding.md", "writ").expect("familiar");
        db
    }

    #[test]
    fn a_summoning_opens_live_and_closes_once() {
        let db = db_with_familiar();
        let s = open(&db, "v", "claude", "sonnet", "/tmp", "none", 4242).expect("open");
        assert_eq!(live(&db).expect("live").len(), 1);

        close(&db, &s, "banished").expect("close");
        assert!(live(&db).expect("live").is_empty());

        // Closing again must not move the recorded reason: the first ending is the real one.
        close(&db, &s, "crashed").expect("close again");
        let reason: String = db
            .conn()
            .expect("conn")
            .query_row("SELECT exit_reason FROM summonings WHERE id = ?1", [&s], |r| r.get(0))
            .expect("reason");
        assert_eq!(reason, "banished");
    }

    #[test]
    fn recovery_closes_what_an_earlier_run_left_open() {
        let db = db_with_familiar();
        open(&db, "v", "claude", "sonnet", "/tmp", "none", 1).expect("one");
        open(&db, "v", "claude", "sonnet", "/tmp", "none", 2).expect("two");

        assert_eq!(recover(&db).expect("recover"), 2);
        assert!(live(&db).expect("live").is_empty());
        // And it is idempotent, because the application may restart twice in a row.
        assert_eq!(recover(&db).expect("again"), 0);
    }
}
