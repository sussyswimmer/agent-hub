//! Live summonings, and the bridge between a pty and the webview.
//!
//! `grimoire-core` knows nothing about Tauri: its sink is a plain callback. This is where that
//! callback becomes a `tauri::ipc::Channel`, which is the streaming primitive — an event would
//! serialise through the global event bus and be delivered to every listener, while a channel
//! is a direct pipe to the one terminal that asked for it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use grimoire_core::summon::{PtySession, PtySize, Spawn, resolve, scrubbed_env, stop};
use grimoire_core::types::Engine;
use tauri::ipc::Channel;

/// One chunk of terminal output on its way to xterm.js.
///
/// Bytes rather than a string: terminal output is not guaranteed to be valid UTF-8 and a chunk
/// boundary can fall inside a multi-byte character, so decoding here would corrupt it. xterm.js
/// takes a `Uint8Array` and does the stateful decoding itself.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Emission {
    Output { bytes: Vec<u8> },
    /// The pty closed. Nothing further will arrive on this channel.
    Ended { code: Option<u32> },
}

/// What the front-end asks for when it summons. One struct rather than eight parameters, and it
/// mirrors `SummonRequest` in src/lib/ipc.ts so the two sides read the same.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonArgs {
    pub id: String,
    pub engine: Engine,
    pub args: Vec<String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Default)]
pub struct Summonings {
    live: Mutex<HashMap<String, Arc<PtySession>>>,
}

impl Summonings {
    pub fn summon(
        &self,
        req: SummonArgs,
        workbench_path: Option<String>,
        cwd: std::path::PathBuf,
        channel: Channel<Emission>,
    ) -> Result<u32, String> {
        let SummonArgs { id, engine, args, cols, rows, .. } = req;
        if self.live.lock().map_err(poisoned)?.contains_key(&id) {
            return Err(format!("{id} is already summoned."));
        }

        let resolved = resolve(engine, workbench_path.as_deref(), std::env::var("PATH").ok().as_deref())
            .map_err(|e| e.0)?;

        let out = channel.clone();
        let session = PtySession::spawn(
            Spawn {
                program: resolved.path().to_path_buf(),
                args,
                cwd,
                env: scrubbed_env(std::env::vars(), []),
                size: PtySize { rows, cols, pixel_width: 0, pixel_height: 0 },
            },
            // Send failures are ignored on purpose: the only way this fails is the window
            // having gone, and a closed window is not a reason to tear down the familiar.
            Arc::new(move |bytes| {
                let _ = out.send(Emission::Output { bytes });
            }),
        )
        .map_err(|e| e.to_string())?;

        let pid = session.pid();
        let session = Arc::new(session);
        self.live.lock().map_err(poisoned)?.insert(id.clone(), Arc::clone(&session));

        // Watch for the child exiting so the interface can show it, rather than leaving a dead
        // terminal that merely looks idle.
        //
        // **Polls; must not call `wait()`.** `wait()` holds the child lock until the process
        // exits, and `stop` needs that same lock to walk the ladder — so a blocking waiter here
        // deadlocks every Banish, silently, for as long as the familiar is alive. Found by
        // pressing the button in the running application; no Rust test spawned a waiter, so
        // nothing caught it. Polling releases the lock between looks.
        std::thread::spawn(move || {
            let mut code = None;
            loop {
                match session.try_wait() {
                    Ok(Some(c)) => {
                        code = Some(c);
                        break;
                    }
                    Ok(None) => {}
                    // The session is gone from under us, which is itself the end.
                    Err(_) => break,
                }
                if session.drained() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            // Let the pump deliver whatever was still in flight before announcing the end.
            for _ in 0..50 {
                if session.drained() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let _ = channel.send(Emission::Ended { code });
        });

        Ok(pid)
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.with(id, |s| s.write(bytes).map_err(|e| e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.with(id, |s| {
            s.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
        })
    }

    /// Walk the stop ladder and forget the summoning.
    pub fn banish(&self, id: &str) -> Result<String, String> {
        let session = self.live.lock().map_err(poisoned)?.remove(id);
        let Some(session) = session else {
            return Err(format!("{id} is not summoned."));
        };
        let how = stop(&session).map_err(|e| e.to_string())?;
        Ok(format!("{how:?}").to_lowercase())
    }

    pub fn live_ids(&self) -> Vec<String> {
        self.live.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default()
    }

    /// Stop everything. Called on quit, before the process goes, so nothing is orphaned (§6.1).
    pub fn banish_all(&self) {
        let sessions: Vec<(String, Arc<PtySession>)> = match self.live.lock() {
            Ok(mut m) => m.drain().collect(),
            Err(_) => return,
        };
        for (id, session) in sessions {
            match stop(&session) {
                Ok(how) => tracing::info!(%id, ?how, "stopped on quit"),
                Err(e) => tracing::warn!(%id, error = %e, "could not stop cleanly on quit"),
            }
        }
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&PtySession) -> Result<T, String>) -> Result<T, String> {
        let live = self.live.lock().map_err(poisoned)?;
        let session = live.get(id).ok_or_else(|| format!("{id} is not summoned."))?;
        f(session)
    }
}

fn poisoned<T>(_: T) -> String {
    "The summonings table was left in a broken state by an earlier panic. Restart Grimoire.".into()
}
