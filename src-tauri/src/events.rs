//! RunSink implementation: forwards rows and status changes to the webview as Tauri events.

use quintet_core::runs::RunSink;
use quintet_core::types::{RunRow, RunStatus, RunStatusEvent, RunStreamEvent, UiRow};
use tauri::Emitter;

pub struct TauriSink {
    pub app: tauri::AppHandle,
}

impl RunSink for TauriSink {
    fn row(&self, run_id: &str, row: &UiRow) {
        let _ = self.app.emit(&format!("run://{run_id}"), RunStreamEvent { run_id: run_id.to_string(), row: row.clone() });
    }

    fn status(&self, run: &RunRow) {
        let _ = self.app.emit("runs://status", RunStatusEvent { run: run.clone() });
        match run.status {
            RunStatus::WaitingUser => crate::notify::send(&self.app, &format!("{} has a question", agent_name(run)), &run.task_title),
            RunStatus::AwaitingApproval => crate::notify::send(&self.app, &format!("{} proposed an action", agent_name(run)), &run.task_title),
            RunStatus::Failed if run.trigger.starts_with("scheduled") => crate::notify::send(&self.app, &format!("{} scheduled run failed", agent_name(run)), run.error.as_deref().unwrap_or("")),
            _ => {}
        }
    }
}

fn agent_name(run: &RunRow) -> String {
    let mut c = run.agent_id.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => run.agent_id.clone(),
    }
}
