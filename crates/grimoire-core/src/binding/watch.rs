//! Watching the bindings folder (§4: the app hot-reloads, no restart).

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};

use crate::binding::parse::is_binding_file;
use crate::error::{Error, Result};

/// How long to wait after the last filesystem event before re-reading.
///
/// An editor saving a file produces several events — a truncate, a write, sometimes a rename
/// over the top — and reading between them yields an empty or half-written file that would flash
/// a validation error into the rail for no reason. §12 gives 2s for a new binding to appear, so
/// there is plenty of room to wait a quarter of a second and be sure.
pub const DEBOUNCE: Duration = Duration::from_millis(250);

/// The live watch. Opaque on purpose, so `src-tauri` does not need `notify` as a dependency of
/// its own just to name the thing it has to keep alive.
pub type WatchHandle = notify::RecommendedWatcher;

/// Watch the bindings folder and call `on_change` with the paths that settled.
///
/// The callback receives only binding files, so the folder can hold notes and backups without
/// provoking a reload. A path that no longer exists is still reported: a deletion has to reach
/// the rail as much as an edit does, and the caller can tell them apart by looking.
///
/// Returns the watcher; dropping it stops the watch.
pub fn watch(
    folder: &Path,
    on_change: impl Fn(Vec<PathBuf>) + Send + 'static,
) -> Result<WatchHandle> {
    let (tx, rx) = mpsc::channel::<Event>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })
    .map_err(|e| Error::other(format!("could not watch the bindings folder: {e}")))?;

    watcher
        .watch(folder, RecursiveMode::NonRecursive)
        .map_err(|e| Error::other(format!("could not watch {}: {e}", folder.display())))?;

    std::thread::spawn(move || {
        loop {
            // Block for the first event, then gather everything that arrives within the debounce
            // so one save is one reload rather than three.
            let Ok(first) = rx.recv() else { return };
            let mut paths: Vec<PathBuf> = first.paths;
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(next) => paths.extend(next.paths),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }

            paths.retain(|p| is_binding_file(p));
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                on_change(paths);
            }
        }
    });

    Ok(watcher)
}
