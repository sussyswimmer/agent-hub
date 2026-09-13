//! Phase 3 acceptance (CLAUDE.md §10): the commission lifecycle, the queue, and what survives a
//! restart.

use grimoire_core::commission::{self, Status};
use grimoire_core::db::{Db, familiars, summonings};
use grimoire_core::ledger::{self, Estimate, Tokens};

fn study() -> Db {
    let db = Db::memory().expect("db");
    for (id, name) in [("vellum", "Vellum"), ("anvil", "Anvil")] {
        familiars::upsert(&db, id, name, "quill", &format!("/b/{id}.binding.md"), "writ").expect("familiar");
    }
    db
}

fn place(db: &Db, familiar: &str, prompt: &str) -> String {
    commission::create(db, familiar, prompt, &serde_json::json!({})).expect("create").id
}

#[test]
fn a_commission_starts_queued_and_is_visible_immediately() {
    let db = study();
    let id = place(&db, "vellum", "Tighten the opening.");

    let c = commission::get(&db, &id).expect("get").expect("exists");
    assert_eq!(c.status, Status::Queued);
    assert_eq!(c.prompt, "Tighten the opening.");
    assert_eq!(commission::for_familiar(&db, "vellum").expect("list").len(), 1);
}

#[test]
fn a_familiar_runs_one_commission_and_the_rest_queue_behind_it() {
    // §10 Phase 3, and §6.2: "A familiar runs one commission at a time. New commissions queue
    // behind it, visibly." Two running in one workspace would write over each other.
    let db = study();
    let first = place(&db, "vellum", "First.");
    let second = place(&db, "vellum", "Second.");
    let third = place(&db, "vellum", "Third.");

    // The oldest goes first. A queue that serves the newest first is not a queue.
    let next = commission::next_to_run(&db, "vellum").expect("next").expect("one waiting");
    assert_eq!(next.id, first);

    let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");
    commission::start(&db, &first, &s).expect("start");

    // Now nothing else may start, and the two behind are visibly waiting rather than lost.
    assert!(commission::next_to_run(&db, "vellum").expect("next").is_none(), "a second one started");
    assert_eq!(commission::queued_count(&db, "vellum").expect("count"), 2);

    // Another familiar is unaffected: the limit is per familiar, not global.
    let elsewhere = place(&db, "anvil", "Build it.");
    assert_eq!(commission::next_to_run(&db, "anvil").expect("next").expect("free").id, elsewhere);

    // When the first finishes, the next in line is released — still oldest first.
    commission::finish(&db, &first, Status::Done, None).expect("finish");
    assert_eq!(commission::next_to_run(&db, "vellum").expect("next").expect("released").id, second);
    assert_eq!(commission::queued_count(&db, "vellum").expect("count"), 2);
    let _ = third;
}

#[test]
fn a_commission_waiting_on_a_seal_still_occupies_its_familiar() {
    // §6.2's lifecycle passes through `awaiting seal` and back into `running`. The familiar is
    // not free during that: its process is alive and its workspace is mid-change.
    let db = study();
    let first = place(&db, "vellum", "First.");
    place(&db, "vellum", "Second.");

    let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");
    commission::start(&db, &first, &s).expect("start");
    db.conn()
        .expect("conn")
        .execute("UPDATE commissions SET status = 'awaiting_seal' WHERE id = ?1", [&first])
        .expect("await");

    assert!(
        commission::next_to_run(&db, "vellum").expect("next").is_none(),
        "the second one started while the first was waiting on a seal"
    );
}

#[test]
fn a_commission_cannot_be_started_twice() {
    let db = study();
    let id = place(&db, "vellum", "Once.");
    let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");

    commission::start(&db, &id, &s).expect("first");
    let err = commission::start(&db, &id, &s).expect_err("should refuse");
    assert!(err.to_string().contains("not queued"), "{err}");
}

#[test]
fn finishing_needs_a_final_status() {
    let db = study();
    let id = place(&db, "vellum", "x");
    assert!(commission::finish(&db, &id, Status::Running, None).is_err());
}

#[test]
fn a_commission_survives_a_restart_with_the_right_status() {
    // §10 Phase 3's first criterion. The database is reopened from the same file, which is what
    // a restart actually is.
    let tmp = tempfile::tempdir().expect("tmp");
    let path = tmp.path().join("grimoire.db");

    let (running, queued, done) = {
        let db = Db::open(&path).expect("open");
        familiars::upsert(&db, "vellum", "Vellum", "quill", "/b/v.binding.md", "writ").expect("familiar");

        let running = place(&db, "vellum", "Mid-flight.");
        let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 99).expect("summon");
        commission::start(&db, &running, &s).expect("start");

        let queued = place(&db, "vellum", "Never started.");
        let done = place(&db, "vellum", "Already finished.");
        commission::finish(&db, &done, Status::Done, None).expect("finish");
        (running, queued, done)
    };

    // The application stops without tidying up — a crash, a kill, a power cut.
    let db = Db::open(&path).expect("reopen");
    let recovered = commission::recover(&db).expect("recover");
    summonings::recover(&db).expect("recover summonings");

    assert_eq!(recovered, vec![running.clone()]);

    // The one that was running could not have survived its process, so it is a misfire that
    // says so — not a familiar that appears to still be working, for ever.
    assert_eq!(commission::get(&db, &running).expect("get").expect("row").status, Status::Misfired);
    // The one that never started is still a perfectly good request.
    assert_eq!(commission::get(&db, &queued).expect("get").expect("row").status, Status::Queued);
    // And a finished one is left exactly as it was.
    assert_eq!(commission::get(&db, &done).expect("get").expect("row").status, Status::Done);

    // Crucially, the familiar is free again: a stranded row must not block its queue for ever.
    assert_eq!(commission::next_to_run(&db, "vellum").expect("next").expect("free").id, queued);

    // The ledger says why, rather than leaving a status change unexplained.
    let said = ledger::recent(&db, 20)
        .expect("ledger")
        .iter()
        .any(|e| e.payload.to_string().contains("Grimoire stopped while this was running"));
    assert!(said, "the misfire was recorded without a reason");
}

#[test]
fn recovery_is_safe_to_run_twice() {
    // The application may restart twice in quick succession.
    let db = study();
    let id = place(&db, "vellum", "x");
    let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");
    commission::start(&db, &id, &s).expect("start");

    assert_eq!(commission::recover(&db).expect("first").len(), 1);
    assert!(commission::recover(&db).expect("second").is_empty());
    assert_eq!(commission::get(&db, &id).expect("get").expect("row").status, Status::Misfired);
}

#[test]
fn usage_lands_on_the_commission_and_in_the_ledger() {
    let db = study();
    let id = place(&db, "vellum", "x");
    let tokens = Tokens { input: 1_000, output: 500, cache_read: 20_000, cache_write: 3_000 };
    let cost = ledger::cost::estimate(tokens, "claude-sonnet-4-6");

    commission::record_usage(&db, &id, tokens, 7, cost).expect("usage");

    let c = commission::get(&db, &id).expect("get").expect("row");
    assert_eq!(c.turns, 7);
    assert_eq!(c.tokens.output, 500);
    // tokens_in on the row carries everything that went in, cache included.
    assert_eq!(c.tokens.input, 24_000);
    assert!(c.cost.usd > 0.0);
    assert!(c.cost.estimated, "a cost that has forgotten it is an estimate");

    assert!(
        ledger::recent(&db, 10).expect("ledger").iter().any(|e| e.kind == ledger::EventKind::Usage),
        "usage was not recorded in the ledger"
    );
}

#[test]
fn the_ledger_rolls_up_by_familiar_and_by_day_and_never_settles_the_cost() {
    // §6.9: spend by familiar and by day, and "never display it as a settled number".
    let db = study();
    let a = place(&db, "vellum", "a");
    let b = place(&db, "anvil", "b");
    commission::record_usage(&db, &a, Tokens { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 }, 3, Estimate::usd(3.0)).expect("a");
    commission::record_usage(&db, &b, Tokens { input: 0, output: 1_000_000, cache_read: 0, cache_write: 0 }, 5, Estimate::usd(15.0)).expect("b");

    let s = ledger::summary(&db).expect("summary");
    assert_eq!(s.commissions, 2);
    assert_eq!(s.by_familiar.len(), 2);
    // Ordered by spend, so the expensive familiar is the one you see first.
    assert_eq!(s.by_familiar[0].familiar_id, "anvil");
    assert!(s.total.estimated, "the headline total must still say it is an estimate");
    assert!((s.total.usd - 18.0).abs() < 1e-9);

    assert_eq!(s.by_day.len(), 1, "both ran today");
    assert!(s.by_day[0].cost.estimated);
    assert_eq!(s.by_day[0].commissions, 2);
}

#[test]
fn the_ledger_is_append_only_and_keeps_the_order_things_happened() {
    let db = study();
    let id = place(&db, "vellum", "x");
    let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");
    commission::start(&db, &id, &s).expect("start");
    commission::finish(&db, &id, Status::Done, None).expect("finish");

    let events = ledger::recent(&db, 10).expect("recent");
    let kinds: Vec<_> = events.iter().map(|e| e.kind).collect();
    // Newest first, so the story reads backwards from the end.
    assert_eq!(
        kinds,
        vec![
            ledger::EventKind::CommissionEnded,
            ledger::EventKind::CommissionStarted,
            ledger::EventKind::CommissionQueued
        ]
    );
    assert!(events.iter().all(|e| e.familiar_id.as_deref() == Some("vellum")));
}

#[test]
fn a_burst_of_commissions_keeps_the_order_they_were_placed_in() {
    // §9 stores `created` in whole seconds, so a burst shares a timestamp. Ordering on that —
    // or on the id, whose ULID tail is random rather than monotonic — serves them out of turn.
    // Twelve at once is well inside one second on any machine.
    let db = study();
    let placed: Vec<String> = (0..12).map(|i| place(&db, "vellum", &format!("number {i}"))).collect();

    let listed = commission::for_familiar(&db, "vellum").expect("list");
    let newest_first: Vec<&String> = listed.iter().map(|c| &c.id).collect();
    let expected: Vec<&String> = placed.iter().rev().collect();
    assert_eq!(newest_first, expected, "the list is not in the order they were placed");

    // And the queue serves them oldest first, one at a time, all the way down.
    for (i, expected_id) in placed.iter().enumerate() {
        let next = commission::next_to_run(&db, "vellum").expect("next").expect("one waiting");
        assert_eq!(&next.id, expected_id, "served out of turn at position {i}");
        let s = summonings::open(&db, "vellum", "claude", "sonnet", "/tmp", "none", 1).expect("summon");
        commission::start(&db, &next.id, &s).expect("start");
        commission::finish(&db, &next.id, Status::Done, None).expect("finish");
    }
    assert!(commission::next_to_run(&db, "vellum").expect("next").is_none());
}

#[test]
fn a_cost_of_nothing_is_still_an_estimate() {
    // §6.9 says a cost is labelled as an estimate *everywhere it appears*, and a commission that
    // has not run yet is where it appears most often. A derived Default sets the flag to false,
    // so this is the case that silently broke the rule until the interface rejected it.
    assert!(Estimate::default().estimated, "a default cost forgot it was an estimate");
    assert_eq!(Estimate::default().usd, 0.0);

    let db = study();
    let fresh = commission::create(&db, "vellum", "nothing yet", &serde_json::json!({})).expect("create");
    assert!(fresh.cost.estimated, "a freshly placed commission's cost is not labelled");

    let read_back = commission::get(&db, &fresh.id).expect("get").expect("row");
    assert!(read_back.cost.estimated, "reading it back lost the label");

    // And the roll-up over nothing, which is what an empty ledger shows.
    assert!(ledger::summary(&db).expect("summary").total.estimated);
}
