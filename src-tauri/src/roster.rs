//! The roster, read from `~/.grimoire/bindings` (§4).
//!
//! Held in memory and rebuilt when the folder changes, so the rail can be drawn without hitting
//! the disk on every frame. The watcher tells the interface something moved; the interface asks
//! for the roster again. Pushing whole rows through the event would mean two sources of truth.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use grimoire_core::binding::{Binding, load_folder, summarise};
use grimoire_core::types::FamiliarSummary;

#[derive(Default)]
pub struct Roster {
    bindings: Mutex<BTreeMap<String, Binding>>,
    folder: Mutex<PathBuf>,
}

impl Roster {
    /// Read the folder and keep what is there. Called at startup and after every change.
    pub fn reload(&self, folder: &Path) {
        if let Ok(mut f) = self.folder.lock() {
            *f = folder.to_path_buf();
        }
        let found = load_folder(folder);
        tracing::debug!(count = found.len(), "roster reloaded");
        if let Ok(mut b) = self.bindings.lock() {
            *b = found;
        }
    }

    /// Re-read only the files that changed, and forget any that have gone.
    ///
    /// Cheaper than a full reload, but more importantly it leaves every other familiar's row
    /// untouched — so saving one binding cannot make the whole rail flicker.
    pub fn refresh(&self, paths: &[PathBuf]) {
        let Ok(mut bindings) = self.bindings.lock() else { return };
        for path in paths {
            let id = grimoire_core::binding::id_for(path);
            if path.exists() {
                bindings.insert(id, grimoire_core::binding::load(path));
            } else {
                bindings.remove(&id);
            }
        }
    }

    /// The rows the rail draws, broken bindings included (§4).
    pub fn rows(&self) -> Vec<FamiliarSummary> {
        self.bindings
            .lock()
            .map(|b| b.values().map(summarise).collect())
            .unwrap_or_default()
    }

    /// One binding, for the commands that need its frontmatter or its writ.
    pub fn get(&self, id: &str) -> Option<Binding> {
        self.bindings.lock().ok()?.get(id).cloned()
    }
}
