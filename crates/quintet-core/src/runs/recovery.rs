//! On launch: runs left `running` by a crashed app become `failed`; `queued` ones are re-queued.

use crate::db::{self, Db};
use crate::error::Result;
use crate::types::RunStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recovered {
    pub run_id: String,
    pub from: RunStatus,
    pub to: RunStatus,
}

pub const CRASH_REASON: &str = "app exited mid-run";

pub fn recover_on_launch(db: &Db) -> Result<Vec<Recovered>> {
    let mut out = Vec::new();
    for run in db::runs::list_by_status(db, &[RunStatus::Running])? {
        if let Some(pid) = run.pid {
            let pid = pid as u32;
            if super::process::pid_alive(pid) && super::process::pid_is_claude(pid) {
                tracing::warn!(run = %run.id, pid, "orphaned claude process still alive; terminating");
                super::process::terminate_pid(pid);
            }
        }
        db::runs::set_status(db, &run.id, RunStatus::Failed, Some(CRASH_REASON))?;
        db::runs::clear_pid(db, &run.id)?;
        out.push(Recovered { run_id: run.id, from: RunStatus::Running, to: RunStatus::Failed });
    }
    for run in db::runs::list_by_status(db, &[RunStatus::Queued])? {
        out.push(Recovered { run_id: run.id, from: RunStatus::Queued, to: RunStatus::Queued });
    }
    Ok(out)
}
