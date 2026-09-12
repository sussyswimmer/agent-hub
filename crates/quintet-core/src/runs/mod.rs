//! RunManager: queue → spawn `claude -p` → stream → persist → finalize (CLAUDE.md §3).

pub mod cmd;
pub mod mcp_config;
pub mod process;
pub mod queue;
pub mod recovery;
pub mod state;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::db::{self, Db};
use crate::error::{CoreError, Result};
use crate::paths::QuintetPaths;
use crate::prompt;
use crate::registry::Registry;
use crate::stream::{self, StreamEvent};
use crate::types::{RunRow, RunStatus, StartRunArgs, UiRow};

/// Where run rows and status changes go (the Tauri layer emits events; tests collect).
pub trait RunSink: Send + Sync + 'static {
    fn row(&self, run_id: &str, row: &UiRow);
    fn status(&self, run: &RunRow);
}

#[derive(Debug, Clone)]
pub struct RunConfig {
    pub max_concurrent: usize,
    pub hard_kill: Duration,
    pub grace: Duration,
    pub claude_bin: PathBuf,
    pub mcp: Option<mcp_config::McpLauncher>,
    pub extra_servers: BTreeMap<String, serde_json::Value>,
    pub budget_usd: f64,
    /// Adds `--restricted --add-dir ~/Quintet` (ADR-0001 add-on).
    pub restricted: bool,
    pub extra_env: Vec<(String, String)>,
}

impl Default for RunConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 2,
            hard_kill: Duration::from_secs(20 * 60),
            grace: Duration::from_secs(5),
            claude_bin: std::env::var_os("QUINTET_CLAUDE_BIN").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("claude")),
            mcp: None,
            extra_servers: mcp_config::default_extra_servers(),
            budget_usd: 2.0,
            restricted: false,
            extra_env: vec![],
        }
    }
}

#[derive(Debug, Clone)]
enum Turn {
    Initial,
    Resume(String),
}

struct Live {
    kill: Mutex<Option<oneshot::Sender<String>>>,
}

struct Inner {
    db: Db,
    registry: Arc<Registry>,
    paths: QuintetPaths,
    cfg: RunConfig,
    sink: Arc<dyn RunSink>,
    queue: Mutex<queue::Queue>,
    turns: Mutex<HashMap<String, Turn>>,
    live: Mutex<HashMap<String, Arc<Live>>>,
    handle: tokio::runtime::Handle,
    idle_notify: tokio::sync::Notify,
}

#[derive(Clone)]
pub struct RunManager {
    inner: Arc<Inner>,
}

impl RunManager {
    /// Must be called from inside a tokio runtime (Tauri's, or `#[tokio::test]`).
    pub fn new(db: Db, registry: Arc<Registry>, paths: QuintetPaths, cfg: RunConfig, sink: Arc<dyn RunSink>) -> Self {
        let inner = Inner {
            queue: Mutex::new(queue::Queue::new(cfg.max_concurrent)),
            db, registry, paths, cfg, sink,
            turns: Mutex::new(HashMap::new()),
            live: Mutex::new(HashMap::new()),
            handle: tokio::runtime::Handle::current(),
            idle_notify: tokio::sync::Notify::new(),
        };
        Self { inner: Arc::new(inner) }
    }

    pub fn config(&self) -> &RunConfig { &self.inner.cfg }

    /// Re-queue runs that were `queued` when the app last exited.
    pub fn requeue_pending(&self) -> Result<usize> {
        let rows = db::runs::list_by_status(&self.inner.db, &[RunStatus::Queued])?;
        let n = rows.len();
        for r in rows {
            self.inner.turns.lock().map_err(|_| CoreError::other("lock"))?.insert(r.id.clone(), Turn::Initial);
            self.inner.queue.lock().map_err(|_| CoreError::other("lock"))?.enqueue(r.id, queue::Priority::from_trigger(&r.trigger));
        }
        self.tick();
        Ok(n)
    }

    /// Validate the agent, create task + run rows, enqueue, and kick the queue.
    pub fn start(&self, args: StartRunArgs) -> Result<RunRow> {
        let (def, _) = self.inner.registry.require(&args.agent_id)?;
        let trigger = args.trigger.clone().unwrap_or_else(|| "manual".to_string());
        let session_id = uuid::Uuid::new_v4().to_string();
        let intake_json = if args.intake.is_empty() { None } else { Some(serde_json::to_string(&args.intake)?) };
        let title = task_title(&args.task_text);
        let run = db::runs::insert(&self.inner.db, &db::runs::NewRun { agent_id: &def.id, trigger: &trigger, session_id: &session_id, integrity_level: args.integrity_level, intake_json: intake_json.as_deref(), task_title: &title })?;
        {
            let guard = self.inner.db.conn()?;
            guard.execute(
                "INSERT INTO tasks(id, agent_id, title, body, status, run_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?6)",
                rusqlite::params![db::ulid(), def.id, title, args.task_text, run.id, db::now_iso()],
            )?;
        }
        self.inner.turns.lock().map_err(|_| CoreError::other("lock"))?.insert(run.id.clone(), Turn::Initial);
        self.inner.queue.lock().map_err(|_| CoreError::other("lock"))?.enqueue(run.id.clone(), queue::Priority::from_trigger(&trigger));
        self.inner.sink.status(&run);
        self.tick();
        Ok(run)
    }

    /// Continue a `waiting_user` run with Maxwell's answers (already rendered as the user turn).
    pub fn resume(&self, run_id: &str, user_turn: String) -> Result<RunRow> {
        let run = db::runs::get(&self.inner.db, run_id)?.ok_or_else(|| CoreError::RunNotFound(run_id.to_string()))?;
        if !matches!(run.status, RunStatus::WaitingUser | RunStatus::AwaitingApproval | RunStatus::Failed | RunStatus::Done) {
            return Err(CoreError::InvalidState(format!("run {run_id} is {} and cannot be resumed", run.status.as_str())));
        }
        if run.session_id.is_none() { return Err(CoreError::InvalidState("run has no session id".into())); }
        db::runs::set_status(&self.inner.db, run_id, RunStatus::Queued, None)?;
        let run = db::runs::get(&self.inner.db, run_id)?.ok_or_else(|| CoreError::RunNotFound(run_id.to_string()))?;
        self.inner.turns.lock().map_err(|_| CoreError::other("lock"))?.insert(run_id.to_string(), Turn::Resume(user_turn));
        self.inner.queue.lock().map_err(|_| CoreError::other("lock"))?.enqueue(run_id.to_string(), queue::Priority::Manual);
        self.inner.sink.status(&run);
        self.tick();
        Ok(run)
    }

    /// Cancel a queued or running run → `failed: cancelled by user`.
    pub fn cancel(&self, run_id: &str) -> Result<()> {
        let dequeued = self.inner.queue.lock().map_err(|_| CoreError::other("lock"))?.remove_queued(run_id);
        if dequeued {
            db::runs::set_status(&self.inner.db, run_id, RunStatus::Failed, Some("cancelled by user"))?;
            if let Some(run) = db::runs::get(&self.inner.db, run_id)? { self.inner.sink.status(&run); }
            return Ok(());
        }
        let live = self.inner.live.lock().map_err(|_| CoreError::other("lock"))?.get(run_id).cloned();
        match live {
            Some(l) => {
                if let Some(tx) = l.kill.lock().map_err(|_| CoreError::other("lock"))?.take() { let _ = tx.send("cancelled by user".to_string()); }
                Ok(())
            }
            None => Err(CoreError::InvalidState(format!("run {run_id} is not queued or running"))),
        }
    }

    /// Launch as many queued runs as free slots allow.
    pub fn tick(&self) {
        loop {
            let next = match self.inner.queue.lock() { Ok(mut q) => q.pop_next(), Err(_) => None };
            let Some(run_id) = next else { break };
            let turn = self.inner.turns.lock().ok().and_then(|mut t| t.remove(&run_id)).unwrap_or(Turn::Initial);
            let inner = Arc::clone(&self.inner);
            self.inner.handle.spawn(async move {
                if let Err(e) = launch(Arc::clone(&inner), run_id.clone(), turn).await {
                    tracing::error!(run = %run_id, "launch failed: {e}");
                    let _ = db::runs::set_status(&inner.db, &run_id, RunStatus::Failed, Some(&e.to_string()));
                    let _ = db::runs::clear_pid(&inner.db, &run_id);
                    if let Ok(Some(run)) = db::runs::get(&inner.db, &run_id) { inner.sink.status(&run); }
                }
                if let Ok(mut q) = inner.queue.lock() { q.mark_done(&run_id); }
                inner.live.lock().ok().map(|mut l| l.remove(&run_id));
                inner.idle_notify.notify_waiters();
                RunManager { inner: Arc::clone(&inner) }.tick();
            });
        }
    }

    pub fn is_idle(&self) -> bool {
        self.inner.queue.lock().map(|q| q.is_idle()).unwrap_or(true)
    }

    /// Wait until nothing is queued or running (tests).
    pub async fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        while !self.is_idle() {
            if tokio::time::timeout_at(deadline, self.inner.idle_notify.notified()).await.is_err() { return self.is_idle(); }
        }
        true
    }
}

fn human_duration(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 60 && s.is_multiple_of(60) { format!("{} min", s / 60) } else { format!("{s} s") }
}

/// First ≤ 80 chars of the task, single line.
pub fn task_title(task: &str) -> String {
    let line = task.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let t: String = line.chars().take(80).collect();
    if t.is_empty() { "Untitled task".to_string() } else { t }
}

/// `first-six-words-kebab`, ascii only, ≤ 40 chars.
pub fn slug(task: &str) -> String {
    let words: Vec<String> = task.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).take(6).map(|w| w.to_ascii_lowercase()).collect();
    let mut s = words.join("-");
    if s.len() > 40 { s.truncate(40); s = s.trim_end_matches('-').to_string(); }
    if s.is_empty() { "task".to_string() } else { s }
}

fn saigon_date(rfc3339: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(rfc3339).map(|t| t.with_timezone(&chrono_tz::Asia::Saigon).format("%Y-%m-%d").to_string()).unwrap_or_else(|_| rfc3339.chars().take(10).collect())
}

fn pick_output_dir(base: &Path, date: &str, slug: &str) -> PathBuf {
    let first = base.join(format!("{date}-{slug}"));
    if !first.exists() { return first; }
    for n in 2..1000 {
        let p = base.join(format!("{date}-{slug}-{n}"));
        if !p.exists() { return p; }
    }
    base.join(format!("{date}-{slug}-{}", db::ulid()))
}

async fn launch(inner: Arc<Inner>, run_id: String, turn: Turn) -> Result<()> {
    let run = db::runs::get(&inner.db, &run_id)?.ok_or_else(|| CoreError::RunNotFound(run_id.clone()))?;
    let (def, loaded) = inner.registry.require(&run.agent_id)?;
    let paths = &inner.paths;
    let workspace = paths.workspace(&def.id);
    std::fs::create_dir_all(&workspace).map_err(|e| CoreError::io(&workspace, e))?;
    std::fs::create_dir_all(paths.logs_runs()).map_err(|e| CoreError::io(paths.logs_runs(), e))?;

    // Output dir: reuse on resume, else pick a fresh dated folder.
    let output_dir = match &run.output_dir {
        Some(d) => PathBuf::from(d),
        None => pick_output_dir(&paths.outputs().join(&def.outputs_dir), &saigon_date(&run.created_at), &slug(&run.task_title)),
    };
    std::fs::create_dir_all(&output_dir).map_err(|e| CoreError::io(&output_dir, e))?;

    let memory_abs = crate::paths::absolute(&paths.memory_md(&def.id))?;
    let system_prompt_file = paths.logs_runs().join(format!("{run_id}.system.md"));
    let stdin_text = match &turn {
        Turn::Initial => {
            let task_body: String = inner.db.conn()?.query_row("SELECT body FROM tasks WHERE run_id = ?1 ORDER BY created_at LIMIT 1", [&run_id], |r| r.get(0)).unwrap_or_else(|_| run.task_title.clone());
            let intake: serde_json::Map<String, serde_json::Value> = run.intake_json.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
            let ctx = prompt::RunContext {
                now_saigon: prompt::now_saigon(),
                trigger: run.trigger.clone(),
                integrity_level: run.integrity_level,
                intake_yaml: prompt::intake_to_yaml(&intake),
                task: task_body.clone(),
                output_dir: output_dir.display().to_string(),
                workspace: workspace.display().to_string(),
                memory_path: memory_abs.display().to_string(),
            };
            let profile = std::fs::read_to_string(paths.profile_md()).unwrap_or_default();
            let memory = std::fs::read_to_string(paths.memory_md(&def.id)).unwrap_or_default();
            let state = match &def.state_snapshot { Some(n) => crate::snapshot::state_snapshot(n, &inner.db).unwrap_or_else(|e| format!("(snapshot failed: {e})")), None => String::new() };
            let text = prompt::assemble(&prompt::PromptInputs { run: &ctx, profile: &profile, role_body: &loaded.body, memory: &memory, state: &state });
            std::fs::write(&system_prompt_file, text).map_err(|e| CoreError::io(&system_prompt_file, e))?;
            task_body
        }
        Turn::Resume(t) => {
            if !system_prompt_file.exists() { std::fs::write(&system_prompt_file, "").map_err(|e| CoreError::io(&system_prompt_file, e))?; }
            t.clone()
        }
    };

    let mcp_config_file = match &inner.cfg.mcp {
        Some(launcher) => {
            let f = paths.logs_runs().join(format!("{run_id}.mcp.json"));
            let cfg = mcp_config::build_mcp_config(launcher, &def.id, &run_id, &paths.home, &output_dir, &def.mcp_extra, &inner.cfg.extra_servers);
            std::fs::write(&f, serde_json::to_string_pretty(&cfg)?).map_err(|e| CoreError::io(&f, e))?;
            Some(f)
        }
        None => None,
    };

    let session = match &turn {
        Turn::Initial => cmd::SessionMode::New(run.session_id.clone().unwrap_or_default()),
        Turn::Resume(_) => cmd::SessionMode::Resume(run.session_id.clone().unwrap_or_default()),
    };
    let spec = cmd::RunSpec {
        model: def.model,
        max_turns: def.max_turns,
        budget_usd: inner.cfg.budget_usd,
        system_prompt_file: system_prompt_file.clone(),
        mcp_config_file,
        allowed_tools: def.allowed_tools.clone(),
        integrity_level: run.integrity_level,
        memory_abs: memory_abs.clone(),
        session,
        restricted_to: if inner.cfg.restricted { vec![paths.home.clone()] } else { vec![] },
    };
    let args = cmd::build_args(&spec);
    let mut env = process::scrubbed_env(&inner.cfg.extra_env);
    env.insert("QUINTET_HOME".into(), paths.home.display().to_string());
    env.insert("QUINTET_RUN_ID".into(), run_id.clone());
    env.insert("QUINTET_AGENT_ID".into(), def.id.clone());
    env.insert("QUINTET_OUTPUT_DIR".into(), output_dir.display().to_string());

    let log_path = paths.logs_runs().join(format!("{run_id}.jsonl"));
    let cmd_log = paths.logs_runs().join(format!("{run_id}.cmd.txt"));
    let _ = std::fs::write(&cmd_log, format!("cwd: {}\n{}\n", workspace.display(), cmd::render(&inner.cfg.claude_bin, &args)));
    tracing::info!(run = %run_id, agent = %def.id, "spawning {}", cmd::render(&inner.cfg.claude_bin, &args));

    let spawned = process::spawn(&inner.cfg.claude_bin, &args, &workspace, &env, &stdin_text).await.map_err(|e| CoreError::other(format!("cannot start `{}`: {e}", inner.cfg.claude_bin.display())))?;
    let mut child = spawned.child;
    let pid = spawned.pid;
    db::runs::mark_running(&inner.db, &run_id, Some(pid), &log_path.display().to_string(), &output_dir.display().to_string())?;
    if let Some(r) = db::runs::get(&inner.db, &run_id)? { inner.sink.status(&r); }

    let (kill_tx, mut kill_rx) = oneshot::channel::<String>();
    inner.live.lock().map_err(|_| CoreError::other("lock"))?.insert(run_id.clone(), Arc::new(Live { kill: Mutex::new(Some(kill_tx)) }));

    let stdout = child.stdout.take().ok_or_else(|| CoreError::other("no stdout"))?;
    let stderr = child.stderr.take().ok_or_else(|| CoreError::other("no stderr"))?;
    let stderr_path = paths.logs_runs().join(format!("{run_id}.stderr.log"));
    let stderr_task = tokio::spawn(async move {
        let mut rd = BufReader::new(stderr).lines();
        let mut all = String::new();
        while let Ok(Some(line)) = rd.next_line().await { all.push_str(&line); all.push('\n'); }
        let _ = std::fs::write(&stderr_path, &all);
        all
    });

    let mut seq = db::runs::max_seq(&inner.db, &run_id)?;
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| CoreError::io(&log_path, e))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut result: Option<stream::ResultInfo> = None;
    let mut killed_reason: Option<String> = None;
    let deadline = tokio::time::Instant::now() + inner.cfg.hard_kill;
    let expects_mcp = inner.cfg.mcp.is_some();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() { continue; }
                        seq += 1;
                        use std::io::Write;
                        let _ = writeln!(log, "{line}");
                        let events = match stream::parse_line(&line) { Ok(ev) => ev, Err(e) => { tracing::warn!(run = %run_id, "unparseable line: {e}"); vec![StreamEvent::Unknown { kind: "<unparseable>".into() }] } };
                        let label = events.first().map(StreamEvent::type_label).unwrap_or_else(|| "<empty>".into());
                        let _ = db::runs::insert_event(&inner.db, &run_id, seq, &label, &line);
                        let ts = db::now_iso();
                        for ev in &events {
                            for row in stream::to_ui_rows(ev, seq, &ts) { inner.sink.row(&run_id, &row); }
                            match ev {
                                StreamEvent::Init(init) if expects_mcp => {
                                    let ok = init.mcp_servers.iter().any(|m| m.name == "quintet" && m.status == "connected");
                                    if !ok {
                                        let st = init.mcp_servers.iter().find(|m| m.name == "quintet").map(|m| m.status.clone()).unwrap_or_else(|| "missing".into());
                                        killed_reason = Some(format!("quintet-mcp failed to start ({st})"));
                                    }
                                }
                                StreamEvent::Result(r) => result = Some(r.clone()),
                                _ => {}
                            }
                        }
                        // The result event is the last thing the CLI says; do not wait on the pipe for
                        // orphaned background processes (they inherit stdout and would delay EOF).
                        if killed_reason.is_some() || result.is_some() { break; }
                    }
                    Ok(None) => break,
                    Err(e) => { tracing::warn!(run = %run_id, "stdout read error: {e}"); break; }
                }
            }
            reason = &mut kill_rx => {
                killed_reason = Some(reason.unwrap_or_else(|_| "cancelled".to_string()));
                break;
            }
            _ = tokio::time::sleep_until(deadline) => {
                killed_reason = Some(format!("hard timeout after {}", human_duration(inner.cfg.hard_kill)));
                break;
            }
        }
    }

    let exit_code = if killed_reason.is_some() {
        process::kill_gracefully(&mut child, pid, inner.cfg.grace).await;
        None
    } else {
        match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
            Ok(Ok(status)) => { process::kill_stragglers(pid); status.code() }
            _ => { process::kill_gracefully(&mut child, pid, inner.cfg.grace).await; None }
        }
    };
    drop(lines);
    let stderr_all = match tokio::time::timeout(Duration::from_secs(3), stderr_task).await {
        Ok(Ok(s)) => s,
        _ => std::fs::read_to_string(paths.logs_runs().join(format!("{run_id}.stderr.log"))).unwrap_or_default(),
    };
    let stderr_tail: String = stderr_all.chars().rev().take(2000).collect::<String>().chars().rev().collect();

    let pending_q = db::questions::pending_count(&inner.db, &run_id).unwrap_or(0);
    let pending_a = db::actions::pending_count(&inner.db, &run_id).unwrap_or(0);
    let outcome = state::finalize(&state::ExitFacts { result: result.as_ref(), exit_code, pending_questions: pending_q, pending_actions: pending_a, stderr_tail: &stderr_tail, killed_reason: killed_reason.as_deref() });
    if let Some(r) = &result {
        db::runs::record_usage(&inner.db, &run_id, &db::runs::Usage { cost_usd: Some(r.total_cost_usd), tokens_in: Some(r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens), tokens_out: Some(r.usage.output_tokens), turns: Some(r.num_turns), summary: r.text.clone().filter(|t| !r.is_error && !t.trim().is_empty()) })?;
    }
    db::runs::set_status(&inner.db, &run_id, outcome.status, outcome.error.as_deref())?;
    db::runs::clear_pid(&inner.db, &run_id)?;
    if outcome.status == RunStatus::WaitingUser {
        // keep questions pending; nothing else
    }
    if let Some(r) = db::runs::get(&inner.db, &run_id)? { inner.sink.status(&r); }
    tracing::info!(run = %run_id, status = outcome.status.as_str(), error = ?outcome.error, "run finished");
    Ok(())
}
