//! IPC surface. Thin wrappers over grimoire-core; errors become strings the UI can show.

use grimoire_core::binding::schema::IntakeField;
use grimoire_core::types::FamiliarSummary;
use tauri::State;
use tauri::ipc::Channel;

use crate::AppState;
use crate::summonings::{Emission, SummonArgs};

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

/// The rail's rows, read from `~/.grimoire/bindings`. A binding that failed to validate is in
/// here too, carrying its error (§4).
#[tauri::command]
pub fn list_familiars(state: State<'_, AppState>) -> R<Vec<FamiliarSummary>> {
    Ok(state.roster.rows())
}

/// The intake questions for one familiar, as its binding declares them (§6.2).
#[tauri::command]
pub fn intake_for(state: State<'_, AppState>, id: String) -> R<Vec<IntakeField>> {
    let binding = state.roster.get(&id).ok_or_else(|| format!("There is no familiar called {id}."))?;
    Ok(binding.front.map(|f| f.intake).unwrap_or_default())
}

// ── Summoning ──────────────────────────────────────────────────────────────────────────

/// Start a familiar in a pty. `channel` is the pipe its output arrives on.
#[tauri::command]
pub fn summon(state: State<'_, AppState>, req: SummonArgs, channel: Channel<Emission>) -> R<u32> {
    if !req.engine.sealable() {
        // Belt and braces: the button is already disabled for these, but the gate that matters
        // is the one that cannot be reached by clicking around it. DECISIONS.md 0004.
        return Err(format!(
            "Only the claude engine can be sealed, so {} cannot be summoned. See DECISIONS.md.",
            req.engine.binary()
        ));
    }
    let cwd = grimoire_core::paths::expand(&req.cwd, &state.paths.bindings());
    state.summonings.summon(req, workbench_binary(&state), cwd, channel)
}

/// Typed input, as bytes. The familiar is reading keys, not lines.
#[tauri::command]
pub fn send_input(state: State<'_, AppState>, id: String, bytes: Vec<u8>) -> R<()> {
    state.summonings.write(&id, &bytes)
}

#[tauri::command]
pub fn resize_summoning(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> R<()> {
    state.summonings.resize(&id, cols, rows)
}

/// Walk the stop ladder. Returns which rung it took, for the ledger.
///
/// `async` deliberately: the ladder can take thirteen seconds on a familiar that ignores both
/// catchable signals, and a synchronous command would hold Tauri's main thread for all of it.
/// The window would be frozen for the whole stop — including the button that was just pressed.
#[tauri::command]
pub async fn banish(state: State<'_, AppState>, id: String) -> R<String> {
    state.summonings.banish(&id)
}

#[tauri::command]
pub fn live_summonings(state: State<'_, AppState>) -> R<Vec<String>> {
    Ok(state.summonings.live_ids())
}

/// The workbench's override for the engine binary, when one is set (§6.1).
fn workbench_binary(state: &State<'_, AppState>) -> Option<String> {
    state.db.setting("engine.claude.path").ok().flatten()
}
