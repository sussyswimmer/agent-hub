use rusqlite::{params, Row};

use super::{now_iso, Db};
use crate::error::Result;
use crate::types::Action;

fn row_to_action(r: &Row<'_>) -> rusqlite::Result<Action> {
    let payload: String = r.get("payload_json")?;
    let result: Option<String> = r.get("result_json")?;
    Ok(Action {
        id: r.get("id")?,
        run_id: r.get("run_id")?,
        agent_id: r.get("agent_id")?,
        kind: r.get("type")?,
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
        preview_md: r.get("preview_md")?,
        reason: r.get("reason")?,
        status: r.get("status")?,
        result: result.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: r.get("created_at")?,
    })
}

const COLS: &str = "id, run_id, agent_id, type, payload_json, preview_md, reason, status, result_json, created_at";

pub fn list(db: &Db, status: Option<&str>, run_id: Option<&str>) -> Result<Vec<Action>> {
    let guard = db.conn()?;
    let mut sql = format!("SELECT {COLS} FROM actions WHERE 1=1");
    let mut args: Vec<String> = Vec::new();
    if let Some(s) = status {
        sql.push_str(" AND status = ?");
        args.push(s.to_string());
    }
    if let Some(r) = run_id {
        sql.push_str(" AND run_id = ?");
        args.push(r.to_string());
    }
    sql.push_str(" ORDER BY created_at");
    let mut stmt = guard.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), row_to_action)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn pending_count(db: &Db, run_id: &str) -> Result<i64> {
    let guard = db.conn()?;
    Ok(guard.query_row(
        "SELECT COUNT(*) FROM actions WHERE run_id = ?1 AND status = 'pending'",
        [run_id],
        |r| r.get(0),
    )?)
}

pub fn set_status(db: &Db, id: &str, status: &str, result_json: Option<&str>) -> Result<()> {
    let guard = db.conn()?;
    guard.execute(
        "UPDATE actions SET status = ?2, result_json = COALESCE(?3, result_json), updated_at = ?4 WHERE id = ?1",
        params![id, status, result_json, now_iso()],
    )?;
    Ok(())
}

pub fn insert(db: &Db, run_id: &str, agent_id: &str, kind: &str, payload_json: &str, preview_md: &str, reason: Option<&str>) -> Result<String> {
    let id = super::ulid();
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT INTO actions(id, run_id, agent_id, type, payload_json, preview_md, reason, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?8)",
        params![id, run_id, agent_id, kind, payload_json, preview_md, reason, now],
    )?;
    Ok(id)
}
