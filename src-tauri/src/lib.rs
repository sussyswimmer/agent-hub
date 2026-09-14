//! The Tauri shell. Deliberately thin: everything worth testing is in `grimoire-core`
//! (DECISIONS.md 0001).

mod commands;
mod heartbeat;
mod roster;
mod summonings;

use std::sync::Arc;

use grimoire_core::{Db, Paths};
use tauri::{Emitter, Manager, RunEvent};

use summonings::Summonings;

pub struct AppState {
    pub paths: Paths,
    pub db: Db,
    pub roster: Arc<roster::Roster>,
    pub summonings: Arc<Summonings>,
    /// The seal's socket end, which every hook talks to (§6.4).
    pub seal: Arc<grimoire_core::seal::server::Server>,
    /// Kept alive for as long as the application is: dropping it stops the watch, and a
    /// `_watcher` that goes out of scope at the end of `setup` is a silent hot-reload failure.
    _watcher: Option<grimoire_core::binding::WatchHandle>,
}

/// The database, reachable from the quit paths.
///
/// Both of them run outside the window: `RunEvent::Exit` has no `State`, and the signal thread
/// is started before the application is built. Without this a clean quit could not record what
/// it stopped, and every shutdown would look to the next launch exactly like a crash.
static DB: std::sync::OnceLock<Db> = std::sync::OnceLock::new();

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,grimoire_core=debug".into()),
        )
        .try_init();

    // Held outside the builder so the shutdown paths below can reach it without going through
    // a window, which may already be gone by the time we are told to stop.
    let summonings = Arc::new(Summonings::default());
    watch_for_signals(Arc::clone(&summonings));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup({
            let summonings = Arc::clone(&summonings);
            move |app| {
                let paths = Paths::resolve()?;
                paths.ensure()?;
                let db = Db::open(&paths.db_file())?;

                // §10 Phase 3: a commission survives a restart with the correct status. Nothing
                // that was running can still be running — its process died with the application —
                // so those rows are closed as misfires that say why, which also frees the queue
                // they would otherwise block for ever.
                if let Err(e) = grimoire_core::commission::recover(&db) {
                    tracing::warn!(error = %e, "could not tidy up commissions from an earlier run");
                }
                if let Err(e) = grimoire_core::db::summonings::recover(&db) {
                    tracing::warn!(error = %e, "could not tidy up summonings from an earlier run");
                }

                // First run only: an empty folder gets the shipped bindings, so the application
                // opens with five familiars rather than an explanation of how to write one.
                // Never an overwrite — see `binding::seed`.
                let bindings_dir = paths.bindings();
                if grimoire_core::binding::seed::is_empty(&bindings_dir) {
                    match grimoire_core::binding::seed::place(&bindings_dir) {
                        Ok(names) if !names.is_empty() => {
                            tracing::info!(count = names.len(), "placed the shipped bindings")
                        }
                        Ok(_) => {}
                        Err(e) => tracing::warn!(error = %e, "could not place the shipped bindings"),
                    }
                }

                let roster = Arc::new(roster::Roster::default());
                roster.reload(&bindings_dir);

                // §6.4: the seal listens before any familiar can be summoned. A summoning that
                // started with no gate behind it would be a familiar acting unwatched.
                let seal = grimoire_core::seal::server::Server::start(
                    db.clone(),
                    summonings.sessions(),
                    &paths.seal_socket(),
                )?;
                // Anything left waiting across a restart is nobody's open question, and §6.4
                // gives it thirty minutes regardless. Swept now and then every minute.
                {
                    // The interface asks again when this fires; the rows themselves stay in one
                    // place (§6.4's queue is the database, not a copy in the window).
                    let handle = app.handle().clone();
                    seal.on_change(std::sync::Arc::new(move || {
                        let _ = handle.emit("seals-changed", ());
                    }));
                }
                seal.tick();
                seal.tick_forever(std::time::Duration::from_secs(60));

                // §4: the folder is watched and an edit reaches the rail without a restart.
                let watcher = {
                    let roster = Arc::clone(&roster);
                    let handle = app.handle().clone();
                    grimoire_core::binding::watch(&bindings_dir, move |paths| {
                        roster.refresh(&paths);
                        // Tell the interface to ask again, rather than pushing rows through the
                        // event: two copies of the roster would be two things to keep in step.
                        let _ = handle.emit("bindings-changed", ());
                    })
                    .inspect_err(|e| tracing::warn!(error = %e, "bindings will not hot-reload"))
                    .ok()
                };

                // §6.5: the heartbeat, ticking every five seconds for the life of the process.
                crate::heartbeat::Heart {
                    db: db.clone(),
                    summonings: Arc::clone(&summonings),
                    seal: Arc::clone(&seal),
                    roster: Arc::clone(&roster),
                }
                .start();

                // §6.7: "The app lives in the menu bar. Closing the window does not quit."
                if let Err(e) = menu_bar(app.handle()) {
                    // A study with no menu bar is still a study. Say so and carry on rather
                    // than refusing to start over an icon.
                    tracing::warn!(error = %e, "the menu bar could not be set up");
                }

                tracing::info!(home = %paths.home.display(), "grimoire ready");
                let _ = DB.set(db.clone());
                app.manage(AppState { paths, db, roster, summonings, seal, _watcher: watcher });
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::home_info,
            commands::workbench_read,
            commands::workbench_set_engine_path,
            commands::workbench_set_spend_cap,
            commands::workbench_delete_transcript,
            commands::workbench_restore_bindings,
            commands::list_familiars,
            commands::intake_for,
            commands::aether_for,
            commands::summon,
            commands::send_input,
            commands::resize_summoning,
            commands::banish,
            commands::live_summonings,
            commands::attach_summoning,
            commands::quit,
            commands::commission_create,
            commands::commissions_for,
            commands::ledger_summary,
            commands::ledger_events,
            commands::codex_for,
            commands::wards_for,
            commands::ward_create,
            commands::ward_set_enabled,
            commands::ward_delete,
            commands::seals_pending,
            commands::seal_decide,
        ])
        .build(tauri::generate_context!())
        .expect("Grimoire failed to start");

    // §6.1: every summoning gets the stop ladder before the process goes. Without this the
    // familiars outlive the application and go on working, unwatched.
    //
    // `RunEvent::Exit`, not a window event. A window's `Destroyed` event does not fire when the
    // process is asked to quit from outside, and closing the pty is not a substitute: it sends
    // the child a SIGHUP it is free to ignore, and any grandchild it started never sees even
    // that. Found by quitting the running application and reading the log, where the stop that
    // was supposed to have happened had left no trace at all.
    app.run(move |handle, event| {
        match event {
            RunEvent::Exit => summonings.banish_all(DB.get()),
            // §6.7: "Closing the window does not quit." The scheduler goes on ticking and the
            // familiars go on working — which is the point of a standing ward. Quit is explicit,
            // from the menu bar.
            RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } => {
                if label == "main"
                    && let Some(window) = handle.get_webview_window("main")
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            _ => {}
        }
    });
}

/// The menu-bar item, and the rule that closing the window is not quitting (§6.7).
///
/// Quit is explicit, from here, and it warns when familiars are still working — the window is
/// the only place that warning can be read, so quitting from the tray opens the window and asks
/// rather than stopping a dozen summonings on a single click.
fn menu_bar(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let open = MenuItem::with_id(app, "open", "Open the scriptorium", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Grimoire", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("grimoire")
        .icon(app.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(
            std::io::Error::other("no window icon to reuse"),
        ))?)
        .tooltip("Grimoire")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show(app),
            "quit" => {
                // Never straight to `exit`. The window is asked whether this is really wanted,
                // because live familiars are the one thing quitting throws away.
                show(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("quit-requested", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                show(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Stop every summoning when the process is asked to quit from outside.
///
/// Tauri's own exit event covers quitting from the interface; this covers `SIGTERM` from a
/// shell, a restart, or anything else that does not go through the window.
///
/// **The mask has to be set here, on the main thread, before anything else is spawned.**
/// `pthread_sigmask` is per-thread, and threads inherit the mask of whoever created them — so
/// blocking inside the waiter thread blocks it only there, the main thread keeps its default
/// disposition, and the process still dies instantly on `SIGTERM` with the waiter never
/// reached. That is exactly what happened the first time: the familiar survived only because
/// closing the pty happened to hang it up, and the log had no trace of the stop at all.
fn watch_for_signals(summonings: Arc<Summonings>) {
    // Safety: sigemptyset/sigaddset/pthread_sigmask operate on a signal set owned by this
    // stack frame. Blocking these signals process-wide is the documented precondition for
    // taking them synchronously with `sigwait` below.
    let set = unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::sigaddset(&mut set, libc::SIGHUP);
        if libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut()) != 0 {
            tracing::warn!("could not take over quit signals; familiars may outlive a kill");
            return;
        }
        set
    };

    std::thread::spawn(move || {
        // Safety: `set` is a valid signal set and `sig` an int we own; this thread inherited
        // the block above, so these signals are delivered here and nowhere else.
        unsafe {
            let mut sig: libc::c_int = 0;
            if libc::sigwait(&set, &mut sig) == 0 {
                tracing::info!(signal = sig, "asked to quit; stopping familiars");
                summonings.banish_all(DB.get());
                std::process::exit(0);
            }
        }
    });
}
