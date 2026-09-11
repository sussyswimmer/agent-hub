use rusqlite::{params, Row};

use super::{now_iso, Db};
use crate::error::Result;
use crate::types::{Question, QuestionItem};

fn row_to_q(r: &Row<'_>) -> rusqlite::Result<Question> {
    let json: String = r.get("json")?;
    let answered: Option<String> = r.get("answered_json")?;
    Ok(Question {
        id: r.get("id")?,
        run_id: r.get("run_id")?,
        agent_id: r.get("agent_id")?,
        questions: serde_json::from_str::<Vec<QuestionItem>>(&json).unwrap_or_default(),
        answers: answered.and_then(|s| serde_json::from_str(&s).ok()),
        status: r.get("status")?,
        created_at: r.get("created_at")?,
    })
}

const COLS: &str = "id, run_id, agent_id, json, answered_json, status, created_at";

pub fn list(db: &Db, run_id: Option<&str>, status: Option<&str>) -> Result<Vec<Question>> {
    let guard = db.conn()?;
    let mut sql = format!("SELECT {COLS} FROM questions WHERE 1=1");
    let mut args: Vec<String> = Vec::new();
    if let Some(r) = run_id {
        sql.push_str(" AND run_id = ?");
        args.push(r.to_string());
    }
    if let Some(s) = status {
        sql.push_str(" AND status = ?");
        args.push(s.to_string());
    }
    sql.push_str(" ORDER BY created_at");
    let mut stmt = guard.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), row_to_q)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn pending_count(db: &Db, run_id: &str) -> Result<i64> {
    let guard = db.conn()?;
    Ok(guard.query_row(
        "SELECT COUNT(*) FROM questions WHERE run_id = ?1 AND status = 'pending'",
        [run_id],
        |r| r.get(0),
    )?)
}

pub fn answer(db: &Db, id: &str, answers_json: &str) -> Result<()> {
    let guard = db.conn()?;
    guard.execute(
        "UPDATE questions SET answered_json = ?2, status = 'answered', updated_at = ?3 WHERE id = ?1",
        params![id, answers_json, now_iso()],
    )?;
    Ok(())
}

pub fn mark_stale(db: &Db, run_id: &str) -> Result<usize> {
    let guard = db.conn()?;
    Ok(guard.execute(
        "UPDATE questions SET status = 'stale', updated_at = ?2 WHERE run_id = ?1 AND status = 'pending'",
        params![run_id, now_iso()],
    )?)
}

/// Used by tests and by the fake MCP path; the real writer is quintet-mcp.
pub fn insert(db: &Db, run_id: &str, agent_id: &str, items: &[QuestionItem]) -> Result<String> {
    let id = super::ulid();
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT INTO questions(id, run_id, agent_id, json, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
        params![id, run_id, agent_id, serde_json::to_string(items)?, now],
    )?;
    Ok(id)
}
