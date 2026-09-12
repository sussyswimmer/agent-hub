use rusqlite::{params, OptionalExtension, Row};

use super::{now_iso, ulid, Db};
use crate::error::{CoreError, Result};
use crate::types::{RunRow, RunStatus};

fn row_to_run(r: &Row<'_>) -> rusqlite::Result<RunRow> {
    let status: String = r.get("status")?;
    Ok(RunRow {
        id: r.get("id")?,
        agent_id: r.get("agent_id")?,
        trigger: r.get("trigger")?,
        status: RunStatus::parse(&status).unwrap_or(RunStatus::Failed),
        session_id: r.get("session_id")?,
        integrity_level: r.get::<_, Option<i64>>("integrity_level")?.map(|v| v as u8),
        intake_json: r.get("intake_json")?,
        task_title: r.get("task_title")?,
        started_at: r.get("started_at")?,
        ended_at: r.get("ended_at")?,
        cost_usd: r.get("cost_usd")?,
        tokens_in: r.get("tokens_in")?,
        tokens_out: r.get("tokens_out")?,
        turns: r.get("turns")?,
        error: r.get("error")?,
        summary: r.get("summary")?,
        pid: r.get("pid")?,
        log_path: r.get("log_path")?,
        output_dir: r.get("output_dir")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const COLS: &str = "id, agent_id, trigger, status, session_id, integrity_level, intake_json, task_title, started_at, ended_at, cost_usd, tokens_in, tokens_out, turns, error, summary, pid, log_path, output_dir, created_at, updated_at";

pub struct NewRun<'a> {
    pub agent_id: &'a str,
    pub trigger: &'a str,
    pub session_id: &'a str,
    pub integrity_level: Option<u8>,
    pub intake_json: Option<&'a str>,
    pub task_title: &'a str,
}

pub fn insert(db: &Db, new: &NewRun<'_>) -> Result<RunRow> {
    let id = ulid();
    let now = now_iso();
    {
        let guard = db.conn()?;
        guard.execute(
            "INSERT INTO runs(id, agent_id, trigger, status, session_id, integrity_level, intake_json, task_title, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, new.agent_id, new.trigger, new.session_id, new.integrity_level.map(i64::from), new.intake_json, new.task_title, now],
        )?;
    }
    get(db, &id)?.ok_or(CoreError::RunNotFound(id))
}

pub fn get(db: &Db, id: &str) -> Result<Option<RunRow>> {
    let guard = db.conn()?;
    Ok(guard
        .query_row(&format!("SELECT {COLS} FROM runs WHERE id = ?1"), [id], row_to_run)
        .optional()?)
}

pub fn list(db: &Db, agent_id: Option<&str>, status: Option<RunStatus>, limit: u32) -> Result<Vec<RunRow>> {
    let guard = db.conn()?;
    let mut sql = format!("SELECT {COLS} FROM runs WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(a) = agent_id {
        sql.push_str(" AND agent_id = ?");
        args.push(Box::new(a.to_string()));
    }
    if let Some(s) = status {
        sql.push_str(" AND status = ?");
        args.push(Box::new(s.as_str().to_string()));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    args.push(Box::new(i64::from(limit)));
    let mut stmt = guard.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), row_to_run)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn list_by_status(db: &Db, statuses: &[RunStatus]) -> Result<Vec<RunRow>> {
    let mut out = Vec::new();
    for s in statuses {
        out.extend(list(db, None, Some(*s), 10_000)?);
    }
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(out)
}

pub fn set_status(db: &Db, id: &str, status: RunStatus, error: Option<&str>) -> Result<()> {
    let guard = db.conn()?;
    let now = now_iso();
    let ended = if status.is_terminal() || matches!(status, RunStatus::WaitingUser | RunStatus::AwaitingApproval) {
        Some(now.clone())
    } else {
        None
    };
    guard.execute(
        "UPDATE runs SET status = ?2, error = COALESCE(?3, error), ended_at = COALESCE(?4, ended_at), updated_at = ?5 WHERE id = ?1",
        params![id, status.as_str(), error, ended, now],
    )?;
    Ok(())
}

pub fn mark_running(db: &Db, id: &str, pid: Option<u32>, log_path: &str, output_dir: &str) -> Result<()> {
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "UPDATE runs SET status = 'running', pid = ?2, log_path = ?3, output_dir = COALESCE(output_dir, ?5), started_at = COALESCE(started_at, ?4), ended_at = NULL, error = NULL, updated_at = ?4 WHERE id = ?1",
        params![id, pid.map(i64::from), log_path, now, output_dir],
    )?;
    Ok(())
}

pub struct Usage {
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub turns: Option<i64>,
    pub summary: Option<String>,
}

pub fn record_usage(db: &Db, id: &str, u: &Usage) -> Result<()> {
    let guard = db.conn()?;
    guard.execute(
        "UPDATE runs SET cost_usd = COALESCE(runs.cost_usd, 0) + COALESCE(?2, 0),
             tokens_in = COALESCE(runs.tokens_in, 0) + COALESCE(?3, 0),
             tokens_out = COALESCE(runs.tokens_out, 0) + COALESCE(?4, 0),
             turns = COALESCE(runs.turns, 0) + COALESCE(?5, 0),
             summary = COALESCE(?6, summary), pid = NULL, updated_at = ?7 WHERE id = ?1",
        params![id, u.cost_usd, u.tokens_in, u.tokens_out, u.turns, u.summary, now_iso()],
    )?;
    Ok(())
}

pub fn clear_pid(db: &Db, id: &str) -> Result<()> {
    let guard = db.conn()?;
    guard.execute("UPDATE runs SET pid = NULL, updated_at = ?2 WHERE id = ?1", params![id, now_iso()])?;
    Ok(())
}

pub fn insert_event(db: &Db, run_id: &str, seq: i64, kind: &str, json: &str) -> Result<()> {
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT OR IGNORE INTO run_events(id, run_id, seq, type, json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![ulid(), run_id, seq, kind, json, now],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct EventRow {
    pub seq: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub json: String,
    pub created_at: String,
}

pub fn events(db: &Db, run_id: &str, after_seq: i64) -> Result<Vec<EventRow>> {
    let guard = db.conn()?;
    let mut stmt = guard.prepare("SELECT seq, type, json, created_at FROM run_events WHERE run_id = ?1 AND seq > ?2 ORDER BY seq")?;
    let rows = stmt.query_map(params![run_id, after_seq], |r| Ok(EventRow { seq: r.get(0)?, kind: r.get(1)?, json: r.get(2)?, created_at: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn max_seq(db: &Db, run_id: &str) -> Result<i64> {
    let guard = db.conn()?;
    let v: Option<i64> = guard.query_row("SELECT MAX(seq) FROM run_events WHERE run_id = ?1", [run_id], |r| r.get(0))?;
    Ok(v.unwrap_or(0))
}
