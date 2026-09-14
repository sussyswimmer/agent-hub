//! The runaway guard (§6.5), which is not a budget and does not answer to `on_exceed`.
//!
//! §6.5 keeps this separate from the three meters on purpose, and the separation is the point:
//! a budget is the owner's choice about how much a piece of work is worth, and `on_exceed` is
//! their choice about what to do when it runs out. The guard is neither. It is the answer to
//! "something has gone wrong and nobody is watching", and a binding that says `on_exceed: steer`
//! is not permission to spin for ever — it is an instruction about *budgets*, and the guard is
//! not one.
//!
//! So `banish` regardless, both here and in the wording.

use crate::ledger::{Estimate, Tokens, cost};

/// §6.5: "more than 200 tool calls in a commission".
pub const RUNAWAY_TOOL_CALLS: i64 = 200;

/// The default spend cap, in dollars, when the workbench has not set one.
///
/// §6.5 leaves `$X` to the workbench. A default is still needed, because the alternative is a
/// fresh install with no cap at all — and the one thing the guard exists to catch is the run
/// nobody is watching.
pub const DEFAULT_SPEND_CAP_USD: f64 = 10.0;

/// Why the guard fired.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Runaway {
    ToolCalls(i64),
    /// Carried as cents so the reason can be compared and printed without float formatting.
    Spend { cents: i64, cap_cents: i64 },
}

impl Runaway {
    /// What the ledger and the notification say. Names the number, and says it was not a budget.
    pub fn reason(&self) -> String {
        match self {
            Runaway::ToolCalls(n) => format!(
                "{n} tool calls in one commission. That is past the runaway guard, which is not a \
                 budget and does not answer to `on_exceed`. The summoning was stopped."
            ),
            Runaway::Spend { cents, cap_cents } => format!(
                "An estimated ${:.2} spent on one commission, past the ${:.2} cap set in the \
                 workbench. That is the runaway guard, not a budget. The summoning was stopped.",
                *cents as f64 / 100.0,
                *cap_cents as f64 / 100.0
            ),
        }
    }
}

/// Whether this commission has run away, whatever its binding says.
///
/// `cap_usd` is the workbench's setting; `None` uses [`DEFAULT_SPEND_CAP_USD`]. A cap of zero or
/// less is read as "do not cap on spend", which is the only way to turn this half off — and it
/// is deliberately not the default.
pub fn check(tool_calls: i64, tokens: Tokens, model: &str, cap_usd: Option<f64>) -> Option<Runaway> {
    if tool_calls > RUNAWAY_TOOL_CALLS {
        return Some(Runaway::ToolCalls(tool_calls));
    }

    let cap = cap_usd.unwrap_or(DEFAULT_SPEND_CAP_USD);
    if cap <= 0.0 {
        return None;
    }
    let Estimate { usd, .. } = cost::estimate(tokens, model);
    let cents = (usd * 100.0).round() as i64;
    let cap_cents = (cap * 100.0).round() as i64;
    (cents > cap_cents).then_some(Runaway::Spend { cents, cap_cents })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_hundred_tool_calls_is_fine_and_two_hundred_and_one_is_not() {
        // §6.5 says "more than 200", and an off-by-one here either fires a call early or lets a
        // runaway have one more swing at the filesystem.
        assert_eq!(check(200, Tokens::default(), "claude-sonnet-4-6", None), None);
        assert_eq!(
            check(201, Tokens::default(), "claude-sonnet-4-6", None),
            Some(Runaway::ToolCalls(201))
        );
    }

    #[test]
    fn the_guard_does_not_read_on_exceed_at_all() {
        // Not a test of behaviour so much as of shape: `check` has no `on_exceed` parameter and
        // cannot be given one. §6.5 says the guard fires "regardless of `on_exceed`", and the
        // surest way to keep that true is for the guard to have no way of knowing what it says.
        let fired = check(500, Tokens::default(), "claude-sonnet-4-6", None);
        assert!(matches!(fired, Some(Runaway::ToolCalls(500))));
    }

    #[test]
    fn spending_past_the_cap_fires() {
        let spent = Tokens { input: 2_000_000, output: 500_000, cache_read: 0, cache_write: 0 };
        let fired = check(1, spent, "claude-sonnet-4-6", Some(1.0));
        assert!(matches!(fired, Some(Runaway::Spend { .. })), "got {fired:?}");

        // And the same spend under a cap that allows it does not.
        assert_eq!(check(1, spent, "claude-sonnet-4-6", Some(10_000.0)), None);
    }

    #[test]
    fn a_fresh_install_has_a_cap() {
        // The run nobody is watching is exactly the one that happens before anybody has opened
        // the workbench, so "no setting yet" must not mean "no cap".
        let enormous = Tokens { input: 500_000_000, output: 0, cache_read: 0, cache_write: 0 };
        assert!(check(1, enormous, "claude-sonnet-4-6", None).is_some());
    }

    #[test]
    fn a_cap_of_zero_turns_the_spend_half_off() {
        let enormous = Tokens { input: 500_000_000, output: 0, cache_read: 0, cache_write: 0 };
        assert_eq!(check(1, enormous, "claude-sonnet-4-6", Some(0.0)), None);
        // The tool-call half is not turned off with it. Nothing turns that off.
        assert!(check(201, enormous, "claude-sonnet-4-6", Some(0.0)).is_some());
    }

    #[test]
    fn the_reason_says_it_was_not_a_budget() {
        // The familiar and the ledger both read this, and "you hit your budget" would be a lie
        // that sends the owner to the wrong line of their binding.
        for r in [Runaway::ToolCalls(201), Runaway::Spend { cents: 1200, cap_cents: 1000 }] {
            let reason = r.reason();
            assert!(reason.contains("runaway guard"), "{reason}");
            assert!(reason.contains("not a budget"), "{reason}");
        }
    }
}
