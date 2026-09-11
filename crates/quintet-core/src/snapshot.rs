//! `# Relevant state` snapshots (CLAUDE.md §3.3 step 6). Named per agent in `state_snapshot:`.

use crate::db::Db;
use crate::error::Result;

pub fn state_snapshot(name: &str, db: &Db) -> Result<String> {
    match name {
        "research_recent" => research_recent(db),
        "college_tracker" => college_tracker(db),
        "scout_upcoming" => scout_upcoming(db),
        "school_next14" => school_next14(db),
        "tutor_weak_spots" => tutor_weak_spots(db),
        other => Ok(format!("(unknown snapshot `{other}`)")),
    }
}

fn rows(db: &Db, sql: &str, fmt: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<String>) -> Result<Vec<String>> {
    let guard = db.conn()?;
    let mut stmt = guard.prepare(sql)?;
    let out = stmt.query_map([], |r| fmt(r))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(out)
}

fn or_none(title: &str, lines: Vec<String>) -> String {
    if lines.is_empty() { format!("{title}: none yet.") } else { format!("{title}:\n{}", lines.iter().map(|l| format!("- {l}")).collect::<Vec<_>>().join("\n")) }
}

fn research_recent(db: &Db) -> Result<String> {
    let lines = rows(db, "SELECT COALESCE(title, url), url, COALESCE(grade,'?'), COALESCE(project,'-') FROM sources ORDER BY created_at DESC LIMIT 10", |r| {
        Ok(format!("[{}] {} — {} ({})", r.get::<_, String>(2)?, r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(3)?))
    })?;
    Ok(or_none("Recently saved sources", lines))
}

fn college_tracker(db: &Db) -> Result<String> {
    let lines = rows(db, "SELECT name, COALESCE(round,'?'), COALESCE(deadline_at,'?'), COALESCE(status,'?') FROM colleges ORDER BY deadline_at LIMIT 20", |r| {
        Ok(format!("{} · {} · due {} · {}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
    })?;
    Ok(or_none("Tracked colleges", lines))
}

fn scout_upcoming(db: &Db) -> Result<String> {
    let lines = rows(db, "SELECT name, COALESCE(deadline_at,'rolling'), COALESCE(deadline_tz,''), status, COALESCE(fit,0) FROM opportunities WHERE status NOT IN ('applied','skipped') AND (deadline_at IS NULL OR deadline_at >= date('now')) ORDER BY deadline_at LIMIT 20", |r| {
        Ok(format!("{} · deadline {} {} · {} · fit {}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?))
    })?;
    Ok(or_none("Open opportunities", lines))
}

fn school_next14(db: &Db) -> Result<String> {
    let lines = rows(db, "SELECT COALESCE(course,'?'), title, COALESCE(due_at,'?'), status, COALESCE(est_minutes,0) FROM school_items WHERE status != 'done' AND due_at IS NOT NULL AND due_at <= datetime('now', '+14 days') ORDER BY due_at LIMIT 40", |r| {
        Ok(format!("{} · {} · due {} · {} · est {} min", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?))
    })?;
    Ok(or_none("School items due in the next 14 days", lines))
}

fn tutor_weak_spots(db: &Db) -> Result<String> {
    let lines = rows(db, "SELECT COALESCE(course,'?'), topic, concept, error_type, count FROM weak_spots ORDER BY count DESC, last_seen DESC LIMIT 10", |r| {
        Ok(format!("{} · {} · {} · {} ×{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?))
    })?;
    Ok(or_none("Top weak spots", lines))
}
