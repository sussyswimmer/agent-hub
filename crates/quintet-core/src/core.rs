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
use crate::types::{AgentRunState, AgentSummary, PathsInfo, RunStatus};

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
