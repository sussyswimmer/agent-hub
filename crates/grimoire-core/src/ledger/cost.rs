//! Turning tokens into an estimate (§6.9).
//!
//! **This is an estimate and the code says so at every step.** The owner is on a subscription,
//! so no money changes hands per token at all; the number exists to answer "was that run
//! expensive?", not "what do I owe?". §6.9 is explicit: never display it as settled, and never
//! sum it into anything that looks like a bill. The [`Estimate`] type carries that flag out of
//! this module so no caller has to remember.
//!
//! Rates are list prices per million tokens, and they go out of date. That is fine for a
//! relative measure and is why the number is never called anything but an estimate; a rate that
//! is stale by a third still tells you which of two runs was the costly one.

use crate::ledger::{Estimate, Tokens};

/// Dollars per million tokens, for one model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    /// Cache reads are much cheaper than fresh input; a long session is mostly these, so
    /// charging them at the input rate would overstate a run several times over.
    pub cache_read: f64,
    /// Writing to the cache costs a premium over plain input.
    pub cache_write: f64,
}

impl Rates {
    /// What to assume when the model is unrecognised. The mid-tier rates rather than the
    /// cheapest, so an unknown model is never flattered.
    pub const FALLBACK: Rates = Rates { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 };
}

/// List rates by model family, matched on a substring of the model name so a dated variant
/// (`claude-sonnet-4-6-20250219`) resolves the same as its family.
const TABLE: &[(&str, Rates)] = &[
    ("opus", Rates { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 }),
    ("sonnet", Rates { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 }),
    ("haiku", Rates { input: 0.80, output: 4.00, cache_read: 0.08, cache_write: 1.00 }),
];

pub fn rates_for(model: &str) -> Rates {
    let m = model.to_ascii_lowercase();
    TABLE.iter().find(|(name, _)| m.contains(name)).map(|(_, r)| *r).unwrap_or(Rates::FALLBACK)
}

/// Estimate what a run cost, at list prices.
pub fn estimate(tokens: Tokens, model: &str) -> Estimate {
    let r = rates_for(model);
    let per = |n: i64, rate: f64| (n as f64) * rate / 1_000_000.0;
    Estimate::usd(
        per(tokens.input, r.input)
            + per(tokens.output, r.output)
            + per(tokens.cache_read, r.cache_read)
            + per(tokens.cache_write, r.cache_write),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cost_always_knows_it_is_an_estimate() {
        // §6.9's rule, made structural: there is no path out of here that yields a bare number.
        let e = estimate(Tokens { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 }, "sonnet");
        assert!(e.estimated);
        assert!((e.usd - 3.00).abs() < 1e-9);
    }

    #[test]
    fn a_dated_model_name_resolves_to_its_family() {
        assert_eq!(rates_for("claude-sonnet-4-6-20250219"), rates_for("sonnet"));
        assert_eq!(rates_for("claude-opus-5"), rates_for("opus"));
    }

    #[test]
    fn an_unknown_model_is_not_flattered() {
        // Guessing cheap would make an unknown model look free, which is the wrong way to be
        // wrong about spend.
        let unknown = rates_for("some-future-model");
        assert_eq!(unknown, Rates::FALLBACK);
        assert!(unknown.output > rates_for("haiku").output);
    }

    #[test]
    fn cache_reads_are_not_charged_as_fresh_input() {
        // A long session is mostly cache reads. Pricing them as input would overstate a run
        // several times over and make the meter useless for the one thing it is for.
        let cached = Tokens { input: 0, output: 0, cache_read: 1_000_000, cache_write: 0 };
        let fresh = Tokens { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 };
        assert!(estimate(cached, "sonnet").usd < estimate(fresh, "sonnet").usd / 5.0);
    }

    #[test]
    fn estimates_add_up_and_stay_estimates() {
        let a = estimate(Tokens { input: 1000, output: 500, cache_read: 0, cache_write: 0 }, "sonnet");
        let b = estimate(Tokens { input: 2000, output: 100, cache_read: 0, cache_write: 0 }, "haiku");
        let sum = a.plus(b);
        assert!(sum.estimated, "adding two estimates must not produce a settled figure");
        assert!((sum.usd - (a.usd + b.usd)).abs() < 1e-12);
    }

    #[test]
    fn nothing_used_costs_nothing() {
        assert_eq!(estimate(Tokens::default(), "sonnet").usd, 0.0);
    }
}
