//! The wards table, and the one thing that turns a ward's turn into a commission (§6.7).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{Db, id, now};
use crate::error::Result;

/// A standing ward: `{familiar, cron, prompt, intake, enabled}` (§6.7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Ward {
    pub id: String,
    pub familiar_id: String,
    /// A five-field crontab expression, read in the machine's own time zone.
    pub cron: String,
    /// Sent verbatim, every run. §6.7: no drift, no "improve the prompt" logic.
    pub prompt: String,
    /// The answers settled when the ward was written. There is nobody at the keyboard at three
    /// in the morning to ask again.
    #[ts(type = "unknown")]
    pub intake: serde_json::Value,
    pub enabled: bool,
    /// When it last came round, whether or not that turn became a commission.
    #[ts(type = "number | null")]
    pub last_run: Option<i64>,
    /// What happened that time, in a sentence a person reads (§3).
    pub last_result: Option<String>,
    /// When it comes round next, filled in for the panel rather than stored.
    #[ts(type = "number | null")]
    pub next_run: Option<i64>,
}

/// What one firing did, for the ledger and the panel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WardRun {
    /// It became a commission. Carries the id, so the caller can point at it.
    Commissioned(String),
    Skipped(super::Skip),
}

pub fn create(db: &Db, familiar_id: &str, cron: &str, prompt: &str, intake: &serde_json::Value) -> Result<Ward> {
    // Refuse a schedule that cannot be read rather than storing it and failing silently every
    // minute thereafter. The error names what to write instead.
    super::parse(cron)?;

    let ward = Ward {
        id: id(),
        familiar_id: familiar_id.to_string(),
        cron: cron.trim().to_string(),
        prompt: prompt.to_string(),
        intake: intake.clone(),
        enabled: true,
        // A ward is due relative to when it last ran, and one that has never run has no such
        // moment — so it is set out from now. Without this a new ward would never be due at
        // all, which is a much quieter failure than one that fires too early.
        last_run: Some(now()),
        last_result: None,
        next_run: None,
    };

    db.conn()?.execute(
        "INSERT INTO wards(id, familiar_id, cron, prompt, intake_json, enabled, last_run)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
        rusqlite::params![
            ward.id,
            ward.familiar_id,
            ward.cron,
            ward.prompt,
            serde_json::to_string(&ward.intake).unwrap_or_else(|_| "{}".into()),
            ward.last_run,
        ],
    )?;
    Ok(with_next(ward))
}

pub fn for_familiar(db: &Db, familiar_id: &str) -> Result<Vec<Ward>> {
    read(db, "WHERE familiar_id = ?1 ORDER BY rowid", rusqlite::params![familiar_id])
}

/// Every ward that could fire — the scheduler's list, so disabled ones never reach it.
pub fn enabled(db: &Db) -> Result<Vec<Ward>> {
    read(db, "WHERE enabled = 1 ORDER BY rowid", rusqlite::params![])
}

pub fn get(db: &Db, ward_id: &str) -> Result<Option<Ward>> {
    Ok(read(db, "WHERE id = ?1", rusqlite::params![ward_id])?.into_iter().next())
}

pub fn set_enabled(db: &Db, ward_id: &str, enabled: bool) -> Result<()> {
    db.conn()?
        .execute("UPDATE wards SET enabled = ?2 WHERE id = ?1", rusqlite::params![ward_id, enabled])?;
    Ok(())
}

pub fn delete(db: &Db, ward_id: &str) -> Result<()> {
    // The commissions it made stay: they are what it did, and the ledger is append-only (§6.9).
    db.conn()?.execute("UPDATE commissions SET ward_id = NULL WHERE ward_id = ?1", rusqlite::params![ward_id])?;
    db.conn()?.execute("DELETE FROM wards WHERE id = ?1", rusqlite::params![ward_id])?;
    Ok(())
}

/// Record what a turn came to, whether or not it became a commission.
///
/// **A skipped turn is a turn.** §6.7 says a ward whose familiar is busy "skips that run" — that
/// occurrence is spent, and the ward comes round again at its next scheduled time. Leaving the
/// clock alone instead means it is due on every tick from then on: a busy familiar produced
/// thirty-three skips in two and a half minutes, one per heartbeat, each one a write. It never
/// queued anything, which is the rule that matters, but "skipped 30 times" in §6.7 means thirty
/// days of a daily ward, not thirty seconds of one.
///
/// What differs between the two outcomes is `last_result`, which is what the panel reads.
pub fn record(db: &Db, ward_id: &str, _outcome: &WardRun, said: &str) -> Result<()> {
    db.conn()?.execute(
        "UPDATE wards SET last_run = ?2, last_result = ?3 WHERE id = ?1",
        rusqlite::params![ward_id, now(), said],
    )?;
    Ok(())
}

/// Turn a ward's turn into a queued commission, carrying its ward id.
///
/// The prompt goes through untouched. §6.7 says "the prompt is sent verbatim every run", and the
/// intake answers were settled when the ward was written — there is nobody at the keyboard at
/// three in the morning to ask again.
pub fn commission(db: &Db, ward: &Ward) -> Result<String> {
    let created = crate::commission::create(db, &ward.familiar_id, &ward.prompt, &ward.intake)?;
    db.conn()?.execute(
        "UPDATE commissions SET ward_id = ?2 WHERE id = ?1",
        rusqlite::params![created.id, ward.id],
    )?;
    Ok(created.id)
}

fn with_next(mut ward: Ward) -> Ward {
    ward.next_run = super::next_after(&ward.cron, ward.last_run.unwrap_or_else(now)).ok().flatten();
    ward
}

fn read(db: &Db, where_clause: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<Ward>> {
    let conn = db.conn()?;
    let sql = format!(
        "SELECT id, familiar_id, cron, prompt, intake_json, enabled, last_run, last_result
         FROM wards {where_clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |r| {
        Ok(Ward {
            id: r.get(0)?,
            familiar_id: r.get(1)?,
            cron: r.get(2)?,
            prompt: r.get(3)?,
            intake: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(serde_json::Value::Null),
            enabled: r.get::<_, i64>(5)? != 0,
            last_run: r.get(6)?,
            last_result: r.get(7)?,
            next_run: None,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map(|wards| wards.into_iter().map(with_next).collect())
        .map_err(Into::into)
}
