//! Standing wards: recurring commissions that fire with the window closed (§6.7).
//!
//! A ward is `{familiar, cron, prompt, intake, enabled}`. Every rule about when one runs is
//! decided by [`due`], which is pure — it takes the schedule, when the ward last ran and what
//! time it is now, and says whether this is a firing. Nothing about it needs a clock to test,
//! which matters for a feature whose whole subject is time.
//!
//! **The prompt is sent verbatim.** §6.7 is explicit about this: no drift, no "improve the
//! prompt" logic. A ward is a thing you set up once and stop thinking about, and the only way
//! that is safe is if what it sends tomorrow is byte-for-byte what you read when you wrote it.

use std::str::FromStr;

use chrono::{DateTime, Local, TimeZone, Utc};
use cron::Schedule;

use crate::error::{Error, Result};

pub mod store;

pub use store::{Ward, WardRun};

/// Whether a ward should fire now.
///
/// `last_run` is when the ward last came round, whether or not that turn became a commission.
/// §6.7 says a busy familiar makes a ward "skip that run": the occurrence is spent either way,
/// and the ward is asked again at its next scheduled time rather than on every heartbeat.
///
/// **A missed window is not caught up.** A machine asleep through six of a ward's firings gets
/// one run when it wakes, not six. §6.7 gives the reason under a different heading — "a daily
/// ward that has skipped 30 times must not stampede" — and the same reasoning applies to a lid
/// that was shut: the owner wants the thing done, not the backlog performed.
pub fn due(cron: &str, last_run: Option<i64>, now: i64) -> Result<bool> {
    let schedule = parse(cron)?;
    // Nothing has ever run it: the first firing is the next one that comes round, not this
    // instant. A ward created at noon for `0 3 * * *` runs at three, not on the way out of the
    // dialog that made it.
    let Some(since) = last_run else { return Ok(false) };
    if now <= since {
        return Ok(false);
    }

    let after = local(since);
    Ok(schedule.after(&after).next().is_some_and(|next| next.timestamp() <= now))
}

/// When a ward will next come round, for the panel to show.
pub fn next_after(cron: &str, from: i64) -> Result<Option<i64>> {
    Ok(parse(cron)?.after(&local(from)).next().map(|t| t.timestamp()))
}

/// Parse a schedule, with an error a person can act on.
///
/// The `cron` crate speaks seven fields (seconds first, year last); §6.7 and every crontab a
/// person has ever written speak five. Five is what a binding will contain, so five is what is
/// accepted, and the seconds field is filled in as zero — a ward is a thing that runs daily or
/// hourly, and one that wanted a particular second would be a different feature.
pub fn parse(cron: &str) -> Result<Schedule> {
    let trimmed = cron.trim();
    let fields = trimmed.split_whitespace().count();
    let expression = match fields {
        5 => format!("0 {trimmed} *"),
        6 => format!("0 {trimmed}"),
        7 => trimmed.to_string(),
        n => {
            return Err(Error::other(format!(
                "`{trimmed}` has {n} fields. A ward's schedule is the usual five: minute, hour, \
                 day of month, month, day of week. `0 9 * * 1` is nine every Monday."
            )));
        }
    };
    Schedule::from_str(&expression).map_err(|e| {
        Error::other(format!(
            "`{trimmed}` is not a schedule Grimoire can read ({e}). Five fields: minute, hour, \
             day of month, month, day of week. `0 9 * * 1` is nine every Monday."
        ))
    })
}

/// Read a timestamp in the machine's own time zone.
///
/// A ward that says nine o'clock means nine o'clock where the owner is. Running the schedule in
/// UTC would put "every weekday at nine" an hour out for half the year, which is exactly the
/// kind of thing nobody notices until a morning briefing arrives at ten.
fn local(at: i64) -> DateTime<Local> {
    Local.from_utc_datetime(&DateTime::<Utc>::from_timestamp(at, 0).unwrap_or_default().naive_utc())
}

/// Why a ward's turn did not become a commission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    /// §6.7: "A ward whose familiar is already busy skips that run."
    Busy,
    /// The familiar in the ward is no longer in the roster, or its binding stopped parsing.
    Missing,
}

impl Skip {
    /// What the panel shows, in §3's voice: what happened, not a status code.
    pub fn describe(self, familiar: &str) -> String {
        match self {
            Skip::Busy => format!("skipped — {familiar} was busy"),
            Skip::Missing => format!("skipped — there is no familiar called {familiar} any more"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed moment to reason from: 2026-01-05 was a Monday.
    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
        Local
            .with_ymd_and_hms(y, mo, d, h, mi, 0)
            .single()
            .expect("a real local time")
            .timestamp()
    }

    #[test]
    fn five_fields_is_what_a_person_writes() {
        assert!(parse("0 9 * * 1").is_ok());
        assert!(parse("*/15 * * * *").is_ok());
        // And the error says what to write instead, rather than quoting a parser at them.
        let complaint = parse("not a schedule").expect_err("should not parse").to_string();
        assert!(complaint.contains("five"), "{complaint}");
        assert!(complaint.contains("0 9 * * 1"), "give an example: {complaint}");
    }

    #[test]
    fn a_ward_that_has_never_run_waits_for_its_time() {
        // Creating a daily ward at noon must not fire it on the way out of the dialog.
        assert!(!due("0 3 * * *", None, at(2026, 1, 5, 12, 0)).expect("due"));
    }

    #[test]
    fn a_ward_fires_once_its_time_has_come_round() {
        let yesterday_at_three = at(2026, 1, 4, 3, 0);
        // Still the same day, before three: not yet.
        assert!(!due("0 3 * * *", Some(yesterday_at_three), at(2026, 1, 4, 23, 59)).expect("due"));
        // Past three the next day: now.
        assert!(due("0 3 * * *", Some(yesterday_at_three), at(2026, 1, 5, 3, 0)).expect("due"));
    }

    #[test]
    fn a_missed_window_is_one_run_and_not_a_backlog() {
        // The machine was asleep for a week. §6.7 wants the thing done, not six of it.
        //
        // This is the same property as the skip-if-busy rule and is checked the same way: `due`
        // answers yes once, and the *next* answer depends on `last_run` having moved — so a
        // caller that records the run gets one commission, not one per missed window.
        let a_week_ago = at(2026, 1, 5, 3, 0);
        let now = at(2026, 1, 12, 9, 0);
        assert!(due("0 3 * * *", Some(a_week_ago), now).expect("due"));

        // Having run, it is not due again until tomorrow.
        assert!(!due("0 3 * * *", Some(now), at(2026, 1, 12, 23, 0)).expect("due"));
        assert!(due("0 3 * * *", Some(now), at(2026, 1, 13, 3, 0)).expect("due"));
    }

    #[test]
    fn a_weekly_ward_waits_for_its_day() {
        // Monday the 5th at nine, then every Monday.
        let monday = at(2026, 1, 5, 9, 0);
        for day in 6..=10 {
            assert!(
                !due("0 9 * * 1", Some(monday), at(2026, 1, day, 9, 0)).expect("due"),
                "fired on the {day}th, which is not a Monday"
            );
        }
        assert!(due("0 9 * * 1", Some(monday), at(2026, 1, 12, 9, 0)).expect("due"));
    }

    #[test]
    fn time_does_not_run_backwards() {
        // A clock adjusted backwards must not make a ward due; it must make it wait.
        let ran = at(2026, 1, 5, 9, 0);
        assert!(!due("* * * * *", Some(ran), ran - 3600).expect("due"));
        assert!(!due("* * * * *", Some(ran), ran).expect("due"));
    }

    #[test]
    fn a_skip_says_what_happened_rather_than_a_status_code() {
        // §3: the copy says what happened and what to do; `skipped: busy` is a log line, not a
        // sentence, and the panel is read by a person.
        assert_eq!(Skip::Busy.describe("Tally"), "skipped — Tally was busy");
        assert!(Skip::Missing.describe("Tally").contains("no familiar called Tally"));
    }

    #[test]
    fn the_next_time_can_be_shown_without_waiting_for_it() {
        let noon = at(2026, 1, 5, 12, 0);
        let next = next_after("0 3 * * *", noon).expect("next").expect("a next time");
        assert_eq!(next, at(2026, 1, 6, 3, 0));
    }
}
