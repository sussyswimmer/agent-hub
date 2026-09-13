//! The Tauri shell. Deliberately thin: everything worth testing is in `grimoire-core`
//! (DECISIONS.md 0001).

mod commands;
mod roster;

use grimoire_core::types::FamiliarSummary;
use grimoire_core::{Db, Paths};
use tauri::Manager;

pub struct AppState {
    pub paths: Paths,
    pub db: Db,
    /// Phase 0 only. Phase 2 reads the bindings folder instead.
    pub roster: Vec<FamiliarSummary>,
}

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,grimoire_core=debug".into()),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = Paths::resolve()?;
            paths.ensure()?;
            let db = Db::open(&paths.db_file())?;
            tracing::info!(home = %paths.home.display(), "grimoire ready");
            app.manage(AppState { paths, db, roster: roster::placeholder() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::home_info, commands::list_familiars])
        .run(tauri::generate_context!())
        .expect("Grimoire failed to start");
}
