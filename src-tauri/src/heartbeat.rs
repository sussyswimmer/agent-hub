//! The five-second tick that reads the meters and acts on them (§6.5).
//!
//! `grimoire_core::breaker` decides; this does. It is the only part of the breaker that owns a
//! clock, a process and a database, and it is deliberately thin — everything worth being sure of
//! is arithmetic in the core crate, where a test can drive it past every threshold without
//! waiting for wall-clock minutes to pass.
//!
//! Three things happen on each tick, for each live summoning that is running a commission:
//!
//! 1. **The runaway guard** (§6.5), which is not a budget and does not read `on_exceed`.
//! 2. **The budgets**: 80% steers, the line does what the binding says.
//! 3. **The stall check**: no output and no token movement for ten minutes is raised for the
//!    owner, never acted on silently.

use std::sync::Arc;
use std::time::Duration;

use grimoire_core::breaker::{self, Act, Spend};
use grimoire_core::seal::server::Server as SealServer;
use grimoire_core::summon::usage;
use grimoire_core::ward::{self, Skip, WardRun};
use grimoire_core::{Db, commission, ledger};

use crate::summonings::Summonings;

/// §6.5: "A heartbeat in the Rust process ticks every 5s."
pub const TICK: Duration = Duration::from_secs(5);

/// §6.5: "no PTY output and no token movement for 10 minutes" is a stall.
pub const STALL_AFTER: Duration = Duration::from_secs(10 * 60);

/// Where the workbench keeps the runaway guard's spend cap (§6.5's `$X`).
pub const SPEND_CAP_SETTING: &str = "breaker.spend_cap_usd";

/// How many times the owner has extended one commission's aether (§6.5).
pub fn extensions_key(commission_id: &str) -> String {
    format!("breaker.extended.{commission_id}")
}

pub struct Heart {
    pub db: Db,
    pub summonings: Arc<Summonings>,
    pub seal: Arc<SealServer>,
    /// Read for the budget, which lives in the binding rather than in the database. A binding
    /// edited mid-run does not loosen a *summoning's* leash (DECISIONS.md 0009), but its budget
    /// is not a leash — it is what the owner is willing to spend, and raising it while something
    /// is running is a reasonable thing to want to do.
    pub roster: Arc<crate::roster::Roster>,
}

impl Heart {
    /// Start ticking. Runs for the life of the process.
    pub fn start(self) {
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(TICK);
                self.tick();
            }
        });
    }

    /// One pass over every live commission. Public so a test can drive it without waiting.
    pub fn tick(&self) {
        // §6.7's wards, on the same thread. It already ticks, already holds the database, the
        // roster and the summonings, and a ward's resolution is minutes — a second scheduler
        // would be a second thing to start, stop and reason about for no gain.
        self.wards();

        let cap = self
            .db
            .setting(SPEND_CAP_SETTING)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok());

        for beat in self.summonings.beats() {
            // Tokens and turns come from the engine's own transcript (§6.5, DECISIONS.md 0008).
            // Absent is absent: a transcript that is not there yet means no turn has happened,
            // not that nothing has been spent.
            let used = usage::for_session(&beat.engine_session).unwrap_or_default();
            let spend = Spend {
                tokens: used.tokens,
                turns: used.turns,
                seconds: beat.started.elapsed().as_secs() as i64,
            };

            // 1. The runaway guard, first and regardless of anything the binding says.
            let calls = self.seal.tool_calls(&beat.commission_id);
            if let Some(runaway) = breaker::guard::check(calls, used.tokens, &beat.model, cap) {
                self.banish(&beat, &runaway.reason(), "runaway");
                continue;
            }

            // 2. The budgets.
            let Some(binding) = self.binding_for(&beat.familiar_id) else { continue };
            let name = binding.name.clone();
            // Whatever the owner has already agreed to add, on top of what the binding set.
            let extensions = self
                .db
                .setting(&extensions_key(&beat.commission_id))
                .ok()
                .flatten()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            let budget = &breaker::extended(&binding.aether, extensions);
            let reading = breaker::read(spend, budget);
            let act = breaker::decide(reading, budget, beat.done);
            if act != Act::Carry {
                self.apply(&beat, &name, &act);
                self.summonings.note_breaker(&beat.familiar_id, breaker::record(beat.done, &act));
                continue;
            }

            // 3. The stall check. Last, because a familiar that is over budget is not stalled,
            // it is finished, and saying both about the same summoning helps nobody.
            self.check_stall(&beat, &name, spend);
        }
    }

    /// Fire whichever standing wards have come round (§6.7).
    ///
    /// **Skip, do not queue.** A ward whose familiar is already working records what happened
    /// and leaves its clock alone, so it is asked again next tick rather than stacking up. §6.7
    /// names the failure: a daily ward that has skipped thirty times must not stampede when the
    /// familiar finally frees up.
    fn wards(&self) {
        let Ok(wards) = ward::store::enabled(&self.db) else { return };
        let now = grimoire_core::db::now();

        for w in wards {
            match ward::due(&w.cron, w.last_run, now) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(e) => {
                    // A schedule is checked when the ward is made, so this is a row edited
                    // under the application. Say so once and leave it alone.
                    tracing::warn!(ward = %w.id, error = %e, "a ward's schedule cannot be read");
                    continue;
                }
            }

            let name = self
                .roster
                .get(&w.familiar_id)
                .and_then(|b| b.front.map(|f| f.name))
                .unwrap_or_else(|| w.familiar_id.clone());

            let outcome = if self.roster.get(&w.familiar_id).is_none() {
                WardRun::Skipped(Skip::Missing)
            } else if self.busy(&w.familiar_id) {
                WardRun::Skipped(Skip::Busy)
            } else {
                match ward::store::commission(&self.db, &w) {
                    Ok(id) => WardRun::Commissioned(id),
                    Err(e) => {
                        tracing::warn!(ward = %w.id, error = %e, "a ward could not be commissioned");
                        continue;
                    }
                }
            };

            let said = match &outcome {
                WardRun::Commissioned(_) => "commissioned".to_string(),
                WardRun::Skipped(skip) => skip.describe(&name),
            };
            let _ = ward::store::record(&self.db, &w.id, &outcome, &said);
            let _ = ledger::append(
                &self.db,
                ledger::EventKind::WardFired,
                Some(&w.familiar_id),
                match &outcome {
                    WardRun::Commissioned(id) => Some(id.as_str()),
                    WardRun::Skipped(_) => None,
                },
                serde_json::json!({ "ward": w.id, "result": said }),
            );
            tracing::info!(ward = %w.id, familiar = %w.familiar_id, %said, "a standing ward came round");
        }
    }

    /// Whether a familiar has a commission in hand — the same test the queue uses (§6.2), so
    /// "busy" means one thing in the application rather than two that happen to agree.
    fn busy(&self, familiar_id: &str) -> bool {
        commission::for_familiar(&self.db, familiar_id)
            .map(|rows| rows.iter().any(|c| c.status.occupies_familiar()))
            .unwrap_or(true)
    }

    fn binding_for(&self, familiar_id: &str) -> Option<grimoire_core::binding::schema::BindingFrontmatter> {
        self.roster.get(familiar_id)?.front
    }

    fn apply(&self, beat: &crate::summonings::Beat, name: &str, act: &Act) {
        match act {
            Act::Carry => {}
            Act::Steer(message) => {
                self.say(beat, message);
                let _ = ledger::append(
                    &self.db,
                    ledger::EventKind::BreakerSteer,
                    Some(&beat.familiar_id),
                    Some(&beat.commission_id),
                    serde_json::json!({ "message": message }),
                );
            }
            Act::Bind(message) => {
                // §6.5: stop accepting new tool calls, let the turn finish, then ask whether to
                // extend. The seal is what actually stops them; the message tells the familiar
                // why its next tool call is about to be refused.
                self.seal.bind(&beat.commission_id, message.clone());
                self.say(beat, message);
                let _ = self.seal.raise(grimoire_core::seal::Raise {
                    commission_id: &beat.commission_id,
                    familiar_id: &beat.familiar_id,
                    familiar_name: name,
                    kind: grimoire_core::seal::SealKind::Extend,
                    action: "extend this commission's aether",
                    reason: message,
                    preview: None,
                });
                let _ = ledger::append(
                    &self.db,
                    ledger::EventKind::BreakerBind,
                    Some(&beat.familiar_id),
                    Some(&beat.commission_id),
                    serde_json::json!({ "reason": message }),
                );
            }
            Act::Banish(message) => self.banish(beat, message, "budget"),
        }
    }

    /// A message into the pty, which is how a familiar is spoken to mid-run.
    ///
    /// Wrapped in newlines and sent as a line the engine will read as input. There is no other
    /// channel: the familiar is a terminal program and this is its keyboard.
    fn say(&self, beat: &crate::summonings::Beat, message: &str) {
        let line = format!("\r{message}\r");
        if let Err(e) = self.summonings.write(&beat.familiar_id, line.as_bytes()) {
            tracing::warn!(familiar = %beat.familiar_id, error = %e, "could not steer");
        }
    }

    fn banish(&self, beat: &crate::summonings::Beat, reason: &str, kind: &str) {
        tracing::info!(familiar = %beat.familiar_id, %kind, %reason, "the breaker stopped a summoning");
        self.say(beat, reason);
        let _ = ledger::append(
            &self.db,
            ledger::EventKind::BreakerBanish,
            Some(&beat.familiar_id),
            Some(&beat.commission_id),
            serde_json::json!({ "reason": reason, "kind": kind }),
        );
        // Mark the commission first. `banish` closes the rows itself, and a commission already
        // carrying its reason keeps it rather than being overwritten with a bare "banished".
        let _ = commission::finish(
            &self.db,
            &beat.commission_id,
            commission::Status::Banished,
            Some(reason),
        );
        self.seal.forget(&beat.commission_id);
        if let Err(e) = self.summonings.banish(&self.db, &beat.familiar_id) {
            tracing::warn!(familiar = %beat.familiar_id, error = %e, "the breaker could not stop it");
        }
    }

    /// §6.5's stall: quiet for ten minutes, in both the terminal and the meters.
    ///
    /// **Never killed silently.** It is raised in the seal queue and left there; a familiar
    /// thinking hard for eleven minutes and one stuck for ever look identical from here, and
    /// only the owner can tell them apart.
    fn check_stall(&self, beat: &crate::summonings::Beat, name: &str, spend: Spend) {
        let moving = self.token_movement(&beat.commission_id, spend.tokens.total());
        let quiet = beat.quiet_for >= STALL_AFTER && !moving;

        if !quiet {
            if beat.stall_raised {
                // It spoke. Whatever it was doing, it is doing it again.
                self.summonings.note_stalled(&beat.familiar_id, false);
            }
            return;
        }
        if beat.stall_raised {
            return;
        }

        let minutes = beat.quiet_for.as_secs() / 60;
        let _ = self.seal.raise(grimoire_core::seal::Raise {
            commission_id: &beat.commission_id,
            familiar_id: &beat.familiar_id,
            familiar_name: name,
            kind: grimoire_core::seal::SealKind::Stalled,
            action: "Stalled — steer, or banish?",
            reason: &format!(
                "Nothing has come out of this summoning and no tokens have moved for {minutes} \
                 minutes. It may be thinking, or it may be stuck. Nothing has been done to it."
            ),
            preview: None,
        });
        self.summonings.note_stalled(&beat.familiar_id, true);
        let _ = ledger::append(
            &self.db,
            ledger::EventKind::Stalled,
            Some(&beat.familiar_id),
            Some(&beat.commission_id),
            serde_json::json!({ "quiet_minutes": minutes }),
        );
    }

    /// Whether the token count has moved since the last tick.
    fn token_movement(&self, commission_id: &str, total: i64) -> bool {
        let key = format!("breaker.tokens.{commission_id}");
        let before = self.db.setting(&key).ok().flatten().and_then(|v| v.parse::<i64>().ok());
        let _ = self.db.set_setting(&key, &total.to_string());
        before.is_some_and(|b| b != total)
    }
}
