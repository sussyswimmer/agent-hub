//! RunManager against `tests/bin/fake-claude.sh`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use quintet_core::db::{self, Db};
use quintet_core::paths::QuintetPaths;
use quintet_core::registry::Registry;
use quintet_core::runs::{RunConfig, RunManager, RunSink};
use quintet_core::seed::{seed, SeedSource};
use quintet_core::types::{QuestionItem, RunRow, RunStatus, StartRunArgs, UiRow, UiRowKind};
use quintet_core::Core;

fn manifest() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")) }
fn fake_claude() -> PathBuf { manifest().join("tests/bin/fake-claude.sh") }
fn fixture(name: &str) -> String { manifest().join("tests/fixtures/stream").join(name).display().to_string() }

#[derive(Default)]
struct Collect {
    rows: Mutex<Vec<(String, UiRow)>>,
    statuses: Mutex<Vec<RunRow>>,
}
impl RunSink for Collect {
    fn row(&self, run_id: &str, row: &UiRow) { self.rows.lock().expect("lock").push((run_id.to_string(), row.clone())); }
    fn status(&self, run: &RunRow) { self.statuses.lock().expect("lock").push(run.clone()); }
}

struct T {
    _tmp: tempfile::TempDir,
    paths: QuintetPaths,
    db: Db,
    sink: Arc<Collect>,
    rm: RunManager,
    scratch: PathBuf,
}

fn setup(env: &[(&str, &str)], tweak: impl FnOnce(&mut RunConfig)) -> T {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    seed(&SeedSource::from_root(manifest().join("tests/fixtures/defaults")), &paths).expect("seed");
    let db = Db::open(&paths.db_file()).expect("db");
    let registry = Arc::new(Registry::new(paths.clone(), Some(db.clone())));
    registry.load_all().expect("load");
    let scratch = tmp.path().join("scratch");
    std::fs::create_dir_all(&scratch).expect("scratch");
    let mut cfg = RunConfig { claude_bin: fake_claude(), grace: Duration::from_millis(500), ..RunConfig::default() };
    cfg.extra_env = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    cfg.extra_env.push(("FAKE_CLAUDE_ARGS_FILE".into(), scratch.join("args.txt").display().to_string()));
    cfg.extra_env.push(("FAKE_CLAUDE_STDIN_FILE".into(), scratch.join("stdin.txt").display().to_string()));
    cfg.extra_env.push(("FAKE_CLAUDE_ENV_FILE".into(), scratch.join("env.txt").display().to_string()));
    tweak(&mut cfg);
    let sink = Arc::new(Collect::default());
    let rm = RunManager::new(db.clone(), registry, paths.clone(), cfg, sink.clone());
    T { _tmp: tmp, paths, db, sink, rm, scratch }
}

fn args(t: &T) -> Vec<String> { std::fs::read_to_string(t.scratch.join("args.txt")).unwrap_or_default().lines().map(str::to_owned).collect() }

fn start(t: &T, task: &str) -> RunRow {
    t.rm.start(StartRunArgs { agent_id: "alpha".into(), task_text: task.into(), intake: Default::default(), integrity_level: None, trigger: None }).expect("start")
}

async fn wait_status(db: &Db, id: &str, want: RunStatus, timeout: Duration) -> RunRow {
    let deadline = Instant::now() + timeout;
    loop {
        let r = db::runs::get(db, id).expect("get").expect("row");
        if r.status == want { return r; }
        assert!(Instant::now() < deadline, "timed out waiting for {} (now {} / {:?})", want.as_str(), r.status.as_str(), r.error);
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn happy_path_streams_persists_and_finishes_done() {
    let t = setup(&[("FAKE_CLAUDE_FIXTURE", &fixture("simple_text.jsonl"))], |_| {});
    let run = start(&t, "Say hello\nsecond line of the task");
    assert_eq!(run.status, RunStatus::Queued);
    assert_eq!(run.task_title, "Say hello");
    assert!(t.rm.wait_idle(Duration::from_secs(20)).await);
    let r = wait_status(&t.db, &run.id, RunStatus::Done, Duration::from_secs(5)).await;
    assert!(r.cost_usd.unwrap_or(0.0) > 0.0, "{r:?}");
    assert_eq!(r.turns, Some(1));
    assert!(r.tokens_out.unwrap_or(0) > 0);
    assert!(r.summary.as_deref().unwrap_or("").starts_with("QUINTET-OK"), "{:?}", r.summary);
    assert!(r.started_at.is_some() && r.ended_at.is_some());
    assert!(r.pid.is_none());
    let out = PathBuf::from(r.output_dir.clone().expect("output_dir"));
    assert!(out.is_dir());
    assert!(out.file_name().expect("name").to_string_lossy().ends_with("-say-hello"), "{}", out.display());
    // Events persisted + log + system prompt.
    let events = db::runs::events(&t.db, &run.id, 0).expect("events");
    assert_eq!(events.len(), 8);
    assert_eq!(events[0].kind, "system/init");
    assert!(events.iter().any(|e| e.kind == "result/success"));
    let log = PathBuf::from(r.log_path.expect("log"));
    assert_eq!(std::fs::read_to_string(&log).expect("log").lines().count(), 8);
    let sys = t.paths.logs_runs().join(format!("{}.system.md", run.id));
    let sys_text = std::fs::read_to_string(&sys).expect("system prompt");
    assert!(sys_text.contains("# Your role\n\nYou are Alpha."));
    assert!(sys_text.contains("Task:\n\nSay hello\nsecond line of the task"));
    // Sink saw rows and statuses.
    let rows = t.sink.rows.lock().expect("lock");
    assert!(rows.iter().any(|(_, r)| r.kind == UiRowKind::Result));
    assert!(rows.iter().any(|(_, r)| r.kind == UiRowKind::Text && r.label.starts_with("QUINTET-OK")));
    let st: Vec<_> = t.sink.statuses.lock().expect("lock").iter().map(|r| r.status).collect();
    assert_eq!(st.first(), Some(&RunStatus::Queued));
    assert!(st.contains(&RunStatus::Running));
    assert_eq!(st.last(), Some(&RunStatus::Done));
    // Process contract: stdin carried the task, args match cmd.rs, env is scrubbed.
    assert_eq!(std::fs::read_to_string(t.scratch.join("stdin.txt")).expect("stdin"), "Say hello\nsecond line of the task");
    let a = args(&t);
    assert_eq!(a[0], "-p");
    assert!(a.contains(&"--session-id".to_string()));
    assert!(a.iter().any(|x| x == &run.session_id.clone().expect("sid")));
    assert!(!a.contains(&"--mcp-config".to_string()), "no MCP configured in Phase 1 tests");
    let i = a.iter().position(|x| x == "--add-dir").expect("--add-dir");
    assert_eq!(a[i + 1], out.display().to_string(), "output dir passed as an allowed working directory");
    let env = std::fs::read_to_string(t.scratch.join("env.txt")).expect("env");
    assert!(!env.lines().any(|l| l.starts_with("CLAUDE_") || l.starts_with("CLAUDECODE=")), "leaked: {}", env.lines().filter(|l| l.starts_with("CLAUDE")).collect::<Vec<_>>().join(","));
    assert!(env.contains(&format!("QUINTET_HOME={}", t.paths.home.display())));
    assert!(env.contains(&format!("QUINTET_RUN_ID={}", run.id)));
    // Task row was created and linked.
    let n: i64 = t.db.conn().expect("conn").query_row("SELECT COUNT(*) FROM tasks WHERE run_id = ?1", [&run.id], |r| r.get(0)).expect("count");
    assert_eq!(n, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn max_turns_result_fails_with_reason() {
    let t = setup(&[("FAKE_CLAUDE_FIXTURE", &fixture("max_turns_error.jsonl")), ("FAKE_CLAUDE_EXIT", "1")], |_| {});
    let run = start(&t, "loop forever");
    t.rm.wait_idle(Duration::from_secs(20)).await;
    let r = wait_status(&t.db, &run.id, RunStatus::Failed, Duration::from_secs(5)).await;
    assert_eq!(r.error.as_deref(), Some("max turns (2) reached"));
    assert_eq!(r.turns, Some(3));
    assert!(r.summary.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hard_timeout_kills_the_process() {
    let t = setup(&[("FAKE_CLAUDE_SLEEP", "30")], |c| c.hard_kill = Duration::from_secs(1));
    let run = start(&t, "sleep");
    let t0 = Instant::now();
    t.rm.wait_idle(Duration::from_secs(20)).await;
    let r = wait_status(&t.db, &run.id, RunStatus::Failed, Duration::from_secs(5)).await;
    assert_eq!(r.error.as_deref(), Some("hard timeout after 1 s"));
    assert!(t0.elapsed() < Duration::from_secs(8), "took {:?}", t0.elapsed());
    assert!(r.pid.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_running_and_queued() {
    let t = setup(&[("FAKE_CLAUDE_SLEEP", "30")], |c| c.max_concurrent = 1);
    let a = start(&t, "first");
    let b = start(&t, "second");
    wait_status(&t.db, &a.id, RunStatus::Running, Duration::from_secs(5)).await;
    t.rm.cancel(&b.id).expect("cancel queued");
    assert_eq!(wait_status(&t.db, &b.id, RunStatus::Failed, Duration::from_secs(2)).await.error.as_deref(), Some("cancelled by user"));
    t.rm.cancel(&a.id).expect("cancel running");
    let r = wait_status(&t.db, &a.id, RunStatus::Failed, Duration::from_secs(5)).await;
    assert_eq!(r.error.as_deref(), Some("cancelled by user"));
    assert!(t.rm.wait_idle(Duration::from_secs(5)).await);
    assert!(t.rm.cancel(&a.id).is_err(), "nothing left to cancel");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn queue_respects_max_concurrent_and_order() {
    let t = setup(&[("FAKE_CLAUDE_FIXTURE", &fixture("simple_text.jsonl")), ("FAKE_CLAUDE_DELAY_MS", "60")], |c| c.max_concurrent = 1);
    let a = start(&t, "A");
    let b = start(&t, "B");
    assert!(t.rm.wait_idle(Duration::from_secs(30)).await);
    let ra = wait_status(&t.db, &a.id, RunStatus::Done, Duration::from_secs(2)).await;
    let rb = wait_status(&t.db, &b.id, RunStatus::Done, Duration::from_secs(2)).await;
    assert!(ra.started_at < rb.started_at, "{ra:?} vs {rb:?}");
    assert!(ra.ended_at <= rb.started_at, "B must not start before A ends: {ra:?} vs {rb:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exit_without_result_fails_with_stderr_tail() {
    let t = setup(&[("FAKE_CLAUDE_FIXTURE", &fixture("killed_sigterm.jsonl")), ("FAKE_CLAUDE_EXIT", "3"), ("FAKE_CLAUDE_STDERR", "boom: usage limit reached")], |_| {});
    let run = start(&t, "x");
    t.rm.wait_idle(Duration::from_secs(20)).await;
    let r = wait_status(&t.db, &run.id, RunStatus::Failed, Duration::from_secs(5)).await;
    let e = r.error.expect("error");
    assert!(e.contains("code 3"), "{e}");
    assert!(e.contains("usage limit reached"), "{e}");
    assert!(t.paths.logs_runs().join(format!("{}.stderr.log", run.id)).is_file());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pending_question_yields_waiting_user_then_resume_continues_session() {
    let t = setup(&[("FAKE_CLAUDE_FIXTURE", &fixture("simple_text.jsonl")), ("FAKE_CLAUDE_RESUME_FIXTURE", &fixture("resume_turn.jsonl")), ("FAKE_CLAUDE_DELAY_MS", "80")], |_| {});
    let run = start(&t, "ask me things");
    // The agent would call ask_user through quintet-mcp; simulate the row it inserts.
    db::questions::insert(&t.db, &run.id, "alpha", &[QuestionItem { id: "q1".into(), prompt: "Which style?".into(), kind: "single".into(), options: Some(vec!["APA".into(), "Chicago".into()]) }]).expect("question");
    t.rm.wait_idle(Duration::from_secs(20)).await;
    let r = wait_status(&t.db, &run.id, RunStatus::WaitingUser, Duration::from_secs(5)).await;
    assert!(r.error.is_none());
    let first_events = db::runs::events(&t.db, &run.id, 0).expect("events").len();
    assert_eq!(first_events, 8);
    // Answer + resume.
    let q = db::questions::list(&t.db, Some(&run.id), Some("pending")).expect("list").remove(0);
    db::questions::answer(&t.db, &q.id, r#"{"q1":"Chicago"}"#).expect("answer");
    t.rm.resume(&run.id, "# Answers to your questions\nq1: Chicago\n".into()).expect("resume");
    t.rm.wait_idle(Duration::from_secs(20)).await;
    let r2 = wait_status(&t.db, &run.id, RunStatus::Done, Duration::from_secs(5)).await;
    assert!(r2.summary.as_deref().unwrap_or("").contains("PELICAN-42"), "{:?}", r2.summary);
    assert_eq!(r2.turns, Some(2), "turns accumulate across resumes");
    assert!(r2.cost_usd.unwrap_or(0.0) > r.cost_usd.unwrap_or(0.0));
    assert_eq!(r2.output_dir, r.output_dir, "resume reuses the output folder");
    let a = args(&t);
    let i = a.iter().position(|x| x == "--resume").expect("--resume");
    assert_eq!(a[i + 1], run.session_id.clone().expect("sid"));
    assert_eq!(std::fs::read_to_string(t.scratch.join("stdin.txt")).expect("stdin"), "# Answers to your questions\nq1: Chicago\n");
    assert_eq!(db::runs::events(&t.db, &run.id, 0).expect("events").len(), first_events + 7, "sequence continues");
    assert!(t.rm.resume(&run.id, "again".into()).is_ok(), "done runs can be continued");
    t.rm.wait_idle(Duration::from_secs(20)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_agent_cannot_start() {
    let t = setup(&[], |_| {});
    std::fs::create_dir_all(t.paths.agent_dir("broken")).expect("mkdir");
    std::fs::write(t.paths.agent_md("broken"), "---\nid: broken\nname: [\n---\n").expect("write");
    let reg = Arc::new(Registry::new(t.paths.clone(), Some(t.db.clone())));
    reg.load_all().expect("load");
    let rm = RunManager::new(t.db.clone(), reg, t.paths.clone(), RunConfig { claude_bin: fake_claude(), ..RunConfig::default() }, t.sink.clone());
    let err = rm.start(StartRunArgs { agent_id: "broken".into(), task_text: "x".into(), intake: Default::default(), integrity_level: None, trigger: None }).expect_err("invalid");
    assert!(err.to_string().contains("not valid"), "{err}");
    let err = rm.start(StartRunArgs { agent_id: "ghost".into(), task_text: "x".into(), intake: Default::default(), integrity_level: None, trigger: None }).expect_err("missing");
    assert!(err.to_string().contains("not found"), "{err}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn core_init_wires_seed_db_registry_and_requeues() {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    let src = SeedSource::from_root(manifest().join("tests/fixtures/defaults"));
    let sink = Arc::new(Collect::default());
    let core = Core::init(paths.clone(), &src, RunConfig { claude_bin: fake_claude(), ..RunConfig::default() }, sink.clone()).expect("init");
    assert_eq!(core.seed_report.agents_created.len(), 2);
    assert!(core.recovered.is_empty());
    let s = core.agent_summaries().expect("summaries");
    assert_eq!(s.len(), 2);
    assert_eq!(core.paths_info().db_file, paths.db_file().display().to_string());
    // A queued row left behind is re-queued and runs on the next init.
    db::runs::insert(&core.db, &db::runs::NewRun { agent_id: "alpha", trigger: "scheduled:weekly", session_id: "s", integrity_level: None, intake_json: None, task_title: "leftover" }).expect("insert");
    core.db.conn().expect("conn").execute("INSERT INTO tasks(id, agent_id, title, body, status, run_id, created_at, updated_at) SELECT 'tk', 'alpha', 'leftover', 'leftover', 'open', id, 'x', 'x' FROM runs WHERE task_title = 'leftover'", []).expect("task");
    drop(core);
    let cfg2 = RunConfig { claude_bin: fake_claude(), extra_env: vec![("FAKE_CLAUDE_FIXTURE".into(), fixture("simple_text.jsonl"))], ..RunConfig::default() };
    let core2 = Core::init(paths.clone(), &src, cfg2, sink).expect("init2");
    assert_eq!(core2.seed_report.agents_created.len(), 0);
    assert_eq!(core2.recovered.len(), 1);
    assert_eq!(core2.recovered[0].from, RunStatus::Queued);
    assert!(core2.runs.wait_idle(Duration::from_secs(20)).await);
    let rows = db::runs::list(&core2.db, None, Some(RunStatus::Done), 10).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].trigger, "scheduled:weekly");
}

#[test]
fn slug_and_title_helpers() {
    use quintet_core::runs::{slug, task_title};
    assert_eq!(slug("What is FSRS? A quick look at spaced repetition"), "what-is-fsrs-a-quick-look");
    assert_eq!(slug("   "), "task");
    assert_eq!(slug("Ünïcödé only ✨"), "n-c-d-only");
    assert_eq!(task_title("\n\n  Break down the IFC paper  \nmore"), "Break down the IFC paper");
    assert_eq!(task_title(""), "Untitled task");
    let _ = Path::new("x");
}
