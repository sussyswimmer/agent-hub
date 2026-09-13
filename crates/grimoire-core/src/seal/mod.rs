//! The seal: the gate between a familiar and the world (§6.4).
//!
//! A familiar in a pseudo-terminal performs its own writes; there is no byte on the wire to
//! intercept. So the gate is the engine's own pre-execution hook, which fires before every tool
//! call and obeys whatever the hook prints. See DECISIONS.md 0004 for the mechanism and the two
//! ways a careless version of it fails open.
//!
//! This module holds the parts that live in the application: the rows, the queue of requests
//! waiting on the owner, and the deadline after which an unanswered one is refused.

pub mod hook;
pub mod protocol;
pub mod server;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{Db, id, now};
use crate::error::{Error, Result};
use crate::ledger::{self, EventKind};

/// §6.4's kinds, which decide what the request shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SealKind {
    Write,
    Shell,
    Network,
    Destructive,
    Send,
    Reliquary,
}

/// How a request ended (§6.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Resolution {
    Sealed,
    /// Sealed, and not asked again for the rest of this commission (§6.4's middle button).
    SealedAlways,
    Refused,
    /// Nobody answered within §6.4's thirty minutes.
    TimedOut,
}

impl Resolution {
    /// Whether the action goes ahead.
    pub fn allows(self) -> bool {
        matches!(self, Resolution::Sealed | Resolution::SealedAlways)
    }

    fn as_str(self) -> &'static str {
        match self {
            Resolution::Sealed => "sealed",
            Resolution::SealedAlways => "sealed_always",
            Resolution::Refused => "refused",
            Resolution::TimedOut => "timed_out",
        }
    }
}

/// §6.4: "Seal requests time out after 30 minutes into `bind`."
pub const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// One request, as the queue shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Seal {
    pub id: String,
    pub commission_id: String,
    pub familiar_id: String,
    pub familiar_name: String,
    pub kind: SealKind,
    /// What is about to happen, in one line: the exact action and the exact target (§6.4).
    pub action: String,
    /// Why it stopped rather than proceeding.
    pub reason: String,
    /// The content about to be written, when there is any — shown as a diff (§6.4).
    pub preview: Option<String>,
    #[ts(type = "number")]
    pub raised: i64,
    #[ts(type = "number | null")]
    pub resolved: Option<i64>,
    pub resolution: Option<Resolution>,
}

/// What goes into the `seals` row's detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Detail {
    familiar_id: String,
    familiar_name: String,
    action: String,
    reason: String,
    preview: Option<String>,
}

/// What to put in front of the owner.
pub struct Raise<'a> {
    pub commission_id: &'a str,
    pub familiar_id: &'a str,
    pub familiar_name: &'a str,
    pub kind: SealKind,
    /// The exact action and the exact target, in one line (§6.4).
    pub action: &'a str,
    /// Why it stopped rather than proceeding.
    pub reason: &'a str,
    /// What is about to be written, or the command about to run.
    pub preview: Option<&'a str>,
}

/// Raise a request. Returns its id.
pub fn raise(db: &Db, r: Raise<'_>) -> Result<String> {
    let Raise { commission_id, familiar_id, familiar_name, kind, action, reason, preview } = r;
    let seal_id = id();
    let detail = Detail {
        familiar_id: familiar_id.to_string(),
        familiar_name: familiar_name.to_string(),
        action: action.to_string(),
        reason: reason.to_string(),
        preview: preview.map(str::to_string),
    };

    db.conn()?.execute(
        "INSERT INTO seals(id, commission_id, kind, detail_json, raised) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            seal_id,
            commission_id,
            serde_json::to_string(&kind)?.trim_matches('"'),
            serde_json::to_string(&detail)?,
            now(),
        ],
    )?;

    // The commission pauses while it waits (§6.2's lifecycle passes through `awaiting seal`).
    db.conn()?.execute(
        "UPDATE commissions SET status = 'awaiting_seal' WHERE id = ?1 AND status = 'running'",
        [commission_id],
    )?;

    ledger::append(
        db,
        EventKind::SealRaised,
        Some(familiar_id),
        Some(commission_id),
        serde_json::json!({ "seal_id": seal_id, "action": action, "reason": reason }),
    )?;
    Ok(seal_id)
}

/// Everything still waiting on the owner, oldest first.
pub fn pending(db: &Db) -> Result<Vec<Seal>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.commission_id, s.kind, s.detail_json, s.raised, s.resolved, s.resolution
         FROM seals s WHERE s.resolved IS NULL ORDER BY s.raised ASC, s.rowid ASC",
    )?;
    let rows = stmt.query_map([], row_to_seal)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn get(db: &Db, seal_id: &str) -> Result<Option<Seal>> {
    use rusqlite::OptionalExtension;
    let conn = db.conn()?;
    Ok(conn
        .query_row(
            "SELECT id, commission_id, kind, detail_json, raised, resolved, resolution
             FROM seals WHERE id = ?1",
            [seal_id],
            row_to_seal,
        )
        .optional()?)
}

/// Answer a request.
///
/// Refuses to move one that is already answered: a decision is made once, and a second click on
/// a stale queue must not overturn the first.
pub fn resolve(db: &Db, seal_id: &str, resolution: Resolution) -> Result<Seal> {
    let Some(seal) = get(db, seal_id)? else {
        return Err(Error::other(format!("there is no seal {seal_id}")));
    };
    if seal.resolved.is_some() {
        return Err(Error::other("that request has already been answered"));
    }

    db.conn()?.execute(
        "UPDATE seals SET resolved = ?2, resolution = ?3 WHERE id = ?1 AND resolved IS NULL",
        rusqlite::params![seal_id, now(), resolution.as_str()],
    )?;

    ledger::append(
        db,
        EventKind::SealResolved,
        Some(&seal.familiar_id),
        Some(&seal.commission_id),
        serde_json::json!({ "seal_id": seal_id, "resolution": resolution }),
    )?;

    // A request that was answered lets its commission carry on; one that timed out binds it
    // (§6.4), which is the breaker's `bind`: stopped, but waiting to be extended rather than
    // thrown away.
    let next_status = if resolution == Resolution::TimedOut { "queued" } else { "running" };
    db.conn()?.execute(
        "UPDATE commissions SET status = ?2 WHERE id = ?1 AND status = 'awaiting_seal'",
        rusqlite::params![seal.commission_id, next_status],
    )?;
    if resolution == Resolution::TimedOut {
        ledger::append(
            db,
            EventKind::BreakerTripped,
            Some(&seal.familiar_id),
            Some(&seal.commission_id),
            serde_json::json!({ "why": "a seal went unanswered for thirty minutes", "action": "bind" }),
        )?;
    }

    get(db, seal_id)?.ok_or_else(|| Error::other("the seal vanished while being answered"))
}

/// Whether this commission has been told not to ask again (§6.4's middle button).
///
/// Scoped to the commission, never wider. "Don't ask again" means for this piece of work, not
/// for this familiar and not for ever — a standing permission granted in a hurry is exactly what
/// the seal exists to prevent.
pub fn always_sealed(db: &Db, commission_id: &str, kind: SealKind) -> Result<bool> {
    let kind = serde_json::to_string(&kind)?.trim_matches('"').to_string();
    Ok(db.conn()?.query_row(
        "SELECT EXISTS(SELECT 1 FROM seals WHERE commission_id = ?1 AND kind = ?2
                       AND resolution = 'sealed_always')",
        rusqlite::params![commission_id, kind],
        |r| r.get(0),
    )?)
}

/// Answer anything that has been waiting longer than §6.4's thirty minutes.
///
/// Called on a tick and at startup. A request left open across a restart is not a request
/// anybody is still looking at, so it is closed the same way.
pub fn expire_stale(db: &Db) -> Result<Vec<String>> {
    let cutoff = now() - TIMEOUT.as_secs() as i64;
    let stale: Vec<String> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare("SELECT id FROM seals WHERE resolved IS NULL AND raised <= ?1")?;
        let rows = stmt.query_map([cutoff], |r| r.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    for seal_id in &stale {
        resolve(db, seal_id, Resolution::TimedOut)?;
    }
    if !stale.is_empty() {
        tracing::info!(count = stale.len(), "seal requests timed out and bound their commissions");
    }
    Ok(stale)
}

fn row_to_seal(r: &rusqlite::Row<'_>) -> rusqlite::Result<Seal> {
    let kind: String = r.get(2)?;
    let detail: String = r.get(3)?;
    let resolution: Option<String> = r.get(6)?;
    let d: Detail = serde_json::from_str(&detail).unwrap_or(Detail {
        familiar_id: String::new(),
        familiar_name: String::new(),
        action: String::new(),
        reason: String::new(),
        preview: None,
    });
    Ok(Seal {
        id: r.get(0)?,
        commission_id: r.get(1)?,
        familiar_id: d.familiar_id,
        familiar_name: d.familiar_name,
        kind: serde_json::from_str(&format!("\"{kind}\"")).unwrap_or(SealKind::Write),
        action: d.action,
        reason: d.reason,
        preview: d.preview,
        raised: r.get(4)?,
        resolved: r.get(5)?,
        resolution: resolution.and_then(|s| serde_json::from_str(&format!("\"{s}\"")).ok()),
    })
}

/// Which kind a decided action belongs to, for the queue's grouping.
pub fn kind_of(action: &crate::security::Action) -> SealKind {
    use crate::security::Action;
    match action {
        Action::Write { .. } => SealKind::Write,
        Action::Shell { command } => {
            let lower = command.to_ascii_lowercase();
            if lower.starts_with("rm ") || lower.contains("--force") || lower.starts_with("shred ") {
                SealKind::Destructive
            } else {
                SealKind::Shell
            }
        }
        Action::Network { .. } => SealKind::Network,
        Action::Send { .. } => SealKind::Send,
        Action::Read { .. } | Action::Unknown { .. } => SealKind::Shell,
    }
}
