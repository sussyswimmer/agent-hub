//! Commissions: a task given to a familiar, and the queue behind it (§6.2).
//!
//! The rule that shapes this module: **a familiar runs one commission at a time, and new ones
//! queue behind it, visibly** (§6.2). Two commissions running in one workspace would write over
//! each other, and a queue that is not visible is indistinguishable from a lost request.

pub mod prompt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{Db, id, now};
use crate::error::{Error, Result};
use crate::ledger::{self, EventKind};

/// §6.2's lifecycle: `queued → running → awaiting seal → running → done | banished | misfired`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Status {
    Queued,
    Running,
    AwaitingSeal,
    Done,
    Banished,
    /// It went wrong. The reason is on the row.
    Misfired,
}

impl Status {
    /// Whether this is a state the commission can still leave under its own steam.
    pub fn is_live(self) -> bool {
        matches!(self, Status::Queued | Status::Running | Status::AwaitingSeal)
    }

    /// Whether the familiar is occupied by it — which is what makes the next one queue.
    /// A queued commission is not occupying anything; that is the point of the queue.
    pub fn occupies_familiar(self) -> bool {
        matches!(self, Status::Running | Status::AwaitingSeal)
    }

    fn as_str(self) -> &'static str {
        match self {
            Status::Queued => "queued",
            Status::Running => "running",
            Status::AwaitingSeal => "awaiting_seal",
            Status::Done => "done",
            Status::Banished => "banished",
            Status::Misfired => "misfired",
        }
    }

    fn parse(s: &str) -> Status {
        match s {
            "running" => Status::Running,
            "awaiting_seal" => Status::AwaitingSeal,
            "done" => Status::Done,
            "banished" => Status::Banished,
            "misfired" => Status::Misfired,
            _ => Status::Queued,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Commission {
    pub id: String,
    pub familiar_id: String,
    pub summoning_id: Option<String>,
    /// The prompt as it will be sent, with `{{intake.*}}` already substituted.
    pub prompt: String,
    /// The raw answers, kept so a run can be repeated or inspected later.
    #[ts(type = "unknown")]
    pub intake: serde_json::Value,
    pub status: Status,
    #[ts(type = "number")]
    pub created: i64,
    #[ts(type = "number | null")]
    pub ended: Option<i64>,
    pub tokens: ledger::Tokens,
    #[ts(type = "number")]
    pub turns: i64,
    pub cost: ledger::Estimate,
    /// Why it misfired, when it did.
    pub note: Option<String>,
}

/// Place a commission. It is written as `queued`; whether it starts now is a separate question,
/// answered by [`next_to_run`].
pub fn create(
    db: &Db,
    familiar_id: &str,
    prompt: &str,
    intake: &serde_json::Value,
) -> Result<Commission> {
    let commission = Commission {
        id: id(),
        familiar_id: familiar_id.to_string(),
        summoning_id: None,
        prompt: prompt.to_string(),
        intake: intake.clone(),
        status: Status::Queued,
        created: now(),
        ended: None,
        tokens: Default::default(),
        turns: 0,
        cost: Default::default(),
        note: None,
    };

    db.conn()?.execute(
        "INSERT INTO commissions(id, familiar_id, prompt, intake_json, status, created)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            commission.id,
            commission.familiar_id,
            commission.prompt,
            serde_json::to_string(&commission.intake)?,
            Status::Queued.as_str(),
            commission.created,
        ],
    )?;

    ledger::append(
        db,
        EventKind::CommissionQueued,
        Some(familiar_id),
        Some(&commission.id),
        serde_json::json!({ "prompt": prompt }),
    )?;

    Ok(commission)
}

/// Every commission for one familiar, newest first.
pub fn for_familiar(db: &Db, familiar_id: &str) -> Result<Vec<Commission>> {
    let conn = db.conn()?;
    // Ordered by insertion, newest first. See the note on `next_to_run` for why not `created`.
    let mut stmt = conn.prepare(
        "SELECT id, familiar_id, summoning_id, prompt, intake_json, status, created, ended,
                tokens_in, tokens_out, turns, est_cost_usd
         FROM commissions WHERE familiar_id = ?1 ORDER BY rowid DESC",
    )?;
    let rows = stmt.query_map([familiar_id], row_to_commission)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn get(db: &Db, commission_id: &str) -> Result<Option<Commission>> {
    use rusqlite::OptionalExtension;
    let conn = db.conn()?;
    Ok(conn
        .query_row(
            "SELECT id, familiar_id, summoning_id, prompt, intake_json, status, created, ended,
                    tokens_in, tokens_out, turns, est_cost_usd
             FROM commissions WHERE id = ?1",
            [commission_id],
            row_to_commission,
        )
        .optional()?)
}

/// The commission that should start next for this familiar, if any.
///
/// `None` when the familiar is already busy — which is the whole of §6.2's one-at-a-time rule,
/// in one place, so no caller has to remember it.
///
/// **Order is insertion order (`rowid`), not `created`, and not the id.** §9 stores timestamps
/// in whole seconds, so several commissions placed in one burst share a `created` and cannot be
/// ordered by it. The id looks like it would serve: a ULID begins with its timestamp. But its
/// remainder is random, not monotonic, so two ULIDs minted in the same millisecond sort in an
/// arbitrary order — which a test caught doing exactly that. SQLite's `rowid` is assigned in
/// insertion order, which is precisely the order a queue owes its callers.
///
/// This relies on commissions never being deleted: `rowid` can be reused after the highest row
/// is removed. Nothing deletes them, and nothing should — the ledger and the history are built
/// on them being there.
pub fn next_to_run(db: &Db, familiar_id: &str) -> Result<Option<Commission>> {
    let all = for_familiar(db, familiar_id)?;
    if all.iter().any(|c| c.status.occupies_familiar()) {
        return Ok(None);
    }
    // Oldest queued first: a queue that serves the newest first is not a queue.
    Ok(all.into_iter().rfind(|c| c.status == Status::Queued))
}

/// How many are waiting behind the one that is running. Shown in the interface, because §6.2
/// wants the queue visible rather than merely correct.
pub fn queued_count(db: &Db, familiar_id: &str) -> Result<i64> {
    Ok(db.conn()?.query_row(
        "SELECT COUNT(*) FROM commissions WHERE familiar_id = ?1 AND status = 'queued'",
        [familiar_id],
        |r| r.get(0),
    )?)
}

/// Move a commission to `running` and tie it to the summoning that is doing the work.
pub fn start(db: &Db, commission_id: &str, summoning_id: &str) -> Result<()> {
    let Some(c) = get(db, commission_id)? else {
        return Err(Error::other(format!("no commission {commission_id}")));
    };
    if c.status != Status::Queued {
        return Err(Error::other(format!(
            "that commission is {:?}, not queued, so it cannot be started again",
            c.status
        )));
    }
    db.conn()?.execute(
        "UPDATE commissions SET status = 'running', summoning_id = ?2 WHERE id = ?1",
        rusqlite::params![commission_id, summoning_id],
    )?;
    ledger::append(
        db,
        EventKind::CommissionStarted,
        Some(&c.familiar_id),
        Some(commission_id),
        serde_json::json!({ "summoning_id": summoning_id }),
    )?;
    Ok(())
}

/// Finish a commission. `note` carries the reason when it did not go well.
pub fn finish(db: &Db, commission_id: &str, status: Status, note: Option<&str>) -> Result<()> {
    if status.is_live() {
        return Err(Error::other("finish needs a final status"));
    }
    let Some(c) = get(db, commission_id)? else {
        return Err(Error::other(format!("no commission {commission_id}")));
    };

    db.conn()?.execute(
        "UPDATE commissions SET status = ?2, ended = ?3 WHERE id = ?1",
        rusqlite::params![commission_id, status.as_str(), now()],
    )?;
    ledger::append(
        db,
        if status == Status::Misfired { EventKind::Misfired } else { EventKind::CommissionEnded },
        Some(&c.familiar_id),
        Some(commission_id),
        serde_json::json!({ "status": status, "note": note }),
    )?;
    Ok(())
}

/// Record what a turn cost. Adds to the running totals on the commission row, so the ledger's
/// arithmetic and the aether meters read from the same numbers.
pub fn record_usage(
    db: &Db,
    commission_id: &str,
    tokens: ledger::Tokens,
    turns: i64,
    cost: ledger::Estimate,
) -> Result<()> {
    let Some(c) = get(db, commission_id)? else {
        return Err(Error::other(format!("no commission {commission_id}")));
    };
    db.conn()?.execute(
        "UPDATE commissions
         SET tokens_in = ?2, tokens_out = ?3, turns = ?4, est_cost_usd = ?5
         WHERE id = ?1",
        rusqlite::params![
            commission_id,
            tokens.input + tokens.cache_read + tokens.cache_write,
            tokens.output,
            turns,
            cost.usd,
        ],
    )?;
    ledger::append(
        db,
        EventKind::Usage,
        Some(&c.familiar_id),
        Some(commission_id),
        serde_json::json!({ "tokens": tokens, "turns": turns, "cost": cost }),
    )?;
    Ok(())
}

/// Put right anything left mid-flight when the application stopped (§12 Phase 3: a commission
/// survives a restart with the correct status).
///
/// A commission cannot still be running: its process died with the application. Leaving the row
/// as `running` would show a familiar working for ever and would block its queue permanently, so
/// each one is closed as a misfire that says what happened. Queued commissions are untouched —
/// they never started, and they are still perfectly good requests.
pub fn recover(db: &Db) -> Result<Vec<String>> {
    let stranded: Vec<(String, String)> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, familiar_id FROM commissions WHERE status IN ('running', 'awaiting_seal')",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };

    for (id, familiar_id) in &stranded {
        db.conn()?.execute(
            "UPDATE commissions SET status = 'misfired', ended = ?2 WHERE id = ?1",
            rusqlite::params![id, now()],
        )?;
        ledger::append(
            db,
            EventKind::Misfired,
            Some(familiar_id),
            Some(id),
            serde_json::json!({
                "note": "Grimoire stopped while this was running, so the familiar went with it."
            }),
        )?;
    }

    if !stranded.is_empty() {
        tracing::info!(count = stranded.len(), "closed commissions stranded by an earlier stop");
    }
    Ok(stranded.into_iter().map(|(id, _)| id).collect())
}

fn row_to_commission(r: &rusqlite::Row<'_>) -> rusqlite::Result<Commission> {
    let intake: String = r.get(4)?;
    let status: String = r.get(5)?;
    let tokens_in: i64 = r.get(8)?;
    Ok(Commission {
        id: r.get(0)?,
        familiar_id: r.get(1)?,
        summoning_id: r.get(2)?,
        prompt: r.get(3)?,
        intake: serde_json::from_str(&intake).unwrap_or(serde_json::Value::Null),
        status: Status::parse(&status),
        created: r.get(6)?,
        ended: r.get(7)?,
        // `tokens_in` on the row is everything that went in, cache included; the split is kept
        // in the ledger event for a run that wants to look closer.
        tokens: ledger::Tokens { input: tokens_in, output: r.get(9)?, cache_read: 0, cache_write: 0 },
        turns: r.get(10)?,
        cost: ledger::Estimate::usd(r.get(11)?),
        note: None,
    })
}
