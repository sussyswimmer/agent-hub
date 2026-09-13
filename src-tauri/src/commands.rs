//! IPC surface. Thin wrappers over grimoire-core; errors become strings the UI can show.

use grimoire_core::types::FamiliarSummary;
use tauri::State;

use crate::AppState;

type R<T> = std::result::Result<T, String>;

#[derive(serde::Serialize)]
pub struct HomeInfo {
    pub home: String,
    pub bindings: String,
    pub db_file: String,
    pub schema_version: i64,
}

#[tauri::command]
pub fn home_info(state: State<'_, AppState>) -> R<HomeInfo> {
    Ok(HomeInfo {
        home: state.paths.home.display().to_string(),
        bindings: state.paths.bindings().display().to_string(),
        db_file: state.paths.db_file().display().to_string(),
        schema_version: grimoire_core::db::migrations::version(&state.db).map_err(|e| e.to_string())?,
    })
}

/// Phase 0 draws the shell from a hardcoded roster; Phase 2 replaces this with the bindings
/// folder. The shape it returns is already the real one.
#[tauri::command]
pub fn list_familiars(state: State<'_, AppState>) -> R<Vec<FamiliarSummary>> {
    Ok(state.roster.clone())
}
