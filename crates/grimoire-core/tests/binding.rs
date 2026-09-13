//! Phase 2 acceptance (CLAUDE.md §12): bindings are files, and a bad one is shown rather than
//! dropped.

use std::path::Path;

use grimoire_core::binding::schema::{IntakeKind, OnExceed, Reliquary, Resume};
use grimoire_core::binding::{load_folder, parse, summarise};
use grimoire_core::types::{Autonomy, Engine, Isolation, Order, SigilState};

const FULL: &str = r#"---
name: Vellum
order: quill
sigil: quill-01
engine: claude
model: claude-sonnet-4-6
workspace: ~/work/essays
isolation: worktree
resume: session
autonomy: bounded
bounds:
  write: ["~/work/essays/**"]
  deny: ["**/.env", "~/.ssh/**"]
  network: false
  shell: ["git status", "git diff"]
aether:
  tokens: 250000
  turns: 40
  minutes: 30
  on_exceed: bind
codex: ~/.grimoire/codex/vellum.md
reliquary: read
intake:
  - id: piece
    ask: "Which piece are we working on?"
    type: text
    required: true
  - id: mode
    ask: "What kind of pass?"
    type: select
    options: [line edit, structural]
    required: true
---

# Writ

You are Vellum, an editor.

## Process
1. Read the piece in full.
"#;

fn at(name: &str) -> std::path::PathBuf {
    Path::new("/tmp/bindings").join(format!("{name}.binding.md"))
}

#[test]
fn a_complete_binding_parses_into_every_field() {
    let b = parse("vellum", &at("vellum"), FULL);
    assert_eq!(b.error, None, "should have parsed");
    assert!(b.warnings.is_empty(), "unexpected warnings: {:?}", b.warnings);

    let f = b.front.expect("frontmatter");
    assert_eq!(f.name, "Vellum");
    assert_eq!(f.order, Order::Quill);
    assert_eq!(f.engine, Engine::Claude);
    assert_eq!(f.model.as_deref(), Some("claude-sonnet-4-6"));
    assert_eq!(f.isolation, Isolation::Worktree);
    assert_eq!(f.resume, Resume::Session);
    assert_eq!(f.autonomy, Autonomy::Bounded);
    assert_eq!(f.reliquary, Reliquary::Read);
    assert_eq!(f.bounds.deny, vec!["**/.env", "~/.ssh/**"]);
    assert!(!f.bounds.network);
    assert_eq!(f.aether.tokens, Some(250_000));
    assert_eq!(f.aether.on_exceed, OnExceed::Bind);
    assert_eq!(f.intake.len(), 2);
    assert_eq!(f.intake[1].kind, IntakeKind::Select);
    assert!(f.intake[1].required);
}

#[test]
fn the_writ_is_the_body_verbatim() {
    // §4: "passed verbatim to the CLI... Do not template it, do not inject anything into it."
    let b = parse("vellum", &at("vellum"), FULL);
    assert!(b.writ.starts_with("# Writ"), "got: {:?}", &b.writ[..40.min(b.writ.len())]);
    assert!(b.writ.contains("You are Vellum, an editor."));
    assert!(b.writ.contains("1. Read the piece in full."));
    // Nothing from the frontmatter leaked into it.
    assert!(!b.writ.contains("order:"));
    assert!(!b.writ.contains("---"));
}

#[test]
fn a_writ_containing_a_horizontal_rule_is_not_cut_short() {
    // The frontmatter fence and a markdown rule look alike. Splitting on the first `---`
    // anywhere would silently truncate a writ, and the familiar would lose half its briefing
    // without anything looking wrong.
    let text = "---\nname: Anvil\norder: crucible\nengine: claude\nworkspace: ~/src\n---\n\
                \nFirst part.\n\n---\n\nSecond part, after a rule.\n";
    let b = parse("anvil", &at("anvil"), text);
    assert_eq!(b.error, None);
    assert!(b.writ.contains("First part."));
    assert!(b.writ.contains("Second part, after a rule."), "the writ was truncated: {:?}", b.writ);
}

#[test]
fn defaults_are_the_cautious_ones() {
    let text = "---\nname: Tally\norder: ledger\nengine: claude\nworkspace: ~/n\n---\nwrit\n";
    let f = parse("tally", &at("tally"), text).front.expect("front");
    // §6.4: a binding that forgets to say gets the rung that asks before acting.
    assert_eq!(f.autonomy, Autonomy::Propose, "the default autonomy must be the safest one");
    assert_eq!(f.isolation, Isolation::None);
    assert_eq!(f.resume, Resume::None);
    assert_eq!(f.reliquary, Reliquary::None);
    assert!(!f.bounds.network, "network must be off unless asked for");
    assert_eq!(f.aether.tokens, None, "no budget is not the same as a zero budget");
}

#[test]
fn an_unknown_key_is_a_warning_and_the_binding_still_loads() {
    // §4, explicitly: "Unknown frontmatter keys are a validation warning, not an error."
    let text = "---\nname: Sconce\norder: lantern\nengine: claude\nworkspace: ~/r\n\
                temperature: 0.7\nbounds:\n  wirte: [\"~/r/**\"]\n---\nwrit\n";
    let b = parse("sconce", &at("sconce"), text);

    assert_eq!(b.error, None, "an unknown key must not break the binding");
    assert!(b.front.is_some(), "it must still load");
    assert!(
        b.warnings.iter().any(|w| w.contains("temperature")),
        "no warning for the unknown top-level key: {:?}",
        b.warnings
    );
    assert!(
        b.warnings.iter().any(|w| w.contains("wirte")),
        "a typo nested inside `bounds` was not caught: {:?}",
        b.warnings
    );
}

#[test]
fn a_bad_order_is_an_error_that_names_the_alternatives() {
    // §12 Phase 2: "a binding with a bad `order` shows the error in the rail and does not crash".
    let text = "---\nname: Odd\norder: brass\nengine: claude\nworkspace: ~/x\n---\nwrit\n";
    let b = parse("odd", &at("odd"), text);

    let err = b.error.expect("should be an error");
    assert!(err.contains("brass"), "the message should name what was wrong: {err}");
    assert!(err.contains("quill"), "and what is allowed instead: {err}");
    assert!(b.front.is_none(), "never half-loaded");
}

#[test]
fn a_missing_required_field_says_which_one() {
    let text = "---\nname: Nameless\nengine: claude\nworkspace: ~/x\n---\nwrit\n";
    let err = parse("nameless", &at("nameless"), text).error.expect("error");
    assert!(err.contains("order"), "{err}");
    assert!(err.contains("Add it"), "should say what to do: {err}");
}

#[test]
fn a_file_with_no_frontmatter_says_what_a_binding_looks_like() {
    let b = parse("prose", &at("prose"), "Just some notes I left in the folder.\n");
    let err = b.error.expect("error");
    assert!(err.contains("---"), "should show the shape expected: {err}");
}

#[test]
fn a_broken_binding_still_appears_in_the_rail_in_oxblood() {
    // §4: "shown in the sidebar in oxblood with the validation error inline — never silently
    // dropped, never partially loaded."
    let b = parse("odd", &at("odd"), "---\nname: Odd\norder: brass\nengine: claude\nworkspace: ~/x\n---\n");
    let row = summarise(&b);

    assert_eq!(row.id, "odd");
    assert_eq!(row.state, SigilState::Misfired, "which is what draws it in oxblood");
    assert!(row.error.is_some(), "the reason has to travel with the row");
    assert!(row.cannot_summon.is_some(), "and it must not be summonable");
}

#[test]
fn an_engine_that_cannot_be_sealed_loads_but_cannot_be_summoned() {
    // Decision 3, recorded in DECISIONS.md 0004. It lists, with the reason on hover; it is not
    // hidden, and the button is not a lie.
    let text = "---\nname: Codexer\norder: crucible\nengine: codex\nworkspace: ~/x\n---\nwrit\n";
    let b = parse("codexer", &at("codexer"), text);
    assert_eq!(b.error, None, "it must parse — the gate is about summoning, not reading");

    let row = summarise(&b);
    assert_eq!(row.engine, Engine::Codex);
    let why = row.cannot_summon.expect("should say why it cannot be summoned");
    assert!(why.contains("sealed"), "{why}");
    assert!(row.error.is_none(), "it is not broken, only ungated");
}

#[test]
fn bounds_set_at_the_wrong_autonomy_are_flagged_rather_than_silently_ignored() {
    // The dangerous misunderstanding: `bounds` reads as protection, but §6.4 only consults it at
    // `autonomy: bounded`. A binding that lists deny paths under `free` has none of them.
    let text = "---\nname: Loose\norder: crucible\nengine: claude\nworkspace: ~/x\n\
                autonomy: free\nbounds:\n  deny: [\"~/.ssh/**\"]\n---\nwrit\n";
    let b = parse("loose", &at("loose"), text);
    assert_eq!(b.error, None);
    assert!(
        b.warnings.iter().any(|w| w.contains("only read when")),
        "a deny list that does nothing must say so: {:?}",
        b.warnings
    );
}

#[test]
fn a_zero_token_budget_is_flagged_because_it_is_probably_a_mistake() {
    let text = "---\nname: Zero\norder: ledger\nengine: claude\nworkspace: ~/x\n\
                aether:\n  tokens: 0\n---\nwrit\n";
    let b = parse("zero", &at("zero"), text);
    assert!(b.warnings.iter().any(|w| w.contains("zero or less")), "{:?}", b.warnings);
}

#[test]
fn windows_line_endings_and_a_byte_order_mark_do_not_break_parsing() {
    let text = "\u{feff}---\r\nname: Vellum\r\norder: quill\r\nengine: claude\r\n\
                workspace: ~/w\r\n---\r\n\r\nThe writ.\r\n";
    let b = parse("vellum", &at("vellum"), text);
    assert_eq!(b.error, None, "a file from another editor should still load");
    assert_eq!(b.writ.trim(), "The writ.");
}

#[test]
fn a_folder_loads_every_binding_and_ignores_everything_else() {
    let tmp = tempfile::tempdir().expect("tmp");
    std::fs::write(tmp.path().join("vellum.binding.md"), FULL).unwrap();
    std::fs::write(
        tmp.path().join("anvil.binding.md"),
        "---\nname: Anvil\norder: crucible\nengine: claude\nworkspace: ~/src\n---\nwrit\n",
    )
    .unwrap();
    // Things people leave next to their files. None of these is a familiar, and none is an error.
    std::fs::write(tmp.path().join("notes.md"), "reminders").unwrap();
    std::fs::write(tmp.path().join("vellum.binding.md.bak"), "old").unwrap();
    std::fs::write(tmp.path().join(".vellum.binding.md.swp"), "editor").unwrap();

    let found = load_folder(tmp.path());
    assert_eq!(found.len(), 2, "found: {:?}", found.keys().collect::<Vec<_>>());
    assert!(found.contains_key("vellum") && found.contains_key("anvil"));
}

#[test]
fn a_bindings_folder_that_does_not_exist_yet_is_simply_empty() {
    // The state on first launch. An error here would greet a new user with a failure.
    assert!(load_folder(Path::new("/nonexistent/bindings")).is_empty());
}

// ── The watcher ────────────────────────────────────────────────────────────────────────

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn wait_for(timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    f()
}

#[test]
fn a_new_binding_is_noticed_without_a_restart() {
    // §12 Phase 2: "adding a `.binding.md` makes a familiar appear within 2s with no restart."
    let tmp = tempfile::tempdir().expect("tmp");
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();

    let _watcher = {
        let seen = Arc::clone(&seen);
        grimoire_core::binding::watch(tmp.path(), move |paths| {
            let mut s = seen.lock().expect("lock");
            for p in paths {
                s.push(grimoire_core::binding::id_for(&p));
            }
        })
        .expect("watch")
    };

    std::fs::write(
        tmp.path().join("sconce.binding.md"),
        "---\nname: Sconce\norder: lantern\nengine: claude\nworkspace: ~/r\n---\nwrit\n",
    )
    .unwrap();

    assert!(
        wait_for(Duration::from_secs(2), || seen.lock().expect("lock").contains(&"sconce".into())),
        "the new binding was not noticed within 2s"
    );

    // And a delete has to reach the rail too, or a removed familiar lingers for ever.
    seen.lock().expect("lock").clear();
    std::fs::remove_file(tmp.path().join("sconce.binding.md")).unwrap();
    assert!(
        wait_for(Duration::from_secs(2), || seen.lock().expect("lock").contains(&"sconce".into())),
        "the deletion was not noticed"
    );
}

#[test]
fn one_save_is_one_reload_not_three() {
    // An editor writing a file produces a burst of events — truncate, write, sometimes a rename
    // over the top. Reloading on each one flashes a half-written file's validation error into
    // the rail. The debounce is what stops that, so it is worth asserting rather than assuming.
    let tmp = tempfile::tempdir().expect("tmp");
    let calls = Arc::new(Mutex::new(0usize));

    let _watcher = {
        let calls = Arc::clone(&calls);
        grimoire_core::binding::watch(tmp.path(), move |_| {
            *calls.lock().expect("lock") += 1;
        })
        .expect("watch")
    };

    let path = tmp.path().join("anvil.binding.md");
    for i in 0..6 {
        std::fs::write(&path, format!("---\nname: Anvil{i}\norder: crucible\nengine: claude\nworkspace: ~/s\n---\nw\n")).unwrap();
        std::thread::sleep(Duration::from_millis(20));
    }

    assert!(wait_for(Duration::from_secs(3), || *calls.lock().expect("lock") > 0), "never fired");
    std::thread::sleep(Duration::from_millis(600));
    let n = *calls.lock().expect("lock");
    assert!(n <= 2, "six quick saves produced {n} reloads; the debounce is not holding");
}

#[test]
fn a_file_that_is_not_a_binding_does_not_wake_the_watcher() {
    let tmp = tempfile::tempdir().expect("tmp");
    let calls = Arc::new(Mutex::new(0usize));

    let _watcher = {
        let calls = Arc::clone(&calls);
        grimoire_core::binding::watch(tmp.path(), move |_| {
            *calls.lock().expect("lock") += 1;
        })
        .expect("watch")
    };

    std::fs::write(tmp.path().join("notes.md"), "scratch").unwrap();
    std::fs::write(tmp.path().join("vellum.binding.md.bak"), "old").unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(*calls.lock().expect("lock"), 0, "an unrelated file triggered a reload");
}

// ── The shipped seeds ──────────────────────────────────────────────────────────────────

#[test]
fn all_five_seed_bindings_load_without_error_or_warning() {
    // §12 Phase 2: "all five seeds load". A seed that fails to parse would greet a new user with
    // five broken familiars, which is the worst possible first impression and entirely
    // preventable. Warnings count too: a shipped example should not be teaching a typo.
    let seeds = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../seeds");
    let found = load_folder(&seeds);

    assert_eq!(
        found.len(),
        5,
        "expected five seeds, found {:?}",
        found.keys().collect::<Vec<_>>()
    );

    for (id, b) in &found {
        assert_eq!(b.error, None, "seed `{id}` does not parse: {:?}", b.error);
        assert!(b.warnings.is_empty(), "seed `{id}` has warnings: {:?}", b.warnings);

        let f = b.front.as_ref().expect("frontmatter");
        assert!(!b.writ.trim().is_empty(), "seed `{id}` has no writ");
        assert!(b.writ.contains("# Writ"), "seed `{id}`'s writ has no heading");
        assert_eq!(f.engine, Engine::Claude, "seed `{id}` must be summonable in v1");
        assert!(!f.intake.is_empty(), "seed `{id}` asks nothing before a commission");

        // §3: the verb on the button is the verb in the result, and the copy is sentence case.
        // A seed shouting at the user sets the tone for every binding written after it.
        assert!(
            !f.name.chars().all(|c| !c.is_lowercase()),
            "seed `{id}` has an ALL-CAPS name"
        );
        for field in &f.intake {
            assert!(
                field.ask.ends_with('?'),
                "seed `{id}` asks `{}` without a question mark",
                field.ask
            );
            if field.kind == IntakeKind::Select {
                assert!(!field.options.is_empty(), "seed `{id}` has an empty select");
            }
        }
    }

    // One of each order, so the rail shows five distinct sigil colours out of the box (§3).
    let mut orders: Vec<Order> = found.values().filter_map(|b| b.front.as_ref()).map(|f| f.order).collect();
    orders.sort_by_key(|o| format!("{o:?}"));
    orders.dedup();
    assert_eq!(orders.len(), 5, "the five seeds should cover the five orders");
}

#[test]
fn the_builder_seed_is_bounded_and_cannot_reach_the_things_that_matter() {
    // Anvil is the only seed that writes code, so it is the only one where a mistake in the
    // shipped defaults would be expensive. §6.4's never-exempt list is enforced in Rust from
    // Phase 4, but the seed should not be asking for trouble in the meantime.
    let seeds = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../seeds");
    let anvil = load_folder(&seeds).remove("anvil").expect("the anvil seed");
    let f = anvil.front.expect("frontmatter");

    assert_eq!(f.autonomy, Autonomy::Bounded, "a builder must not ship as `free`");
    assert_eq!(f.isolation, Isolation::Worktree, "it should work on a branch, not in place");
    assert!(!f.bounds.network, "network stays off unless it is asked for");

    for guarded in ["**/.env", "~/.ssh/**"] {
        assert!(
            f.bounds.deny.iter().any(|d| d == guarded),
            "the builder seed does not deny {guarded}: {:?}",
            f.bounds.deny
        );
    }
    for cmd in &f.bounds.shell {
        assert!(
            !cmd.contains("push") && !cmd.contains("rm "),
            "the builder seed pre-approves `{cmd}`, which it should be proposing instead"
        );
    }
}

#[test]
fn no_seed_hard_codes_the_study_folder() {
    // A seed that writes `~/.grimoire/...` resolves against the user's home, not `GRIMOIRE_HOME`,
    // so it points at the wrong study under a test home or a second install. Caught by the codex
    // tab in the running application reading from `/root/.grimoire` while the app was using a
    // temporary home. Paths Grimoire owns are Grimoire's to choose.
    let seeds = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../seeds");
    for (id, b) in load_folder(&seeds) {
        let front = b.front.as_ref().expect("frontmatter");
        assert!(
            front.codex.is_none(),
            "seed `{id}` names a codex path; leave it unset so it lands in whichever study is running"
        );
        assert!(
            !front.workspace.contains(".grimoire"),
            "seed `{id}` points its workspace inside the study's own folder"
        );
    }
}
