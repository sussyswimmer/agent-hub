//! Aether accounting, and steer → bind → banish (§6.5).
//!
//! Three things are metered per commission: tokens, turns and minutes. The binding sets a budget
//! for any of them, and what happens at the line is the binding's choice — except where it is
//! not, which is the whole of §6.5's second half.
//!
//! **Everything here is arithmetic.** It takes a budget, a reading and what has already been
//! done about it, and answers what to do now. It does not own a clock, a process, a socket or a
//! database. That is deliberate: the decisions are the part worth being sure of, and a pure
//! function is the only version of them a test can drive past every threshold in microseconds
//! rather than in wall-clock minutes.

use crate::binding::schema::{AetherBudget, OnExceed};
use crate::ledger::Tokens;

pub mod guard;

pub use guard::{RUNAWAY_TOOL_CALLS, Runaway};

/// The line at which the familiar is warned and the card's rule turns brass (§6.5).
pub const WARN_AT: f64 = 0.8;

/// Past the line, `steer` says its piece again every ten per cent.
pub const RE_WARN_EVERY: f64 = 0.1;

/// What a commission has used so far.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Spend {
    pub tokens: Tokens,
    /// Assistant turns, as the engine's own transcript counts them.
    pub turns: i64,
    /// Wall-clock since the commission started.
    pub seconds: i64,
}

/// How far through each budget the commission is, as a fraction.
///
/// `None` where the binding sets no budget for that meter — not zero. A familiar with no token
/// budget is not at 0% of its tokens, it is not being metered on tokens at all, and treating the
/// two the same is how an unmetered familiar gets banished for reaching a limit nobody set.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Reading {
    pub tokens: Option<f64>,
    pub turns: Option<f64>,
    pub minutes: Option<f64>,
}

impl Reading {
    /// The meter that is furthest along, which is the one the breaker acts on.
    ///
    /// §6.5 says "at 80% of any budget" and "at 100%" without naming a meter: the tightest
    /// budget is the one that binds, whichever of the three it happens to be.
    pub fn worst(self) -> f64 {
        [self.tokens, self.turns, self.minutes].into_iter().flatten().fold(0.0, f64::max)
    }

    /// Whether any budget is set at all.
    pub fn metered(self) -> bool {
        self.tokens.is_some() || self.turns.is_some() || self.minutes.is_some()
    }

    /// Which meter is furthest along, for the message that says so.
    pub fn tightest(self) -> Option<&'static str> {
        let mut best: Option<(&'static str, f64)> = None;
        for (name, value) in [("tokens", self.tokens), ("turns", self.turns), ("minutes", self.minutes)] {
            if let Some(v) = value
                && best.is_none_or(|(_, b)| v > b)
            {
                best = Some((name, v));
            }
        }
        best.map(|(name, _)| name)
    }
}

pub fn read(spend: Spend, budget: &AetherBudget) -> Reading {
    let over = |used: i64, max: Option<i64>| max.filter(|m| *m > 0).map(|m| used as f64 / m as f64);
    Reading {
        tokens: over(spend.tokens.total(), budget.tokens),
        turns: over(spend.turns, budget.turns),
        minutes: over(spend.seconds, budget.minutes.map(|m| m * 60)),
    }
}

/// The budget, after the owner has been asked and has said yes (§6.5).
///
/// Each extension is worth one more of whatever the binding set: a familiar bound at thirty
/// minutes and extended once runs to sixty, extended twice to ninety.
///
/// **Sealing the request has to move the line, not just let go of the familiar.** Releasing it
/// with the budget where it was means the next tick reads the same overspend, binds it again,
/// and raises another request — which is what happened in the running application: sealing the
/// extend request bought about four seconds and a second identical request.
pub fn extended(budget: &AetherBudget, times: u32) -> AetherBudget {
    if times == 0 {
        return *budget;
    }
    let grow = |v: Option<i64>| v.map(|v| v.saturating_mul(1 + times as i64));
    AetherBudget {
        tokens: grow(budget.tokens),
        turns: grow(budget.turns),
        minutes: grow(budget.minutes),
        on_exceed: budget.on_exceed,
    }
}

/// What the breaker has already done about this commission, so it does not do it twice.
///
/// Carried rather than recomputed because "have I warned yet" is not a function of the reading:
/// at 82% on two consecutive ticks the answer is yes then no, and a breaker that forgets sends
/// the same warning every five seconds until the budget runs out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Done {
    pub warned: bool,
    /// How many times `steer` has spoken at or past the line, for the every-10% re-warn.
    pub steers: u32,
    /// Whether the commission has already been bound or banished. Either is final.
    pub stopped: bool,
}

/// What to do now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Act {
    /// Nothing. The commonest answer by far.
    Carry,
    /// Say something to the familiar and keep going. The string goes into the pty verbatim.
    Steer(String),
    /// Stop accepting new tool calls, let the turn finish, and ask whether to extend (§6.5).
    Bind(String),
    /// Graceful stop, the commission marked banished.
    Banish(String),
}

/// The decision §6.5 describes, as one function.
pub fn decide(reading: Reading, budget: &AetherBudget, done: Done) -> Act {
    if !reading.metered() || done.stopped {
        return Act::Carry;
    }
    let worst = reading.worst();
    let meter = reading.tightest().unwrap_or("budget");

    if worst < WARN_AT {
        return Act::Carry;
    }

    // 80%, once. §6.5 gives the wording: prioritise finishing over exploring.
    if worst < 1.0 {
        if done.warned {
            return Act::Carry;
        }
        return Act::Steer(format!(
            "You are at {} of your {meter} budget for this commission. Prioritise finishing over \
             exploring.",
            percent(worst)
        ));
    }

    match budget.on_exceed {
        OnExceed::Steer => {
            // Keep running, and say so again every ten per cent past the line.
            //
            // Counted in whole percent rather than by dividing fractions. `(1.2 - 1.0) / 0.1`
            // is 1.9999999999999996 in binary floating point, which truncates to 1 — so a
            // familiar at 120% was owed two warnings, had two, and fell silent for ever after.
            let over = ((worst - 1.0) * 100.0).round() as i64;
            let owed = 1 + (over / ((RE_WARN_EVERY * 100.0).round() as i64)).max(0) as u32;
            if done.steers >= owed {
                return Act::Carry;
            }
            Act::Steer(format!(
                "You are at {} of your {meter} budget for this commission — over the line your \
                 binding set. Finish what you are doing and stop. Do not begin anything new.",
                percent(worst)
            ))
        }
        OnExceed::Bind => Act::Bind(format!(
            "You have reached your {meter} budget for this commission. Finish the turn you are \
             on and stop; nothing further will be allowed through until your owner says so."
        )),
        OnExceed::Banish => Act::Banish(format!(
            "{meter} budget reached, and this binding says banish. The summoning was stopped."
        )),
    }
}

fn percent(fraction: f64) -> String {
    format!("{}%", (fraction * 100.0).round() as i64)
}

/// Fold an act back into what has been done, so the next tick knows.
pub fn record(done: Done, act: &Act) -> Done {
    match act {
        Act::Carry => done,
        Act::Steer(_) => Done { warned: true, steers: done.steers + 1, ..done },
        Act::Bind(_) | Act::Banish(_) => Done { stopped: true, warned: true, ..done },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget(on_exceed: OnExceed) -> AetherBudget {
        AetherBudget { tokens: Some(2000), turns: None, minutes: None, on_exceed }
    }

    fn spend(tokens: i64) -> Spend {
        Spend { tokens: Tokens { input: tokens, ..Tokens::default() }, turns: 0, seconds: 0 }
    }

    #[test]
    fn an_unmetered_commission_is_never_acted_on() {
        // A binding with no budget is not at 0% of anything. Treating "no budget" as "a budget
        // of zero" would banish a familiar the moment it did anything at all.
        let none = AetherBudget { tokens: None, turns: None, minutes: None, on_exceed: OnExceed::Banish };
        let reading = read(spend(10_000_000), &none);
        assert!(!reading.metered());
        assert_eq!(decide(reading, &none, Done::default()), Act::Carry);
    }

    #[test]
    fn nothing_happens_below_eighty_per_cent() {
        let b = budget(OnExceed::Bind);
        for used in [0, 100, 1000, 1599] {
            assert_eq!(decide(read(spend(used), &b), &b, Done::default()), Act::Carry, "at {used}");
        }
    }

    #[test]
    fn eighty_per_cent_steers_once_and_only_once() {
        let b = budget(OnExceed::Bind);
        let reading = read(spend(1650), &b);
        let act = decide(reading, &b, Done::default());
        let Act::Steer(message) = &act else { panic!("expected a steer, got {act:?}") };
        assert!(message.contains("Prioritise finishing"), "{message}");

        // The same reading five seconds later must not say it again, or the familiar is warned
        // every tick from 80% to the line.
        let done = record(Done::default(), &act);
        assert_eq!(decide(reading, &b, done), Act::Carry);
    }

    #[test]
    fn the_tightest_budget_is_the_one_that_binds() {
        // §6.5 says "at 80% of any budget". Tokens are barely touched; turns are nearly gone.
        let b = AetherBudget { tokens: Some(1_000_000), turns: Some(10), minutes: None, on_exceed: OnExceed::Bind };
        let reading = read(Spend { tokens: Tokens::default(), turns: 9, seconds: 0 }, &b);
        assert_eq!(reading.tightest(), Some("turns"));
        let Act::Steer(message) = decide(reading, &b, Done::default()) else { panic!("expected a steer") };
        assert!(message.contains("turns"), "the message must name the meter that is tight: {message}");
    }

    #[test]
    fn at_the_line_it_does_what_on_exceed_says() {
        for (on_exceed, expected) in [
            (OnExceed::Steer, "steer"),
            (OnExceed::Bind, "bind"),
            (OnExceed::Banish, "banish"),
        ] {
            let b = budget(on_exceed);
            let act = decide(read(spend(2000), &b), &b, Done { warned: true, ..Done::default() });
            let got = match act {
                Act::Steer(_) => "steer",
                Act::Bind(_) => "bind",
                Act::Banish(_) => "banish",
                Act::Carry => "carry",
            };
            assert_eq!(got, expected, "on_exceed: {on_exceed:?}");
        }
    }

    #[test]
    fn steer_says_its_piece_again_every_ten_per_cent() {
        // §6.5: "inject a hard message, keep running, re-warn every 10%."
        let b = budget(OnExceed::Steer);
        let mut done = Done { warned: true, ..Done::default() };

        // At the line: one message.
        let act = decide(read(spend(2000), &b), &b, done);
        assert!(matches!(act, Act::Steer(_)), "at 100%: {act:?}");
        done = record(done, &act);
        assert_eq!(decide(read(spend(2050), &b), &b, done), Act::Carry, "102% owes nothing new");

        // 110%: a second.
        let act = decide(read(spend(2200), &b), &b, done);
        assert!(matches!(act, Act::Steer(_)), "at 110%: {act:?}");
        done = record(done, &act);
        assert_eq!(decide(read(spend(2200), &b), &b, done), Act::Carry);

        // 120%: a third. It never stops running, which is what `steer` means.
        let act = decide(read(spend(2400), &b), &b, done);
        assert!(matches!(act, Act::Steer(_)), "at 120%: {act:?}");
    }

    #[test]
    fn extending_moves_the_line_rather_than_merely_letting_go() {
        // Found in the running application: sealing the request to extend unbound the familiar
        // and the very next tick bound it again, because the reading had not changed. Four
        // seconds of freedom and a second identical request in the queue.
        let b = budget(OnExceed::Bind);
        let at_the_line = read(spend(2000), &b);
        assert!(matches!(decide(at_the_line, &b, Done { warned: true, ..Done::default() }), Act::Bind(_)));

        let once = extended(&b, 1);
        assert_eq!(once.tokens, Some(4000));
        // The same spend, judged against the extended budget, is halfway rather than done.
        assert_eq!(read(spend(2000), &once).tokens, Some(0.5));
        assert_eq!(decide(read(spend(2000), &once), &once, Done::default()), Act::Carry);

        // And it binds again at the new line, not before.
        let done = Done { warned: true, ..Done::default() };
        assert!(matches!(decide(read(spend(4000), &once), &once, done), Act::Bind(_)));
    }

    #[test]
    fn an_unmetered_budget_stays_unmetered_however_often_it_is_extended() {
        let none = AetherBudget { tokens: None, turns: None, minutes: None, on_exceed: OnExceed::Bind };
        assert_eq!(extended(&none, 3).tokens, None);
    }

    #[test]
    fn a_stopped_commission_is_not_stopped_twice() {
        let b = budget(OnExceed::Banish);
        let done = record(Done::default(), &Act::Banish("gone".into()));
        assert!(done.stopped);
        assert_eq!(decide(read(spend(9999), &b), &b, done), Act::Carry);
    }

    #[test]
    fn minutes_are_counted_in_seconds_against_a_budget_written_in_minutes() {
        // The binding says `minutes: 30`; the clock counts seconds. Getting this wrong by a
        // factor of sixty either never trips or trips at once.
        let b = AetherBudget { tokens: None, turns: None, minutes: Some(30), on_exceed: OnExceed::Bind };
        let half = read(Spend { seconds: 15 * 60, ..Spend::default() }, &b);
        assert_eq!(half.minutes, Some(0.5));
        assert_eq!(decide(half, &b, Done::default()), Act::Carry);

        let over = read(Spend { seconds: 31 * 60, ..Spend::default() }, &b);
        assert!(matches!(decide(over, &b, Done { warned: true, ..Done::default() }), Act::Bind(_)));
    }

    #[test]
    fn a_budget_of_zero_is_not_a_division_by_zero() {
        let b = AetherBudget { tokens: Some(0), turns: None, minutes: None, on_exceed: OnExceed::Bind };
        let reading = read(spend(5), &b);
        assert_eq!(reading.tokens, None, "a zero budget is no budget, not an instant trip");
        assert_eq!(decide(reading, &b, Done::default()), Act::Carry);
    }

    #[test]
    fn cache_tokens_count_towards_the_budget() {
        // A long session is mostly cache. Counting only input and output would let a commission
        // run far past its budget while the meter said it had barely started.
        let b = budget(OnExceed::Bind);
        let mostly_cache = Spend {
            tokens: Tokens { input: 10, output: 10, cache_read: 1900, cache_write: 100 },
            turns: 0,
            seconds: 0,
        };
        assert!(read(mostly_cache, &b).worst() >= 1.0);
    }
}
