//! Everything the app needs, wired in the order CLAUDE.md §12 Phase 1 describes:
//! paths → seed → db → recover → registry → run manager.

use std::sync::Arc;

use crate::db::{self, Db};
use crate::error::Result;
use crate::paths::QuintetPaths;
use crate::registry::Registry;
use crate::runs::recovery::{recover_on_launch, Recovered};
use crate::runs::{RunConfig, RunManager, RunSink};
use crate::seed::{seed, SeedReport, SeedSource};
use crate::types::{AgentRunState, AgentSummary, IntakeForm, PathsInfo, ResolvedIntake, RunRow, RunStatus, StartRunArgs, TaskArgs};

pub struct Core {
    pub paths: QuintetPaths,
    pub db: Db,
    pub registry: Arc<Registry>,
    pub runs: RunManager,
    pub seed_report: SeedReport,
    pub recovered: Vec<Recovered>,
}

impl Core {
    /// Needs a tokio runtime (RunManager captures the handle).
    pub fn init(paths: QuintetPaths, seed_src: &SeedSource, cfg: RunConfig, sink: Arc<dyn RunSink>) -> Result<Self> {
        paths.ensure_dirs()?;
        let seed_report = seed(seed_src, &paths)?;
        let db = Db::open(&paths.db_file())?;
        let recovered = recover_on_launch(&db)?;
        let registry = Arc::new(Registry::new(paths.clone(), Some(db.clone())));
        registry.load_all()?;
        let runs = RunManager::new(db.clone(), Arc::clone(&registry), paths.clone(), cfg, sink);
        runs.requeue_pending()?;
        Ok(Self { paths, db, registry, runs, seed_report, recovered })
    }

    pub fn paths_info(&self) -> PathsInfo {
        PathsInfo {
            home: self.paths.home.display().to_string(),
            db_file: self.paths.db_file().display().to_string(),
            agents: self.paths.agents().display().to_string(),
            outputs: self.paths.outputs().display().to_string(),
            logs_runs: self.paths.logs_runs().display().to_string(),
        }
    }

    fn frontmatters(&self, agent_id: &str) -> (serde_json::Value, serde_json::Value) {
        let memory = std::fs::read_to_string(self.paths.memory_md(agent_id)).unwrap_or_default();
        let profile = std::fs::read_to_string(self.paths.profile_md()).unwrap_or_default();
        (crate::intake::frontmatter_json(&memory), crate::intake::frontmatter_json(&profile))
    }

    /// The intake form for a task typed into Chat (or the New task sheet).
    pub fn evaluate_intake(&self, agent_id: &str, task_text: &str, partial: &serde_json::Map<String, serde_json::Value>) -> Result<IntakeForm> {
        let (def, _) = self.registry.require(agent_id)?;
        let (m, p) = self.frontmatters(agent_id);
        Ok(crate::intake::evaluate(&def, task_text, partial, m, p))
    }

    pub fn resolve_intake(&self, agent_id: &str, task_text: &str, answers: &serde_json::Map<String, serde_json::Value>) -> Result<ResolvedIntake> {
        let (def, _) = self.registry.require(agent_id)?;
        let (m, p) = self.frontmatters(agent_id);
        Ok(crate::intake::resolve(&def, task_text, answers, m, p))
    }

    /// Resolve intake (defaults, from_chat, integrity cap) then start the run.
    pub fn start_task(&self, args: TaskArgs) -> Result<RunRow> {
        let resolved = self.resolve_intake(&args.agent_id, &args.task_text, &args.answers)?;
        self.runs.start(StartRunArgs { agent_id: args.agent_id, task_text: args.task_text, intake: resolved.intake, integrity_level: resolved.integrity_level, trigger: args.trigger })
    }

    /// Sidebar summaries with live run state and pending-item badges merged in.
    pub fn agent_summaries(&self) -> Result<Vec<AgentSummary>> {
        let mut out = self.registry.summaries()?;
        let active = db::runs::list_by_status(&self.db, &[RunStatus::Running, RunStatus::Queued, RunStatus::WaitingUser, RunStatus::AwaitingApproval])?;
        let pending_q = db::questions::list(&self.db, None, Some("pending"))?;
        let pending_a = db::actions::list(&self.db, Some("pending"), None)?;
        for s in &mut out {
            if s.error.is_some() { s.run_state = AgentRunState::Error; continue; }
            let mine: Vec<_> = active.iter().filter(|r| r.agent_id == s.id).collect();
            s.run_state = if mine.iter().any(|r| matches!(r.status, RunStatus::Running | RunStatus::Queued)) { AgentRunState::Running }
                else if mine.iter().any(|r| matches!(r.status, RunStatus::WaitingUser | RunStatus::AwaitingApproval)) { AgentRunState::Waiting }
                else { AgentRunState::Idle };
            s.badge = (pending_q.iter().filter(|q| q.agent_id == s.id).count() + pending_a.iter().filter(|a| a.agent_id == s.id).count()) as u32;
        }
        Ok(out)
    }
}
