use rusqlite::{params, Row};

use super::{now_iso, Db};
use crate::error::Result;
use crate::types::OutputFile;

fn row_to_output(r: &Row<'_>) -> rusqlite::Result<OutputFile> {
    Ok(OutputFile {
        id: r.get("id")?,
        run_id: r.get("run_id")?,
        agent_id: r.get("agent_id")?,
        path: r.get("path")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        created_at: r.get("created_at")?,
    })
}

const COLS: &str = "id, run_id, agent_id, path, kind, title, created_at";

pub fn list(db: &Db, agent_id: Option<&str>, run_id: Option<&str>) -> Result<Vec<OutputFile>> {
    let guard = db.conn()?;
    let mut sql = format!("SELECT {COLS} FROM outputs WHERE 1=1");
    let mut args: Vec<String> = Vec::new();
    if let Some(a) = agent_id {
        sql.push_str(" AND agent_id = ?");
        args.push(a.to_string());
    }
    if let Some(r) = run_id {
        sql.push_str(" AND run_id = ?");
        args.push(r.to_string());
    }
    sql.push_str(" ORDER BY created_at DESC");
    let mut stmt = guard.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), row_to_output)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn get(db: &Db, id: &str) -> Result<Option<OutputFile>> {
    use rusqlite::OptionalExtension;
    let guard = db.conn()?;
    Ok(guard
        .query_row(&format!("SELECT {COLS} FROM outputs WHERE id = ?1"), [id], row_to_output)
        .optional()?)
}

pub fn insert(db: &Db, run_id: &str, agent_id: &str, path: &str, kind: &str, title: &str) -> Result<String> {
    let id = super::ulid();
    let guard = db.conn()?;
    let now = now_iso();
    guard.execute(
        "INSERT INTO outputs(id, run_id, agent_id, path, kind, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, run_id, agent_id, path, kind, title, now],
    )?;
    Ok(id)
}
