//! IPC surface. Thin wrappers over grimoire-core; errors become strings the UI can show.

use grimoire_core::binding::schema::IntakeField;
use grimoire_core::commission::Commission;
use grimoire_core::ledger::{Event, LedgerSummary};
use grimoire_core::commission::Status as CommissionStatus;
use grimoire_core::seal::{Resolution, Seal as GrimoireSeal};
use grimoire_core::types::{Aether, SigilState};
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
///
/// The binding says who a familiar *is*; it cannot say what it is doing. That comes from three
/// live sources — whether it has a process, what its commission is up to, and whether anything
/// of its is waiting on a seal — and it is overlaid here.
///
/// Until this existed every familiar reported `dormant` for ever, which made §7.4's six sigil
/// states and the whole of §8.3's floor decorative: the room drew a state table nothing in the
/// application could ever move. Found by summoning a familiar in the running binary and
/// watching it stay at the hearth.
#[tauri::command]
pub fn list_familiars(state: State<'_, AppState>) -> R<Vec<FamiliarSummary>> {
    let mut rows = state.roster.rows();
    let live: std::collections::HashSet<String> = state.summonings.live_ids().into_iter().collect();
    let waiting = grimoire_core::seal::pending(&state.db).unwrap_or_default();

    for row in &mut rows {
        // A binding that will not parse is already `misfired` and says why. Nothing about a
        // process changes that: there is no familiar here to be doing anything.
        if row.error.is_some() {
            continue;
        }

        let commission = grimoire_core::commission::for_familiar(&state.db, &row.id)
            .ok()
            .and_then(|rows| rows.into_iter().find(|c| c.status.is_live() || c.ended.is_some()));

        let summoned = live.contains(&row.id);
        let asking = waiting.iter().any(|s| s.familiar_id == row.id);

        (row.state, row.status) = match (&commission, summoned, asking) {
            // Anything waiting on you outranks everything else, because §8.4 makes it the one
            // question the floor has to answer at a glance.
            (_, _, true) => (SigilState::AwaitingSeal, "waiting on your seal".into()),
            (Some(c), true, _) if c.status == CommissionStatus::Running => {
                (SigilState::Working, "working".into())
            }
            (Some(c), true, _) if c.status == CommissionStatus::AwaitingSeal => {
                (SigilState::AwaitingSeal, "waiting on your seal".into())
            }
            (_, true, _) => (SigilState::Idle, "summoned, idle".into()),
            // Not summoned. How the last commission ended is the most recent true thing known
            // about it, and §8.3 draws both of these at its desk rather than at the hearth.
            (Some(c), false, _) if c.status == CommissionStatus::Misfired => (
                SigilState::Misfired,
                c.note.clone().unwrap_or_else(|| "the last commission misfired".into()),
            ),
            (Some(c), false, _) if c.status == CommissionStatus::Banished => {
                (SigilState::Banished, "banished".into())
            }
            _ => (SigilState::Dormant, "dormant".into()),
        };
    }
    Ok(rows)
}

/// The three meters for whatever this familiar is working on now (§6.5).
///
/// `None` when nothing is running, which is what the bar means by "no commission running" —
/// deliberately not a row of zeroes, which would read as a commission that has done nothing.
///
/// Tokens and turns come from the engine's own transcript (DECISIONS.md 0008); the minutes are
/// wall-clock since the commission started. The maxima come from the binding, so a familiar
/// with no budget shows a figure and no bar rather than a bar that is always empty.
#[tauri::command]
pub fn aether_for(state: State<'_, AppState>, id: String) -> R<Option<Aether>> {
    let Some(live) = state.summonings.aether_source(&id) else { return Ok(None) };
    let used = grimoire_core::summon::usage::for_session(&live.engine_session).unwrap_or_default();
    let budget = state.roster.get(&id).and_then(|b| b.front).map(|f| f.aether).unwrap_or_default();

    Ok(Some(Aether {
        tokens: used.tokens.total(),
        tokens_max: budget.tokens.filter(|t| *t > 0),
        turns: used.turns,
        turns_max: budget.turns.filter(|t| *t > 0),
        seconds: live.elapsed.as_secs() as i64,
        seconds_max: budget.minutes.filter(|m| *m > 0).map(|m| m * 60),
    }))
}

/// The intake questions for one familiar, as its binding declares them (§6.2).
#[tauri::command]
pub fn intake_for(state: State<'_, AppState>, id: String) -> R<Vec<IntakeField>> {
    let binding = state.roster.get(&id).ok_or_else(|| format!("There is no familiar called {id}."))?;
    Ok(binding.front.map(|f| f.intake).unwrap_or_default())
}

// ── Summoning ──────────────────────────────────────────────────────────────────────────

/// Make sure the familiar has a row before anything points at it.
///
/// `summonings` and `commissions` both carry a foreign key to `familiars`, and the roster is
/// read from disk rather than from the database — so a familiar that has never been given a
/// commission has no row, and summoning it failed with `FOREIGN KEY constraint failed`. That is
/// a true statement about SQLite and tells the owner nothing about their study (§12: a failure
/// says what happened and what to do). Found by summoning a freshly seeded Sconce in the
/// running application, which is the ordinary first thing anyone would do.
fn ensure_familiar(state: &State<'_, AppState>, binding: &grimoire_core::binding::Binding) -> R<()> {
    let front = binding.front.as_ref().ok_or_else(|| {
        format!(
            "{}'s binding does not load, so it cannot be given work. Fix the binding first.",
            binding.id
        )
    })?;
    grimoire_core::db::familiars::upsert(
        &state.db,
        &binding.id,
        &front.name,
        serde_json::to_string(&front.order).unwrap_or_default().trim_matches('"'),
        &binding.path.display().to_string(),
        &binding.writ,
    )
    .map_err(|e| e.to_string())
}

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
    // The writ and the flags are assembled here, not in the front-end. §4 says the writ is
    // "passed verbatim to the CLI as its system prompt", and the front-end has no business
    // holding it: it comes from the binding on disk, and the shortest path from that file to
    // the engine is the one least able to alter it on the way.
    let binding = state.roster.get(&req.id).ok_or_else(|| format!("There is no familiar called {}.", req.id))?;
    ensure_familiar(&state, &binding)?;
    let mut req = req;
    req.args = engine_args(&state, &binding);
    if req.model.is_none() {
        req.model = binding.front.as_ref().and_then(|f| f.model.clone());
    }

    let cwd = grimoire_core::paths::expand(&req.cwd, &state.paths.bindings());
    if !cwd.is_dir() {
        // A missing workspace is the commonest binding mistake, and `portable-pty`'s own error
        // for it says only "No such file or directory" with no hint of which directory.
        return Err(format!(
            "{} has no workspace at {}. Create it, or point the binding somewhere else.",
            req.id,
            cwd.display()
        ));
    }
    let front = binding.front.as_ref();
    let seal = crate::summonings::Seal {
        familiar_name: front.map(|f| f.name.clone()).unwrap_or_else(|| req.id.clone()),
        autonomy: front.map(|f| f.autonomy).unwrap_or_default(),
        bounds: front.map(|f| f.bounds.clone()).unwrap_or_default(),
        socket: state.paths.seal_socket(),
        settings_dir: state.paths.summon_dir(),
    };

    state.summonings.summon(&state.db, req, workbench_binary(&state), cwd, &seal, channel)
}

/// Re-attach a terminal to a summoning that is already running.
///
/// Answers whether there was one. The window rebuilds its picture of what is live from here on
/// every mount rather than trusting what it last remembered, because a pane that has been
/// unmounted remembers nothing.
#[tauri::command]
pub fn attach_summoning(state: State<'_, AppState>, id: String, channel: Channel<Emission>) -> R<bool> {
    state.summonings.attach(&id, channel)
}

// ── The seal (§6.4) ────────────────────────────────────────────────────────────────────

/// Everything waiting on the owner, oldest first.
#[tauri::command]
pub fn seals_pending(state: State<'_, AppState>) -> R<Vec<GrimoireSeal>> {
    grimoire_core::seal::pending(&state.db).map_err(|e| e.to_string())
}

/// Answer one request. The familiar blocked on it is woken by this.
#[tauri::command]
pub async fn seal_decide(
    state: State<'_, AppState>,
    id: String,
    resolution: Resolution,
) -> R<GrimoireSeal> {
    // §6.5's `bind` asks whether to extend. Answering yes has to actually let it go on —
    // otherwise the request is a notification with buttons, and the familiar stays stopped
    // however the owner answers.
    let extending = grimoire_core::seal::get(&state.db, &id)
        .ok()
        .flatten()
        .filter(|s| s.kind == grimoire_core::seal::SealKind::Extend);

    let answered = state.seal.decide(&id, resolution).map_err(|e| e.to_string())?;

    if let Some(seal) = extending {
        match resolution {
            Resolution::Sealed | Resolution::SealedAlways => {
                // Move the line before letting go of the familiar. Unbinding on its own buys
                // about four seconds: the next tick reads the same overspend and binds it
                // again. Each yes is worth one more of whatever the binding set.
                let key = crate::heartbeat::extensions_key(&seal.commission_id);
                let so_far = state
                    .db
                    .setting(&key)
                    .ok()
                    .flatten()
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(0);
                let _ = state.db.set_setting(&key, &(so_far + 1).to_string());

                state.seal.unbind(&seal.commission_id);
                // And forget the warning it had already given, so the familiar is warned again
                // on the way to the new line rather than walking into it in silence.
                state.summonings.note_breaker(&seal.familiar_id, Default::default());
            }
            // Refused, or timed out into `bind`: it stays bound, which is what bound means.
            _ => {}
        }
    }
    Ok(answered)
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
    state.summonings.banish(&state.db, &id)
}

// ── Commissions and the ledger ─────────────────────────────────────────────────────────

/// Place a commission (§6.2). It is queued; it starts when its familiar is next free.
#[tauri::command]
pub fn commission_create(
    state: State<'_, AppState>,
    id: String,
    prompt: String,
    intake: serde_json::Value,
) -> R<Commission> {
    let binding = state.roster.get(&id).ok_or_else(|| format!("There is no familiar called {id}."))?;
    ensure_familiar(&state, &binding)?;

    // §4's one substitution, and the only one.
    let answers: std::collections::BTreeMap<String, String> = intake
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let (filled, missing) = grimoire_core::commission::prompt::fill(&prompt, &answers);
    if !missing.is_empty() {
        return Err(format!(
            "The commission asks for {} but nothing answered {}.",
            missing.join(", "),
            if missing.len() == 1 { "it" } else { "them" }
        ));
    }

    grimoire_core::commission::create(&state.db, &id, &filled, &intake).map_err(|e| e.to_string())
}

/// Every commission for one familiar, newest first (§6.2: the queue is visible).
#[tauri::command]
pub fn commissions_for(state: State<'_, AppState>, id: String) -> R<Vec<Commission>> {
    grimoire_core::commission::for_familiar(&state.db, &id).map_err(|e| e.to_string())
}

/// The ledger view's numbers (§6.9).
#[tauri::command]
pub fn ledger_summary(state: State<'_, AppState>) -> R<LedgerSummary> {
    grimoire_core::ledger::summary(&state.db).map_err(|e| e.to_string())
}

/// The most recent ledger events, newest first.
#[tauri::command]
pub fn ledger_events(state: State<'_, AppState>, limit: Option<i64>) -> R<Vec<Event>> {
    grimoire_core::ledger::recent(&state.db, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

/// What a familiar has written into its codex (§6.6).
#[tauri::command]
pub fn codex_for(state: State<'_, AppState>, id: String) -> R<CodexView> {
    let binding = state.roster.get(&id).ok_or_else(|| format!("There is no familiar called {id}."))?;
    let path = codex_path(&state, &binding);
    let codex = grimoire_core::codex::read(&path).map_err(|e| e.to_string())?;
    let needs_condense = codex.needs_condense();
    Ok(CodexView {
        path: path.display().to_string(),
        text: codex.text,
        words: codex.words as i64,
        needs_condense,
    })
}

/// Where a familiar's codex lives: what its binding says, or the default beside the others.
fn codex_path(state: &State<'_, AppState>, binding: &grimoire_core::binding::Binding) -> std::path::PathBuf {
    match binding.front.as_ref().and_then(|f| f.codex.clone()) {
        Some(raw) => grimoire_core::paths::expand(&raw, &state.paths.bindings()),
        None => state.paths.codex_dir().join(format!("{}.md", binding.id)),
    }
}

/// A codex as the interface shows it.
#[derive(serde::Serialize)]
pub struct CodexView {
    pub path: String,
    pub text: String,
    pub words: i64,
    pub needs_condense: bool,
}

#[tauri::command]
pub fn live_summonings(state: State<'_, AppState>) -> R<Vec<String>> {
    Ok(state.summonings.live_ids())
}

/// What to start the engine with: its writ, and where its codex lives.
///
/// The writ goes through `--append-system-prompt` verbatim (§4). The only thing added is a short
/// note naming the codex file, which §6.6 requires: "It is passed to the CLI on summon and the
/// familiar is told, in the engine preamble, that it may append to it." That note is kept
/// separate from the writ by a heading, so the writ is still recognisably the author's own text
/// rather than something Grimoire has edited.
fn engine_args(state: &State<'_, AppState>, binding: &grimoire_core::binding::Binding) -> Vec<String> {
    let mut args = Vec::new();

    let Some(front) = &binding.front else { return args };

    let mut prompt = binding.writ.trim().to_string();
    let codex = codex_path(state, binding);
    if !prompt.is_empty() {
        prompt.push_str("\n\n");
    }
    prompt.push_str(&format!(
        "# Your codex\n\nYou keep one file between commissions, at {}. What you learn that is \
         worth remembering next time goes there; append to it rather than rewriting it. Nothing \
         else in that folder is yours.",
        codex.display()
    ));
    args.push("--append-system-prompt".into());
    args.push(prompt);

    // §4: the model is passed through and never validated — an unknown name is the engine's
    // business to complain about, and hard-coding a list here would go stale.
    if let Some(model) = &front.model {
        args.push("--model".into());
        args.push(model.clone());
    }

    args
}

/// The workbench's override for the engine binary, when one is set (§6.1).
fn workbench_binary(state: &State<'_, AppState>) -> Option<String> {
    state.db.setting("engine.claude.path").ok().flatten()
}
