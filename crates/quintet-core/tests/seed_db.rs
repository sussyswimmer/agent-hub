//! Seeding is idempotent and never overwrites; migrations apply once on a fresh DB.

use std::fs;

use quintet_core::db::{migrations, settings, Db};
use quintet_core::paths::QuintetPaths;
use quintet_core::seed::{seed, SeedSource};

fn fixture_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/defaults")
}

#[test]
fn seed_creates_agents_and_profile_once() {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    let src = SeedSource::from_root(fixture_root());

    let first = seed(&src, &paths).expect("seed");
    assert_eq!(first.agents_created, vec!["alpha".to_string(), "beta".to_string()], "{first:?}");
    assert!(first.profile_created);
    assert!(paths.agent_md("alpha").is_file());
    assert!(paths.memory_md("alpha").is_file());
    assert!(paths.workspace("alpha").is_dir());
    assert!(paths.profile_md().is_file());
    assert!(paths.logs_runs().is_dir());
    assert!(paths.backups().is_dir());

    // User edits survive a second seed.
    fs::write(paths.agent_md("alpha"), "---\nid: alpha\n---\nedited").expect("write");
    fs::write(paths.profile_md(), "# mine").expect("write");
    let second = seed(&src, &paths).expect("seed again");
    assert!(second.agents_created.is_empty());
    assert!(!second.profile_created);
    assert_eq!(fs::read_to_string(paths.agent_md("alpha")).expect("read"), "---\nid: alpha\n---\nedited");
    assert_eq!(fs::read_to_string(paths.profile_md()).expect("read"), "# mine");
}

#[test]
fn seed_backfills_memory_and_workspace_for_user_agents() {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    let src = SeedSource::from_root(fixture_root());
    seed(&src, &paths).expect("seed");
    // Simulate a hand-made agent with only agent.md, then re-seed.
    fs::create_dir_all(paths.agent_dir("custom")).expect("mkdir");
    fs::write(paths.agent_md("custom"), "---\nid: custom\n---\n").expect("write");
    // Only agents present in the defaults dir are iterated, so custom is untouched by design.
    seed(&src, &paths).expect("seed");
    assert!(!paths.memory_md("custom").exists());
}

#[test]
fn migrations_apply_once_and_are_idempotent() {
    let tmp = tempfile::tempdir().expect("tmp");
    let db_path = tmp.path().join("data").join("quintet.db");
    let db = Db::open(&db_path).expect("open");
    assert_eq!(migrations::current_version(&db).expect("version"), 1);
    // Re-open: nothing new applied, schema intact.
    drop(db);
    let db = Db::open(&db_path).expect("reopen");
    assert_eq!(migrations::current_version(&db).expect("version"), 1);
    let applied = migrations::apply(&db).expect("apply");
    assert!(applied.is_empty());

    // WAL + settings round-trip.
    let mode: String = db.conn().expect("conn").query_row("PRAGMA journal_mode", [], |r| r.get(0)).expect("pragma");
    assert_eq!(mode, "wal");
    settings::set(&db, "k", "v").expect("set");
    settings::set(&db, "k", "v2").expect("upsert");
    assert_eq!(settings::get(&db, "k").expect("get").as_deref(), Some("v2"));
    assert_eq!(settings::all(&db).expect("all").len(), 1);

    // Every §8 table exists.
    let guard = db.conn().expect("conn");
    let mut stmt = guard.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").expect("prep");
    let names: Vec<String> = stmt.query_map([], |r| r.get(0)).expect("q").map(|r| r.expect("row")).collect();
    for t in ["agents","runs","run_events","tasks","questions","actions","outputs","schedules","quintet_events","settings","sources","colleges","requirements","essays","activities","honors","opportunities","school_items","school_subtasks","course_policies","cards","card_state","reviews","weak_spots"] {
        assert!(names.contains(&t.to_string()), "missing table {t}");
    }
}

#[test]
fn paths_honour_quintet_home_env() {
    // Set + read in the same test to avoid cross-test env races.
    let tmp = tempfile::tempdir().expect("tmp");
    unsafe { std::env::set_var("QUINTET_HOME", tmp.path()) };
    let p = QuintetPaths::resolve().expect("resolve");
    unsafe { std::env::remove_var("QUINTET_HOME") };
    assert_eq!(p.home, tmp.path());
    assert_eq!(p.db_file(), tmp.path().join("data").join("quintet.db"));
}
