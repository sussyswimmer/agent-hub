//! §9: every migration has a matching test that runs it against a seeded db.

use grimoire_core::db::{self, migrations, Db};
use grimoire_core::paths::{expand, Paths};

const TABLES: [&str; 7] = ["familiars", "summonings", "commissions", "seals", "wards", "ledger_events", "settings"];

fn table_names(db: &Db) -> Vec<String> {
    let guard = db.conn().expect("conn");
    let mut stmt = guard.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").expect("prepare");
    stmt.query_map([], |r| r.get(0)).expect("query").collect::<Result<Vec<String>, _>>().expect("rows")
}

#[test]
fn migration_001_creates_the_whole_schema() {
    let db = Db::memory().expect("db");
    assert_eq!(migrations::version(&db).expect("version"), 1);
    let names = table_names(&db);
    for t in TABLES {
        assert!(names.contains(&t.to_string()), "missing table {t}");
    }
}

#[test]
fn migrations_are_idempotent_across_reopen() {
    let tmp = tempfile::tempdir().expect("tmp");
    let file = tmp.path().join("grimoire.db");
    let db = Db::open(&file).expect("open");
    assert_eq!(migrations::version(&db).expect("v"), 1);
    drop(db);

    let db = Db::open(&file).expect("reopen");
    assert!(migrations::apply(&db).expect("apply").is_empty(), "nothing re-applied on reopen");
    assert_eq!(migrations::version(&db).expect("v"), 1);

    let mode: String = db.conn().expect("conn").query_row("PRAGMA journal_mode", [], |r| r.get(0)).expect("pragma");
    assert_eq!(mode, "wal");
}

#[test]
fn seeded_rows_satisfy_the_foreign_keys() {
    let db = Db::memory().expect("db");
    let (fam, now) = (db::id(), db::now());
    {
        let guard = db.conn().expect("conn");
        guard
            .execute(
                "INSERT INTO familiars(id, name, order_name, binding_path, binding_hash, first_seen)
                 VALUES (?1, 'Vellum', 'quill', '/b/vellum.binding.md', 'abc', ?2)",
                rusqlite::params![fam, now],
            )
            .expect("familiar");
        guard
            .execute(
                "INSERT INTO commissions(id, familiar_id, prompt, intake_json, status, created)
                 VALUES ('c1', ?1, 'line edit', '{}', 'queued', ?2)",
                rusqlite::params![fam, now],
            )
            .expect("commission");
        guard
            .execute(
                "INSERT INTO seals(id, commission_id, kind, detail_json, raised) VALUES ('s1', 'c1', 'write', '{}', ?1)",
                rusqlite::params![now],
            )
            .expect("seal");
        // A commission pointing at a familiar that does not exist must be refused.
        let orphan = guard.execute(
            "INSERT INTO commissions(id, familiar_id, prompt, intake_json, status, created)
             VALUES ('c2', 'ghost', 'x', '{}', 'queued', ?1)",
            rusqlite::params![now],
        );
        assert!(orphan.is_err(), "foreign keys are not being enforced");
    }
    let open: i64 = db
        .conn()
        .expect("conn")
        .query_row("SELECT COUNT(*) FROM seals WHERE resolved IS NULL", [], |r| r.get(0))
        .expect("count");
    assert_eq!(open, 1);
}

#[test]
fn settings_round_trip() {
    let db = Db::memory().expect("db");
    assert_eq!(db.setting("engine.claude.path").expect("get"), None);
    db.set_setting("engine.claude.path", "/usr/local/bin/claude").expect("set");
    db.set_setting("engine.claude.path", "/opt/bin/claude").expect("update");
    assert_eq!(db.setting("engine.claude.path").expect("get").as_deref(), Some("/opt/bin/claude"));
}

#[test]
fn paths_honour_the_home_override_and_expand_tilde() {
    let tmp = tempfile::tempdir().expect("tmp");
    unsafe { std::env::set_var("GRIMOIRE_HOME", tmp.path()) };
    let p = Paths::resolve().expect("resolve");
    unsafe { std::env::remove_var("GRIMOIRE_HOME") };
    assert_eq!(p.home, tmp.path());
    assert_eq!(p.bindings(), tmp.path().join("bindings"));
    assert_eq!(p.db_file(), tmp.path().join("grimoire.db"));
    p.ensure().expect("ensure");
    assert!(p.bindings().is_dir() && p.codex_dir().is_dir() && p.worktrees().is_dir());

    let base = std::path::Path::new("/b");
    assert_eq!(expand("/abs/path", base), std::path::PathBuf::from("/abs/path"));
    assert_eq!(expand("rel/path", base), std::path::PathBuf::from("/b/rel/path"));
    let home = std::env::home_dir().expect("home");
    assert_eq!(expand("~/work/essays", base), home.join("work/essays"));
    assert_eq!(expand("  ~/spaced  ", base), home.join("spaced"));
}
