//! Phase 7 acceptance (CLAUDE.md §10) for the parts that do not need a window: what a ward
//! stores, what it sends, and what it does when the familiar is busy.

use grimoire_core::commission::{self, Status};
use grimoire_core::db::{Db, familiars, summonings};
use grimoire_core::ward::{self, Skip, WardRun};

fn study() -> (tempfile::TempDir, Db) {
    let tmp = tempfile::tempdir().expect("tmp");
    let db = Db::open(&tmp.path().join("grimoire.db")).expect("db");
    familiars::upsert(&db, "astrolabe", "Astrolabe", "compass", "/b/a.binding.md", "writ").expect("familiar");
    (tmp, db)
}

/// §6.7: "The prompt is sent verbatim every run." Awkward on purpose.
const PROMPT: &str = "  Plan the week.\n\nKeep Tuesday clear.\t\n";

#[test]
fn the_prompt_a_ward_sends_is_the_prompt_that_was_stored() {
    // The property §6.7 names first, and the one a ward is useless without: it is a thing you
    // set up once and stop thinking about, and that is only safe if what it sends next month is
    // byte-for-byte what you read when you wrote it. Leading spaces, blank lines and a trailing
    // tab are all in here because trimming is the obvious well-meant change.
    let (_tmp, db) = study();
    let intake = serde_json::json!({ "horizon": "this week" });
    let w = ward::store::create(&db, "astrolabe", "0 9 * * 1", PROMPT, &intake).expect("create");

    let stored = ward::store::get(&db, &w.id).expect("get").expect("a ward");
    assert_eq!(stored.prompt, PROMPT, "the store must not touch it");

    let commission_id = ward::store::commission(&db, &stored).expect("commission");
    let made = commission::get(&db, &commission_id).expect("get").expect("a commission");
    assert_eq!(made.prompt, PROMPT, "and neither must the dispatch");
    assert_eq!(made.intake, intake, "the answers go with it");
    assert_eq!(made.status, Status::Queued);
}

#[test]
fn a_commission_a_ward_made_says_which_ward_made_it() {
    let (_tmp, db) = study();
    let w = ward::store::create(&db, "astrolabe", "0 9 * * 1", "plan", &serde_json::json!({})).expect("create");
    let commission_id = ward::store::commission(&db, &w).expect("commission");

    let ward_id: Option<String> = db
        .conn()
        .expect("conn")
        .query_row("SELECT ward_id FROM commissions WHERE id = ?1", [&commission_id], |r| r.get(0))
        .expect("ward_id");
    assert_eq!(ward_id.as_deref(), Some(w.id.as_str()));
}

#[test]
fn a_schedule_that_cannot_be_read_is_refused_rather_than_stored() {
    // Storing it would mean failing silently once a minute for ever, with nothing on screen to
    // say why the ward never runs.
    let (_tmp, db) = study();
    let refused = ward::store::create(&db, "astrolabe", "every tuesday please", "plan", &serde_json::json!({}));
    assert!(refused.is_err());
    assert!(ward::store::for_familiar(&db, "astrolabe").expect("list").is_empty());
}

#[test]
fn a_skipped_turn_is_spent_and_the_ward_waits_for_its_next_one() {
    // §6.7: "A ward whose familiar is already busy skips that run." *That run* — the occurrence
    // is spent either way, and the ward comes round again at its next scheduled time.
    //
    // The first version left the clock alone on a skip, reasoning that a skipped ward had not
    // run. It had not, but it had come round — and being due again immediately meant due on
    // every heartbeat: a busy familiar produced thirty-three skips in two and a half minutes in
    // the running application, each one a write. Nothing queued, which is the rule that
    // matters, but that is not what "skipped 30 times" means.
    let (_tmp, db) = study();
    let w = ward::store::create(&db, "astrolabe", "0 9 * * *", "plan", &serde_json::json!({})).expect("create");
    let before = ward::store::get(&db, &w.id).expect("get").expect("ward").last_run.expect("last_run");

    std::thread::sleep(std::time::Duration::from_millis(1100));
    ward::store::record(&db, &w.id, &WardRun::Skipped(Skip::Busy), &Skip::Busy.describe("Astrolabe"))
        .expect("record");
    let after = ward::store::get(&db, &w.id).expect("get").expect("ward");
    assert!(after.last_run.expect("last_run") > before, "a skipped turn is still a turn");
    assert_eq!(after.last_result.as_deref(), Some("skipped — Astrolabe was busy"));

    // And it is not due again until nine tomorrow, rather than five seconds from now.
    assert!(!ward::due("0 9 * * *", after.last_run, after.last_run.unwrap() + 60).expect("due"));
}

#[test]
fn thirty_skips_do_not_become_thirty_commissions() {
    // The other half, and the one §6.7 names outright.
    // The stampede §6.7 names, driven rather than reasoned about: a ward comes round, is
    // skipped, and comes round again — thirty times — and the number of commissions is zero.
    let (_tmp, db) = study();
    let w = ward::store::create(&db, "astrolabe", "* * * * *", "plan", &serde_json::json!({})).expect("create");
    for _ in 0..30 {
        ward::store::record(&db, &w.id, &WardRun::Skipped(Skip::Busy), "skipped — Astrolabe was busy")
            .expect("record");
    }
    assert!(commission::for_familiar(&db, "astrolabe").expect("list").is_empty());

    // And when it finally does run, it runs once.
    ward::store::commission(&db, &w).expect("commission");
    assert_eq!(commission::for_familiar(&db, "astrolabe").expect("list").len(), 1);
}

#[test]
fn only_enabled_wards_reach_the_scheduler() {
    let (_tmp, db) = study();
    let a = ward::store::create(&db, "astrolabe", "0 9 * * 1", "one", &serde_json::json!({})).expect("create");
    let b = ward::store::create(&db, "astrolabe", "0 9 * * 2", "two", &serde_json::json!({})).expect("create");
    assert_eq!(ward::store::enabled(&db).expect("enabled").len(), 2);

    ward::store::set_enabled(&db, &b.id, false).expect("disable");
    let live = ward::store::enabled(&db).expect("enabled");
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].id, a.id);
    // Disabled is not deleted: it is still on the familiar's list, with its switch off.
    assert_eq!(ward::store::for_familiar(&db, "astrolabe").expect("list").len(), 2);
}

#[test]
fn deleting_a_ward_keeps_what_it_did() {
    // §6.9's ledger is append-only, and the commissions a ward made are what it did. Deleting
    // the schedule must not delete the history — nor fail on the foreign key, which is what a
    // bare DELETE would do.
    let (_tmp, db) = study();
    let w = ward::store::create(&db, "astrolabe", "0 9 * * 1", "plan", &serde_json::json!({})).expect("create");
    let commission_id = ward::store::commission(&db, &w).expect("commission");

    ward::store::delete(&db, &w.id).expect("delete");
    assert!(ward::store::get(&db, &w.id).expect("get").is_none());
    assert!(commission::get(&db, &commission_id).expect("get").is_some(), "the run it made stays");
}

#[test]
fn a_ward_knows_when_it_next_comes_round() {
    let (_tmp, db) = study();
    let w = ward::store::create(&db, "astrolabe", "0 9 * * *", "plan", &serde_json::json!({})).expect("create");
    let next = w.next_run.expect("a next time");
    assert!(next > w.last_run.expect("last_run"), "the next time is in the future");
    assert!(next - w.last_run.expect("last_run") <= 24 * 3600, "and within a day, for a daily ward");
}

#[test]
fn a_busy_familiar_is_one_with_a_commission_in_hand() {
    // What the scheduler asks before it fires. `occupies_familiar` is the same test the queue
    // uses (§6.2), so "busy" means the same thing in both places rather than two definitions
    // that agree today.
    let (_tmp, db) = study();
    let c = commission::create(&db, "astrolabe", "work", &serde_json::json!({})).expect("create").id;
    assert!(!Status::Queued.occupies_familiar(), "a queued commission is not the familiar being busy");

    let s = summonings::open(&db, "astrolabe", "claude", "sonnet", "/tmp", "none", 1).expect("summoning");
    commission::start(&db, &c, &s).expect("start");
    let live = commission::for_familiar(&db, "astrolabe").expect("list");
    assert!(live.iter().any(|c| c.status.occupies_familiar()));
}
