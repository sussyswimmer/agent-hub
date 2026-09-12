//! Live tests against the real `claude` CLI. Skipped unless QUINTET_LIVE=1 (they spend subscription
//! usage). Run: `QUINTET_LIVE=1 cargo test -p quintet-core --test live_claude -- --ignored --nocapture`

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use quintet_core::db;
use quintet_core::paths::QuintetPaths;
use quintet_core::runs::mcp_config::McpLauncher;
use quintet_core::runs::{RunConfig, RunSink};
use quintet_core::seed::SeedSource;
use quintet_core::types::{RunRow, RunStatus, StartRunArgs, UiRow, UiRowKind};
use quintet_core::Core;

fn repo_root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo") }
fn live() -> bool { std::env::var("QUINTET_LIVE").map(|v| v == "1").unwrap_or(false) }

#[derive(Default)]
struct Collect { rows: Mutex<Vec<UiRow>> }
impl RunSink for Collect {
    fn row(&self, _run_id: &str, row: &UiRow) { self.rows.lock().expect("lock").push(row.clone()); eprintln!("  [{}] {} {}", row.kind_label(), row.label, row.detail.as_deref().unwrap_or("")); }
    fn status(&self, run: &RunRow) { eprintln!("  status → {} {:?}", run.status.as_str(), run.error); }
}

trait KindLabel { fn kind_label(&self) -> &'static str; }
impl KindLabel for UiRow { fn kind_label(&self) -> &'static str { match self.kind { UiRowKind::Text => "text", UiRowKind::Tool => "tool", UiRowKind::Question => "question", UiRowKind::Proposal => "proposal", UiRowKind::Output => "output", UiRowKind::System => "system", UiRowKind::Result => "result", UiRowKind::Error => "error" } } }

fn stub_mcp() -> McpLauncher {
    McpLauncher { command: PathBuf::from("bun"), prefix_args: vec![repo_root().join("scripts/stub-mcp.ts").display().to_string()] }
}

fn setup(model: &str, max_turns: u32, budget: f64) -> (tempfile::TempDir, Core, Arc<Collect>) {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    let sink = Arc::new(Collect::default());
    let cfg = RunConfig { mcp: Some(stub_mcp()), budget_usd: budget, hard_kill: Duration::from_secs(600), ..RunConfig::default() };
    let core = Core::init(paths.clone(), &SeedSource::from_root(repo_root()), cfg, sink.clone()).expect("init");
    // Cheap model + short leash for the test: rewrite the shipped research agent in the temp home.
    let md = paths.agent_md("research");
    let text = std::fs::read_to_string(&md).expect("read").replace("model: opus", &format!("model: {model}")).replace("max_turns: 60", &format!("max_turns: {max_turns}"));
    std::fs::write(&md, text).expect("write");
    core.registry.load_all().expect("reload");
    (tmp, core, sink)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spends subscription usage; QUINTET_LIVE=1"]
async fn reply_ok_through_run_manager_with_stub_mcp() {
    if !live() { eprintln!("QUINTET_LIVE not set; skipping"); return; }
    let (_tmp, core, sink) = setup("haiku", 3, 0.25);
    let run = core.runs.start(StartRunArgs { agent_id: "research".into(), task_text: "Ignore your research process for this one message. Call the ping tool once, then reply with exactly: OK".into(), intake: Default::default(), integrity_level: None, trigger: None }).expect("start");
    assert!(core.runs.wait_idle(Duration::from_secs(180)).await, "run did not finish");
    let r = db::runs::get(&core.db, &run.id).expect("get").expect("row");
    assert_eq!(r.status, RunStatus::Done, "{:?}", r.error);
    assert!(r.cost_usd.unwrap_or(0.0) > 0.0, "cost saved: {r:?}");
    assert!(r.turns.unwrap_or(0) >= 1, "turns saved: {r:?}");
    assert!(r.summary.as_deref().unwrap_or("").contains("OK"), "{:?}", r.summary);
    let init = db::runs::events(&core.db, &run.id, 0).expect("events").into_iter().find(|e| e.kind == "system/init").expect("init event");
    assert!(init.json.contains("\"name\":\"quintet\",\"status\":\"connected\""), "quintet MCP not connected: {}", init.json);
    assert!(init.json.contains("\"skills\":[]"), "user skills leaked: {}", init.json);
    let rows = sink.rows.lock().expect("lock");
    assert!(rows.iter().any(|x| x.label == "ping"), "ping tool row: {rows:?}");
    assert!(rows.iter().any(|x| x.kind == UiRowKind::Result));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spends subscription usage; QUINTET_LIVE=1"]
async fn research_what_is_fsrs_streams_and_summarises() {
    if !live() { eprintln!("QUINTET_LIVE not set; skipping"); return; }
    let (tmp, core, sink) = setup("haiku", 14, 1.0);
    let run = core.runs.start(StartRunArgs { agent_id: "research".into(), task_text: "What is FSRS? Keep it quick: two or three sources, a short brief.".into(), intake: serde_json::from_str(r#"{"question":"What is FSRS?","output":["brief"],"depth":"quick","citation_style":"Chicago","graded":"no"}"#).expect("json"), integrity_level: None, trigger: None }).expect("start");
    assert!(core.runs.wait_idle(Duration::from_secs(540)).await, "run did not finish");
    let r = db::runs::get(&core.db, &run.id).expect("get").expect("row");
    eprintln!("final: status={} turns={:?} cost={:?} error={:?}\nsummary={:?}", r.status.as_str(), r.turns, r.cost_usd, r.error, r.summary);
    let rows = sink.rows.lock().expect("lock");
    assert!(rows.iter().any(|x| x.label.starts_with("Searching the web") || x.label.starts_with("Reading ")), "no web tool steps streamed: {rows:?}");
    assert!(matches!(r.status, RunStatus::Done | RunStatus::Failed), "{r:?}");
    assert!(r.cost_usd.unwrap_or(0.0) > 0.0 && r.turns.unwrap_or(0) >= 2, "cost/turns saved: {r:?}");
    if r.status == RunStatus::Done {
        assert!(!r.summary.as_deref().unwrap_or("").trim().is_empty(), "summary saved");
    } else {
        // A max-turns stop on the cheap leash still proves streaming + persistence; report it loudly.
        eprintln!("NOTE: run ended {:?}; acceptance needs a Done with summary on the Mac with opus", r.error);
    }
    // Keep the raw log for the WebSearch/WebFetch fixture.
    let log = PathBuf::from(r.log_path.expect("log"));
    let keep = repo_root().join("scripts/out/live-research.jsonl");
    std::fs::create_dir_all(keep.parent().expect("dir")).expect("mkdir");
    std::fs::copy(&log, &keep).expect("copy log");
    eprintln!("raw log copied to {}", keep.display());
    drop(tmp);
}
