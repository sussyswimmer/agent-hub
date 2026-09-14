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
use grimoire_core::seal::server::{Sessions, Summoned};
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

/// Where a summoning's output is currently going.
///
/// A slot rather than the channel itself, because the terminal that asked for the output is not
/// the same object for the life of the summoning: React unmounts the pane when you look at
/// another familiar and mounts a fresh one when you come back. The pty does not care — it is
/// still running — so the outlet has to be swappable, and [`Summonings::attach`] swaps it.
type Outlet = Arc<Mutex<Option<Channel<Emission>>>>;

/// Send to whichever terminal is currently attached, if any.
///
/// Nothing is buffered while no one is listening. A pty is a stream, not a log: bytes written
/// while the pane was closed are gone, and pretending otherwise would mean an unbounded buffer
/// per familiar for output nobody asked to keep.
fn emit(outlet: &Outlet, emission: Emission) {
    if let Ok(slot) = outlet.lock()
        && let Some(channel) = slot.as_ref()
    {
        let _ = channel.send(emission);
    }
}

/// A summoning the application is holding, plus what it is working on.
struct Live {
    session: Arc<PtySession>,
    /// The terminal currently showing this summoning, swapped on re-attach.
    outlet: Outlet,
    /// The row in `summonings`, so the exit can be recorded against it.
    summoning_id: String,
    /// The commission it is running, when it was started to do one.
    commission_id: Option<String>,
    /// The session id we gave the engine, which is how its transcript is found (§6.5).
    engine_session: String,
    model: String,
    /// When a byte last came out of the pty. §6.5's stall detection is "no output *and* no token
    /// movement", and this is the first half.
    last_output: Arc<Mutex<std::time::Instant>>,
    /// When the commission started, for the minutes meter.
    started: std::time::Instant,
    /// What the breaker has already done about this commission, so it does not do it twice.
    breaker: Arc<Mutex<grimoire_core::breaker::Done>>,
    /// Whether a stall has already been raised, so it is raised once and not every tick.
    stalled: Arc<Mutex<bool>>,
}

/// Where one familiar's meters are read from.
pub struct AetherSource {
    pub engine_session: String,
    pub elapsed: std::time::Duration,
}

/// One live summoning, as the heartbeat needs to see it.
pub struct Beat {
    pub familiar_id: String,
    pub commission_id: String,
    pub engine_session: String,
    pub model: String,
    pub started: std::time::Instant,
    pub quiet_for: std::time::Duration,
    pub done: grimoire_core::breaker::Done,
    pub stall_raised: bool,
}

#[derive(Default)]
pub struct Summonings {
    live: Mutex<HashMap<String, Live>>,
    /// What the seal needs to judge each live session, keyed by the engine session id the hook
    /// reports. Shared with the seal's server rather than copied, so a familiar's autonomy
    /// cannot be stale by the time one of its tool calls is judged.
    sessions: Sessions,
}

impl Summonings {
    pub fn sessions(&self) -> Sessions {
        Arc::clone(&self.sessions)
    }
}

impl Summonings {
    #[allow(clippy::too_many_arguments)]
    pub fn summon(
        &self,
        db: &Db,
        req: SummonArgs,
        workbench_path: Option<String>,
        cwd: std::path::PathBuf,
        seal: &Seal,
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

        // §6.4: install the seal for this summoning. The settings file is written per summoning
        // and named on the command line, so the hook is configuration *outside* the
        // conversation — there is no prompt, tool argument or writ that can reach it.
        //
        // `--setting-sources ''` keeps the owner's own engine settings out of an agent run
        // (§11), and would otherwise be where a leftover permission could quietly widen things.
        match install_hook(&seal.settings_dir, &engine_session, &seal.socket) {
            Ok(settings) => {
                args.push("--settings".into());
                args.push(settings.display().to_string());
                args.push("--setting-sources".into());
                args.push(String::new());
            }
            Err(e) => {
                // Refuse to summon rather than start a familiar with no gate behind it. A
                // summoning without the seal is the one thing §11 exists to prevent.
                return Err(format!("The seal could not be installed for this summoning, so it was not started: {e}"));
            }
        }

        let outlet: Outlet = Arc::new(Mutex::new(Some(channel)));
        let out = Arc::clone(&outlet);
        let last_output = Arc::new(Mutex::new(std::time::Instant::now()));
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
            {
                let seen = Arc::clone(&last_output);
                Arc::new(move |bytes| {
                    if let Ok(mut at) = seen.lock() {
                        *at = std::time::Instant::now();
                    }
                    emit(&out, Emission::Output { bytes });
                })
            },
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

        // Tell the seal whose session this is, and what it is allowed to do, before the engine
        // has had a chance to call a single tool.
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(
                engine_session.clone(),
                Summoned {
                    familiar_id: id.clone(),
                    familiar_name: seal.familiar_name.clone(),
                    commission_id: commission_id.clone(),
                    autonomy: seal.autonomy,
                    bounds: seal.bounds.clone(),
                    workspace: cwd.clone(),
                },
            );
        }

        self.live.lock().map_err(poisoned)?.insert(
            id.clone(),
            Live {
                session: Arc::clone(&session),
                outlet: Arc::clone(&outlet),
                summoning_id: summoning_id.clone(),
                commission_id: commission_id.clone(),
                engine_session: engine_session.clone(),
                model: model.clone(),
                last_output: Arc::clone(&last_output),
                started: std::time::Instant::now(),
                breaker: Arc::default(),
                stalled: Arc::default(),
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
        let watch_outlet = Arc::clone(&outlet);
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
            emit(&watch_outlet, Emission::Ended { code });
        });

        Ok(pid)
    }

    /// Point a freshly-mounted terminal at a summoning that is already running.
    ///
    /// The window's idea of what is live is rebuilt from the backend rather than remembered,
    /// because it cannot be remembered: looking at another familiar unmounts the pane and the
    /// next mount starts from nothing. Without this, a familiar you walked away from came back
    /// looking dormant while its engine was still running — unbanishable, because the button
    /// offered to summon it, and unsummonable, because the backend knew better. Found by
    /// clicking away from a live Tally and back.
    ///
    /// Returns false when this familiar is not summoned, which is the ordinary case and not an
    /// error: most familiars are dormant most of the time.
    pub fn attach(&self, id: &str, channel: Channel<Emission>) -> Result<bool, String> {
        let live = self.live.lock().map_err(poisoned)?;
        let Some(entry) = live.get(id) else { return Ok(false) };
        *entry.outlet.lock().map_err(poisoned)? = Some(channel);
        Ok(true)
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.with(id, |s| s.write(bytes).map_err(|e| e.to_string()))
    }

    /// What the meters need: whose transcript to read, and how long it has been going.
    pub fn aether_source(&self, familiar_id: &str) -> Option<AetherSource> {
        let live = self.live.lock().ok()?;
        let l = live.get(familiar_id)?;
        // A summoning with no commission has nothing to meter: §6.5 budgets a commission, not a
        // familiar, and a terminal someone is simply typing into is not spending a budget.
        l.commission_id.as_ref()?;
        Some(AetherSource { engine_session: l.engine_session.clone(), elapsed: l.started.elapsed() })
    }

    /// Every live summoning that is running a commission, as the heartbeat needs to see it.
    ///
    /// A snapshot rather than a borrow: the heartbeat reads transcripts and may take seconds,
    /// and holding the registry's lock across that would block every summon, banish and
    /// keystroke in the application for as long as it took.
    pub fn beats(&self) -> Vec<Beat> {
        let Ok(live) = self.live.lock() else { return Vec::new() };
        live.iter()
            .filter_map(|(familiar_id, l)| {
                let commission_id = l.commission_id.clone()?;
                let quiet_for = l
                    .last_output
                    .lock()
                    .ok()
                    .map(|at| at.elapsed())
                    .unwrap_or_default();
                Some(Beat {
                    familiar_id: familiar_id.clone(),
                    commission_id,
                    engine_session: l.engine_session.clone(),
                    model: l.model.clone(),
                    started: l.started,
                    quiet_for,
                    done: l.breaker.lock().map(|d| *d).unwrap_or_default(),
                    stall_raised: l.stalled.lock().map(|s| *s).unwrap_or(false),
                })
            })
            .collect()
    }

    /// Remember what the breaker did, so the next tick does not do it again.
    pub fn note_breaker(&self, familiar_id: &str, done: grimoire_core::breaker::Done) {
        if let Ok(live) = self.live.lock()
            && let Some(l) = live.get(familiar_id)
            && let Ok(mut d) = l.breaker.lock()
        {
            *d = done;
        }
    }

    /// Remember that a stall has been raised, so it is raised once rather than every five seconds.
    pub fn note_stalled(&self, familiar_id: &str, stalled: bool) {
        if let Ok(live) = self.live.lock()
            && let Some(l) = live.get(familiar_id)
            && let Ok(mut s) = l.stalled.lock()
        {
            *s = stalled;
        }
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
        // Forget the session first. A hook arriving after its familiar has gone must find
        // nothing rather than a stale entry, and an unrecognised session is refused (§6.4).
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&live.engine_session);
        }
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

/// What the seal needs to know about a summoning before it starts.
pub struct Seal {
    pub familiar_name: String,
    pub autonomy: grimoire_core::types::Autonomy,
    pub bounds: grimoire_core::binding::schema::Bounds,
    pub socket: std::path::PathBuf,
    pub settings_dir: std::path::PathBuf,
}

/// Write the settings file that installs the seal's hook for one summoning.
///
/// Named after the session so two familiars running at once cannot overwrite each other's, and
/// written fresh every time: a file left behind by an older version would install an older gate.
fn install_hook(
    dir: &std::path::Path,
    engine_session: &str,
    socket: &std::path::Path,
) -> std::io::Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir)?;
    let exe = std::env::current_exe()?;
    let command = format!("{} seal-hook {}", shell_quote(&exe.display().to_string()), shell_quote(&socket.display().to_string()));
    let settings = grimoire_core::seal::hook::settings_json(&command);

    let path = dir.join(format!("{engine_session}.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(&settings)?)?;
    Ok(path)
}

/// Quote a path for the shell the engine runs hook commands through.
fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_alphanumeric() || "/._-".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
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
