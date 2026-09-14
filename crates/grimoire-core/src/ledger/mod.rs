//! The ledger of ink: an append-only record of what happened and what it cost (§6.9).
//!
//! Append-only on purpose. A ledger you can edit is not a record, and the questions it exists to
//! answer — what did this familiar do, what has this week cost, which run went wrong — are all
//! questions about the past. Nothing here updates or deletes a row.
//!
//! **Cost is always an estimate and always says so.** §6.9: "Estimated cost is labelled as
//! estimated everywhere it appears. Never display it as a settled number, and never sum it into
//! anything that looks like a bill." That is enforced here by the type: money never leaves this
//! module as a bare number, only as an [`Estimate`], which knows it is one.

pub mod cost;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{Db, now};
use crate::error::Result;

/// What kind of thing happened (§6.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EventKind {
    Summoned,
    Banished,
    CommissionQueued,
    CommissionStarted,
    CommissionEnded,
    Usage,
    SealRaised,
    SealResolved,
    BreakerTripped,
    /// The breaker spoke to a familiar and let it carry on (§6.5).
    BreakerSteer,
    /// The breaker stopped its tool calls and asked whether to extend (§6.5).
    BreakerBind,
    /// The breaker ended the summoning — a budget, or the runaway guard (§6.5).
    BreakerBanish,
    /// Quiet for ten minutes, raised for the owner rather than acted on (§6.5).
    Stalled,
    /// A standing ward came round — commissioned, or skipped and why (§6.7).
    WardFired,
    Misfired,
}

impl EventKind {
    /// A line a person can read, for the activity list. The payload carries the detail.
    pub fn describe(self) -> &'static str {
        match self {
            EventKind::Summoned => "summoned",
            EventKind::Banished => "banished",
            EventKind::CommissionQueued => "commission queued",
            EventKind::CommissionStarted => "commission started",
            EventKind::CommissionEnded => "commission ended",
            EventKind::Usage => "usage recorded",
            EventKind::SealRaised => "seal raised",
            EventKind::SealResolved => "seal resolved",
            EventKind::BreakerTripped => "breaker tripped",
            EventKind::BreakerSteer => "steered",
            EventKind::BreakerBind => "bound",
            EventKind::BreakerBanish => "banished by the breaker",
            EventKind::Stalled => "stalled",
            EventKind::WardFired => "a standing ward came round",
            EventKind::Misfired => "misfired",
        }
    }
}

/// One row of the ledger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub at: i64,
    pub commission_id: Option<String>,
    pub familiar_id: Option<String>,
    pub kind: EventKind,
    /// Free-form detail, as JSON. Different per kind; the interface reads what it recognises.
    #[ts(type = "unknown")]
    pub payload: serde_json::Value,
}

/// Money, which is never a settled number here (§6.9).
///
/// A newtype rather than an `f64` so it cannot be added to something that is not an estimate,
/// or formatted without the word. Every path out of this module that carries a cost carries one
/// of these, which is what makes "labelled as estimated everywhere" a property of the code
/// rather than a thing to remember in each component.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Estimate {
    #[ts(type = "number")]
    pub usd: f64,
    /// Always true. Present so the front-end cannot render the number without meeting the flag,
    /// and so a future settled figure would be a visibly different shape.
    pub estimated: bool,
}

impl Estimate {
    pub fn usd(usd: f64) -> Self {
        Self { usd, estimated: true }
    }
    pub fn plus(self, other: Self) -> Self {
        Self::usd(self.usd + other.usd)
    }
}

/// Written out rather than derived. `#[derive(Default)]` sets the bool to `false`, which makes a
/// zero cost claim it is *not* an estimate — exactly the thing §6.9 forbids, on every commission
/// that has not spent anything yet, which is all of them at the moment they are placed. Found
/// when the front-end refused a fresh commission for failing its own `estimated: true` check.
impl Default for Estimate {
    fn default() -> Self {
        Self::usd(0.0)
    }
}

/// Tokens for one turn, as the engine reported them.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Tokens {
    #[ts(type = "number")]
    pub input: i64,
    #[ts(type = "number")]
    pub output: i64,
    /// Cache reads and writes, kept apart because they are priced differently and because a run
    /// that looks enormous is usually mostly cache.
    #[ts(type = "number")]
    pub cache_read: i64,
    #[ts(type = "number")]
    pub cache_write: i64,
}

impl Tokens {
    pub fn total(self) -> i64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
    pub fn plus(self, o: Self) -> Self {
        Self {
            input: self.input + o.input,
            output: self.output + o.output,
            cache_read: self.cache_read + o.cache_read,
            cache_write: self.cache_write + o.cache_write,
        }
    }
}

/// Append an event. The only way to write to the ledger.
pub fn append(
    db: &Db,
    kind: EventKind,
    familiar_id: Option<&str>,
    commission_id: Option<&str>,
    payload: serde_json::Value,
) -> Result<i64> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO ledger_events(at, commission_id, familiar_id, kind, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            now(),
            commission_id,
            familiar_id,
            serde_json::to_string(&kind)?.trim_matches('"'),
            serde_json::to_string(&payload)?,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// The most recent events, newest first.
pub fn recent(db: &Db, limit: i64) -> Result<Vec<Event>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, at, commission_id, familiar_id, kind, payload_json
         FROM ledger_events ORDER BY at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], row_to_event)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn row_to_event(r: &rusqlite::Row<'_>) -> rusqlite::Result<Event> {
    let kind: String = r.get(4)?;
    let payload: String = r.get(5)?;
    Ok(Event {
        id: r.get(0)?,
        at: r.get(1)?,
        commission_id: r.get(2)?,
        familiar_id: r.get(3)?,
        kind: serde_json::from_str(&format!("\"{kind}\"")).unwrap_or(EventKind::Usage),
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
    })
}

/// What one familiar has spent (§6.9: spend by familiar).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FamiliarSpend {
    pub familiar_id: String,
    #[ts(type = "number")]
    pub commissions: i64,
    pub tokens: Tokens,
    pub cost: Estimate,
    #[ts(type = "number")]
    pub seconds: i64,
}

/// What one day cost (§6.9: spend by day).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DaySpend {
    /// `YYYY-MM-DD`, in local time — the reader's day, not UTC's.
    pub day: String,
    #[ts(type = "number")]
    pub commissions: i64,
    pub tokens: Tokens,
    pub cost: Estimate,
}

/// Everything the ledger view draws.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LedgerSummary {
    pub by_familiar: Vec<FamiliarSpend>,
    pub by_day: Vec<DaySpend>,
    pub total: Estimate,
    pub tokens: Tokens,
    #[ts(type = "number")]
    pub commissions: i64,
}

/// Roll the commissions table up for the ledger view.
///
/// Reads from `commissions` rather than replaying `ledger_events`: the commission row is the
/// running total the breaker already maintains, so the two cannot disagree about what a run
/// cost. The event log is the narrative; the commission row is the arithmetic.
pub fn summary(db: &Db) -> Result<LedgerSummary> {
    let conn = db.conn()?;

    let mut by_familiar = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT familiar_id, COUNT(*), COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0),
                    COALESCE(SUM(est_cost_usd),0), COALESCE(SUM(COALESCE(ended, created) - created),0)
             FROM commissions GROUP BY familiar_id ORDER BY SUM(est_cost_usd) DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(FamiliarSpend {
                familiar_id: r.get(0)?,
                commissions: r.get(1)?,
                tokens: Tokens { input: r.get(2)?, output: r.get(3)?, cache_read: 0, cache_write: 0 },
                cost: Estimate::usd(r.get(4)?),
                seconds: r.get(5)?,
            })
        })?;
        for row in rows {
            by_familiar.push(row?);
        }
    }

    let mut by_day = Vec::new();
    {
        // `localtime` so a run at 23:30 lands on the day the person remembers doing it.
        let mut stmt = conn.prepare(
            "SELECT date(created, 'unixepoch', 'localtime') AS day, COUNT(*),
                    COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0), COALESCE(SUM(est_cost_usd),0)
             FROM commissions GROUP BY day ORDER BY day DESC LIMIT 30",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(DaySpend {
                day: r.get(0)?,
                commissions: r.get(1)?,
                tokens: Tokens { input: r.get(2)?, output: r.get(3)?, cache_read: 0, cache_write: 0 },
                cost: Estimate::usd(r.get(4)?),
            })
        })?;
        for row in rows {
            by_day.push(row?);
        }
    }

    let total = by_familiar.iter().fold(Estimate::default(), |a, f| a.plus(f.cost));
    let tokens = by_familiar.iter().fold(Tokens::default(), |a, f| a.plus(f.tokens));
    let commissions = by_familiar.iter().map(|f| f.commissions).sum();

    Ok(LedgerSummary { by_familiar, by_day, total, tokens, commissions })
}
