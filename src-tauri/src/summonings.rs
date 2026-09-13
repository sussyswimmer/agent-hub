//! Live summonings, and the bridge between a pty and the webview.
//!
//! `grimoire-core` knows nothing about Tauri: its sink is a plain callback. This is where that
//! callback becomes a `tauri::ipc::Channel`, which is the streaming primitive — an event would
//! serialise through the global event bus and be delivered to every listener, while a channel
//! is a direct pipe to the one terminal that asked for it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use grimoire_core::summon::{PtySession, PtySize, Spawn, resolve, scrubbed_env, stop, usage};
use grimoire_core::types::Engine;
use grimoire_core::{Db, commission, db as gdb, ledger};
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
    /// Filled in by `commands::summon` from the binding, not by the front-end (§4).
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    /// From the binding. Recorded on the summoning and used to price the run (§6.9).
    #[serde(default)]
    pub model: Option<String>,
}

/// A summoning the application is holding, plus what it is working on.
struct Live {
    session: Arc<PtySession>,
    /// The row in `summonings`, so the exit can be recorded against it.
    summoning_id: String,
    /// The commission it is running, when it was started to do one.
    commission_id: Option<String>,
    /// The session id we gave the engine, which is how its transcript is found (§6.5).
    engine_session: String,
    model: String,
}

#[derive(Default)]
pub struct Summonings {
    live: Mutex<HashMap<String, Live>>,
}

impl Summonings {
    pub fn summon(
        &self,
        db: &Db,
        req: SummonArgs,
        workbench_path: Option<String>,
        cwd: std::path::PathBuf,
        channel: Channel<Emission>,
    ) -> Result<u32, String> {
        let SummonArgs { id, engine, args, cols, rows, model, .. } = req;
        if self.live.lock().map_err(poisoned)?.contains_key(&id) {
            return Err(format!("{id} is already summoned."));
        }

        let resolved = resolve(engine, workbench_path.as_deref(), std::env::var("PATH").ok().as_deref())
            .map_err(|e| e.0)?;

        // Name the session ourselves. The engine writes a transcript per session, and knowing
        // its name is the difference between reading exact token counts out of it and guessing
        // which of several files is ours (§6.5, and summon::usage).
        let engine_session = uuid_v4();
        let model = model.unwrap_or_else(|| "default".to_string());

        // A commission is optional: a familiar can be summoned just to be talked to. When there
        // is one waiting, this summoning takes the oldest — §6.2's queue, applied at the only
        // moment a familiar becomes free.
        let commission = commission::next_to_run(db, &id).map_err(|e| e.to_string())?;

        let mut args = args;
        args.push("--session-id".into());
        args.push(engine_session.clone());

        let out = channel.clone();
        let session = PtySession::spawn(
            Spawn {
                program: resolved.path().to_path_buf(),
                args,
                cwd: cwd.clone(),
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

        let summoning_id = gdb::summonings::open(
            db,
            &id,
            engine.binary(),
            &model,
            &cwd.display().to_string(),
            "none",
            pid,
        )
        .map_err(|e| e.to_string())?;
        let _ = gdb::familiars::touch_summoned(db, &id);
        let _ = ledger::append(
            db,
            ledger::EventKind::Summoned,
            Some(&id),
            commission.as_ref().map(|c| c.id.as_str()),
            serde_json::json!({ "pid": pid, "engine": engine.binary(), "model": model }),
        );

        let commission_id = commission.map(|c| c.id);
        if let Some(cid) = &commission_id
            && let Err(e) = commission::start(db, cid, &summoning_id)
        {
            tracing::warn!(error = %e, "could not mark the commission running");
        }

        self.live.lock().map_err(poisoned)?.insert(
            id.clone(),
            Live {
                session: Arc::clone(&session),
                summoning_id: summoning_id.clone(),
                commission_id: commission_id.clone(),
                engine_session: engine_session.clone(),
                model: model.clone(),
            },
        );

        // Watch for the child exiting so the interface can show it, rather than leaving a dead
        // terminal that merely looks idle.
        //
        // **Polls; must not call `wait()`.** `wait()` holds the child lock until the process
        // exits, and `stop` needs that same lock to walk the ladder — so a blocking waiter here
        // deadlocks every Banish, silently, for as long as the familiar is alive. Found by
        // pressing the button in the running application; no Rust test spawned a waiter, so
        // nothing caught it. Polling releases the lock between looks.
        let watch_db = db.clone();
        let watch_commission = commission_id.clone();
        let watch_session = engine_session.clone();
        let watch_model = model.clone();
        std::thread::spawn(move || {
            let mut code = None;
            let mut ticks = 0u32;
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
                // Read what the run has cost every couple of seconds while it is alive, so the
                // meters move during a commission rather than only at the end of one. The
                // numbers come from the engine's own transcript, not from the terminal (§6.5).
                ticks += 1;
                if ticks.is_multiple_of(20) {
                    record_usage(&watch_db, watch_commission.as_deref(), &watch_session, &watch_model);
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
            // The transcript is complete now, so this is the figure that stands.
            record_usage(&watch_db, watch_commission.as_deref(), &watch_session, &watch_model);
            let _ = channel.send(Emission::Ended { code });
        });

        Ok(pid)
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.with(id, |s| s.write(bytes).map_err(|e| e.to_string()))
    }

    /// The commission this familiar is currently working on, if any.
    pub fn commission_of(&self, id: &str) -> Option<String> {
        self.live.lock().ok()?.get(id)?.commission_id.clone()
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.with(id, |s| {
            s.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
        })
    }

    /// Walk the stop ladder, close the rows it was holding open, and forget the summoning.
    pub fn banish(&self, db: &Db, id: &str) -> Result<String, String> {
        let live = self.live.lock().map_err(poisoned)?.remove(id);
        let Some(live) = live else {
            return Err(format!("{id} is not summoned."));
        };
        let how = stop(&live.session).map_err(|e| e.to_string())?;
        self.close_rows(db, id, &live, "banished");
        Ok(format!("{how:?}").to_lowercase())
    }

    /// Record the end of a summoning: its usage, its row, and the fate of its commission.
    fn close_rows(&self, db: &Db, familiar_id: &str, live: &Live, reason: &str) {
        record_usage(db, live.commission_id.as_deref(), &live.engine_session, &live.model);
        let _ = gdb::summonings::close(db, &live.summoning_id, reason);
        let _ = ledger::append(
            db,
            ledger::EventKind::Banished,
            Some(familiar_id),
            live.commission_id.as_deref(),
            serde_json::json!({ "reason": reason }),
        );

        // A commission whose familiar has gone is over. Banished rather than done: nobody said
        // the work finished, only that it stopped, and recording it as done would be a claim
        // the application is in no position to make.
        if let Some(cid) = &live.commission_id
            && let Ok(Some(c)) = commission::get(db, cid)
            && c.status.is_live()
        {
            let _ = commission::finish(db, cid, commission::Status::Banished, Some(reason));
        }
    }

    pub fn live_ids(&self) -> Vec<String> {
        self.live.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default()
    }

    /// Stop everything. Called on quit, before the process goes, so nothing is orphaned (§6.1).
    pub fn banish_all(&self, db: Option<&Db>) {
        let sessions: Vec<(String, Live)> = match self.live.lock() {
            Ok(mut m) => m.drain().collect(),
            Err(_) => return,
        };
        for (id, live) in sessions {
            match stop(&live.session) {
                Ok(how) => tracing::info!(%id, ?how, "stopped on quit"),
                Err(e) => tracing::warn!(%id, error = %e, "could not stop cleanly on quit"),
            }
            // Best effort: the database may already be gone at the very end of a quit, and a
            // failure here must not stop the remaining familiars being killed.
            if let Some(db) = db {
                self.close_rows(db, &id, &live, "quit");
            }
        }
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&PtySession) -> Result<T, String>) -> Result<T, String> {
        let live = self.live.lock().map_err(poisoned)?;
        let entry = live.get(id).ok_or_else(|| format!("{id} is not summoned."))?;
        f(&entry.session)
    }
}

/// Read the engine's transcript and write what it says onto the commission (§6.5, §6.9).
///
/// Silent when there is nothing to read: a summoning with no commission has nowhere to put the
/// numbers, and a transcript that is not there yet simply has not been written. An absent figure
/// is honest; a fabricated one is not.
fn record_usage(db: &Db, commission_id: Option<&str>, engine_session: &str, model: &str) {
    let Some(cid) = commission_id else { return };
    let Some(u) = usage::for_session(engine_session) else { return };
    if u.turns == 0 {
        return;
    }
    let cost = ledger::cost::estimate(u.tokens, model);
    if let Err(e) = commission::record_usage(db, cid, u.tokens, u.turns, cost) {
        tracing::warn!(error = %e, "could not record what the run cost");
    }
}

/// A version-4 UUID, which is the shape `claude --session-id` insists on.
///
/// Hand-rolled rather than another dependency: it is sixteen random bytes with six bits set, and
/// the crate that does it would be the only thing it was needed for.
fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    getrandom_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 1
    let h = |r: &[u8]| r.iter().map(|x| format!("{x:02x}")).collect::<String>();
    format!("{}-{}-{}-{}-{}", h(&b[0..4]), h(&b[4..6]), h(&b[6..8]), h(&b[8..10]), h(&b[10..16]))
}

fn getrandom_bytes(out: &mut [u8]) {
    // `/dev/urandom` on the platforms Grimoire targets. A session id only has to be unique, not
    // unguessable, so a failure falls back to the clock rather than refusing to summon.
    use std::io::Read;
    if let Ok(mut f) = std::fs::File::open("/dev/urandom")
        && f.read_exact(out).is_ok()
    {
        return;
    }
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = ((seed >> (i % 8 * 8)) as u8) ^ (i as u8).wrapping_mul(31);
    }
}

fn poisoned<T>(_: T) -> String {
    "The summonings table was left in a broken state by an earlier panic. Restart Grimoire.".into()
}
