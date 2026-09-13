//! IPC commands. Each is a thin wrapper over quintet-core; errors become strings for the UI.

use quintet_core::db;
use quintet_core::types::{AgentDetail, AgentSummary, IntakeForm, PathsInfo, Preflight, Question, RunRow, RunStatus, StartRunArgs, TaskArgs, UiRow};
use tauri::State;

use crate::AppState;

type R<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn preflight(state: State<'_, AppState>) -> R<Option<Preflight>> {
    Ok(state.preflight.read().map_err(|_| "lock".to_string())?.clone())
}

#[tauri::command]
pub fn list_agents(state: State<'_, AppState>) -> R<Vec<AgentSummary>> {
    state.core.agent_summaries().map_err(err)
}

#[tauri::command]
pub fn get_agent(state: State<'_, AppState>, id: String) -> R<Option<AgentDetail>> {
    state.core.registry.detail(&id).map_err(err)
}

#[tauri::command]
pub fn start_run(state: State<'_, AppState>, args: StartRunArgs) -> R<RunRow> {
    state.core.runs.start(args).map_err(err)
}

#[tauri::command]
pub fn evaluate_intake(state: State<'_, AppState>, agent_id: String, task_text: String, partial: Option<serde_json::Map<String, serde_json::Value>>) -> R<IntakeForm> {
    state.core.evaluate_intake(&agent_id, &task_text, &partial.unwrap_or_default()).map_err(err)
}

#[tauri::command]
pub fn start_task(state: State<'_, AppState>, args: TaskArgs) -> R<RunRow> {
    state.core.start_task(args).map_err(err)
}

#[tauri::command]
pub fn list_questions(state: State<'_, AppState>, run_id: Option<String>, status: Option<String>) -> R<Vec<Question>> {
    state.core.list_questions(run_id.as_deref(), status.as_deref()).map_err(err)
}

#[tauri::command]
pub fn answer_questions(state: State<'_, AppState>, question_id: String, answers: serde_json::Map<String, serde_json::Value>) -> R<RunRow> {
    state.core.answer_questions(&question_id, &answers).map_err(err)
}

#[tauri::command]
pub fn cancel_run(state: State<'_, AppState>, id: String) -> R<()> {
    state.core.runs.cancel(&id).map_err(err)
}

#[tauri::command]
pub fn list_runs(state: State<'_, AppState>, agent_id: Option<String>, status: Option<String>, limit: Option<u32>) -> R<Vec<RunRow>> {
    let status = match status.as_deref() {
        Some(s) => Some(RunStatus::parse(s).ok_or_else(|| format!("unknown status {s}"))?),
        None => None,
    };
    db::runs::list(&state.core.db, agent_id.as_deref(), status, limit.unwrap_or(100)).map_err(err)
}

#[tauri::command]
pub fn get_run(state: State<'_, AppState>, id: String) -> R<Option<RunRow>> {
    db::runs::get(&state.core.db, &id).map_err(err)
}

#[tauri::command]
pub fn get_run_events(state: State<'_, AppState>, id: String, after_seq: Option<i64>) -> R<Vec<db::runs::EventRow>> {
    db::runs::events(&state.core.db, &id, after_seq.unwrap_or(0)).map_err(err)
}

/// The Chat rows for a run, rebuilt from persisted events (same mapping as the live stream).
#[tauri::command]
pub fn get_run_rows(state: State<'_, AppState>, id: String) -> R<Vec<UiRow>> {
    let events = db::runs::events(&state.core.db, &id, 0).map_err(err)?;
    Ok(quintet_core::stream::replay_rows(&events))
}

#[tauri::command]
pub fn get_paths(state: State<'_, AppState>) -> R<PathsInfo> {
    Ok(state.core.paths_info())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> R<Vec<(String, String)>> {
    db::settings::all(&state.core.db).map_err(err)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> R<()> {
    db::settings::set(&state.core.db, &key, &value).map_err(err)
}

/// Read a text file under ~/Quintet (logs, outputs, agent.md). Anything outside is refused.
#[tauri::command]
pub fn read_text_file(state: State<'_, AppState>, path: String) -> R<String> {
    let p = std::path::Path::new(&path);
    let home = state.core.paths.home.canonicalize().map_err(err)?;
    let canon = p.canonicalize().map_err(err)?;
    if !canon.starts_with(&home) {
        return Err("path is outside the Quintet folder".into());
    }
    std::fs::read_to_string(&canon).map_err(err)
}
