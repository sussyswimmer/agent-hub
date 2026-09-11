use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use quintet_core::db::Db;
use quintet_core::paths::QuintetPaths;
use quintet_core::registry::{parse_agent_md, Registry};
use quintet_core::types::{Integrity, IntegrityMode, IntakeType, Model};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/agents").join(name).join("agent.md")).expect("fixture")
}

#[test]
fn parses_minimal_and_full() {
    let a = parse_agent_md(&fixture("ok-minimal"), "ok-minimal", Path::new("x"));
    assert!(a.error.is_none(), "{:?}", a.error);
    let d = a.def.expect("def");
    assert_eq!(d.model, Model::Haiku);
    assert_eq!(d.max_turns, 40);
    assert_eq!(d.integrity, Integrity::Flag(false));
    assert_eq!(a.body.trim(), "You are Minimal.");

    let a = parse_agent_md(&fixture("ok-full"), "ok-full", Path::new("x"));
    assert!(a.error.is_none(), "{:?}", a.error);
    let d = a.def.expect("def");
    assert_eq!(d.integrity, Integrity::Mode(IntegrityMode::WhenGraded));
    assert_eq!(d.intake.len(), 5);
    assert_eq!(d.intake[0].kind, IntakeType::Text);
    assert!(d.intake[0].from_chat);
    assert_eq!(d.intake[4].max, Some(2));
    assert_eq!(d.schedules[0].tz, "Asia/Saigon");
    assert_eq!(d.schedules[0].model, Some(Model::Sonnet));
    assert!(a.body.contains("# Role"));
    assert_eq!(a.hash.len(), 64);
}

#[test]
fn broken_files_report_errors_without_panicking() {
    let a = parse_agent_md(&fixture("broken-yaml"), "broken-yaml", Path::new("x"));
    assert!(a.def.is_none());
    assert!(a.error.as_deref().unwrap_or("").starts_with("YAML:"), "{:?}", a.error);

    let a = parse_agent_md(&fixture("broken-schema"), "broken-schema", Path::new("x"));
    let e = a.error.expect("error");
    assert!(e.contains("/color") || e.contains("color"), "{e}");
    assert!(e.contains("model"), "{e}");
    assert!(e.contains("extra_field"), "{e}");

    let a = parse_agent_md(&fixture("broken-semantic"), "broken-semantic", Path::new("x"));
    let e = a.error.expect("error");
    assert!(e.contains("must equal the folder name"), "{e}");
    assert!(e.contains("duplicate field id"), "{e}");
    assert!(e.contains("not one of the options"), "{e}");
    assert!(e.contains("skip_if"), "{e}");
    assert!(e.contains("state_snapshot"), "{e}");
    assert!(e.contains("cron"), "{e}");
    assert!(e.contains("timezone"), "{e}");
    assert!(a.def.is_some(), "def kept for the badge");

    let a = parse_agent_md("no frontmatter", "x", Path::new("x"));
    assert!(a.error.is_some());
}

#[test]
fn load_all_caches_and_watch_reloads_within_a_second() {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path());
    paths.ensure_dirs().expect("dirs");
    for name in ["ok-minimal", "broken-yaml"] {
        std::fs::create_dir_all(paths.agent_dir(name)).expect("mkdir");
        std::fs::write(paths.agent_md(name), fixture(name)).expect("write");
    }
    let db = Db::open_in_memory().expect("db");
    let reg = Arc::new(Registry::new(paths.clone(), Some(db.clone())));
    let summaries = reg.load_all().expect("load");
    assert_eq!(summaries.len(), 2);
    let broken = summaries.iter().find(|s| s.id == "broken-yaml").expect("broken");
    assert!(broken.error.is_some());
    let ok = summaries.iter().find(|s| s.id == "ok-minimal").expect("ok");
    assert!(ok.error.is_none());
    assert_eq!(ok.name, "Minimal");
    assert!(reg.require("ok-minimal").is_ok());
    assert!(reg.require("broken-yaml").is_err());
    assert!(reg.require("nope").is_err());

    let cached: i64 = db.conn().expect("conn").query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0)).expect("count");
    assert_eq!(cached, 2);

    // Watch: edit the name, expect a callback within 1 s.
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen2 = Arc::clone(&seen);
    let _handle = reg.watch(move |s| {
        let names: Vec<String> = s.iter().map(|a| a.name.clone()).collect();
        seen2.lock().expect("lock").push(names.join(","));
    }).expect("watch");
    std::thread::sleep(Duration::from_millis(200)); // let the watcher arm
    let t0 = Instant::now();
    std::fs::write(paths.agent_md("ok-minimal"), fixture("ok-minimal").replace("name: Minimal", "name: Renamed")).expect("write");
    let deadline = t0 + Duration::from_secs(3);
    let mut fired = None;
    while Instant::now() < deadline {
        if seen.lock().expect("lock").iter().any(|s| s.contains("Renamed")) { fired = Some(t0.elapsed()); break; }
        std::thread::sleep(Duration::from_millis(20));
    }
    let elapsed = fired.expect("watcher callback with the new name");
    assert!(elapsed < Duration::from_secs(1), "sidebar update took {elapsed:?}");
    assert_eq!(reg.get("ok-minimal").expect("get").and_then(|a| a.def).map(|d| d.name).as_deref(), Some("Renamed"));
}
