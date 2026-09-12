//! Tauri shell. Thin by design (ADR-0003): commands, events, notifications, vibrancy.
//! All behaviour lives in `quintet-core`.

mod commands;
mod events;
mod notify;
mod tray;
mod vibrancy;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use quintet_core::paths::QuintetPaths;
use quintet_core::registry::WatchHandle;
use quintet_core::runs::mcp_config::McpLauncher;
use quintet_core::runs::RunConfig;
use quintet_core::seed::SeedSource;
use quintet_core::types::Preflight;
use quintet_core::Core;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub core: Core,
    pub preflight: RwLock<Option<Preflight>>,
    pub watch: Mutex<Option<WatchHandle>>,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Where the shipped defaults are: the repo in dev, the bundle's resource dir in release
/// (Tauri maps `../agents-default` to `_up_/agents-default`).
fn seed_source(app: &tauri::AppHandle) -> SeedSource {
    if cfg!(debug_assertions) {
        return SeedSource::from_root(repo_root());
    }
    let res = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in [res.join("_up_"), res.clone()] {
        if candidate.join("agents-default").is_dir() {
            return SeedSource::from_root(candidate);
        }
    }
    SeedSource::from_root(res)
}

/// MCP launcher: dev → `bun mcp/src/index.ts` once `serve` exists; release → sidecar next to the app.
fn mcp_launcher() -> Option<McpLauncher> {
    if cfg!(debug_assertions) {
        let root = repo_root();
        if root.join("mcp/src/cli/serve.ts").is_file() {
            return Some(McpLauncher::dev(&root));
        }
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let sidecar = exe.parent()?.join("quintet-mcp");
    sidecar.is_file().then(|| McpLauncher::sidecar(&sidecar))
}

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,quintet_core=debug".into()))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = QuintetPaths::resolve()?;
            let seed_src = seed_source(&handle);
            let cfg = RunConfig { mcp: mcp_launcher(), ..RunConfig::default() };
            let sink = Arc::new(events::TauriSink { app: handle.clone() });
            // Core captures the tokio handle; build it inside the async runtime.
            let core = tauri::async_runtime::block_on(async { Core::init(paths, &seed_src, cfg, sink) })?;
            tracing::info!(home = %core.paths.home.display(), seeded = ?core.seed_report.agents_created, recovered = core.recovered.len(), "core ready");

            // Hot reload: registry changes → sidebar.
            let watch_app = handle.clone();
            let watch = core.registry.watch(move |_| {
                if let Some(state) = watch_app.try_state::<AppState>() {
                    if let Ok(summaries) = state.core.agent_summaries() {
                        let _ = watch_app.emit("registry://changed", summaries);
                    }
                }
            })?;

            app.manage(AppState { core, preflight: RwLock::new(None), watch: Mutex::new(Some(watch)) });

            // Preflight in the background; the UI shows a blocking banner until it passes.
            let pf_app = handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = pf_app.state::<AppState>();
                let report = quintet_core::preflight::preflight(&state.core.runs.config().claude_bin).await;
                if let Ok(mut slot) = state.preflight.write() { *slot = Some(report.clone()); }
                let _ = pf_app.emit("preflight://changed", report);
            });

            if let Some(win) = app.get_webview_window("main") {
                vibrancy::apply(&win);
            }
            tray::setup(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::preflight,
            commands::list_agents,
            commands::get_agent,
            commands::start_run,
            commands::cancel_run,
            commands::list_runs,
            commands::get_run,
            commands::get_run_events,
            commands::get_run_rows,
            commands::get_paths,
            commands::get_settings,
            commands::set_setting,
            commands::read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quintet");
}
