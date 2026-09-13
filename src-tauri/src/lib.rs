//! The Tauri shell. Deliberately thin: everything worth testing is in `grimoire-core`
//! (DECISIONS.md 0001).

mod commands;
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
    /// Kept alive for as long as the application is: dropping it stops the watch, and a
    /// `_watcher` that goes out of scope at the end of `setup` is a silent hot-reload failure.
    _watcher: Option<grimoire_core::binding::WatchHandle>,
}

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

                tracing::info!(home = %paths.home.display(), "grimoire ready");
                app.manage(AppState { paths, db, roster, summonings, _watcher: watcher });
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::home_info,
            commands::list_familiars,
            commands::intake_for,
            commands::summon,
            commands::send_input,
            commands::resize_summoning,
            commands::banish,
            commands::live_summonings,
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
    app.run(move |_handle, event| {
        if matches!(event, RunEvent::Exit) {
            summonings.banish_all();
        }
    });
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
                summonings.banish_all();
                std::process::exit(0);
            }
        }
    });
}
