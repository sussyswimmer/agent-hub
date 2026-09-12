//! Final run status from the observed exit (CLAUDE.md §3.4, ADR-0002, ADR-0006).

use crate::stream::ResultInfo;
use crate::types::RunStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub status: RunStatus,
    pub error: Option<String>,
}

pub struct ExitFacts<'a> {
    pub result: Option<&'a ResultInfo>,
    pub exit_code: Option<i32>,
    pub pending_questions: i64,
    pub pending_actions: i64,
    pub stderr_tail: &'a str,
    /// Set when the app killed the process (hard timeout, cancel, MCP failure).
    pub killed_reason: Option<&'a str>,
}

pub fn finalize(f: &ExitFacts<'_>) -> Outcome {
    if let Some(reason) = f.killed_reason {
        return Outcome { status: RunStatus::Failed, error: Some(reason.to_string()) };
    }
    match f.result {
        Some(r) if r.is_error => {
            let msg = match r.subtype.as_str() {
                "error_max_turns" => format!("max turns ({}) reached", r.num_turns.saturating_sub(1).max(1)),
                "error_during_execution" => "interrupted before the turn finished".to_string(),
                other => match &r.text { Some(t) if !t.trim().is_empty() => format!("{other}: {}", t.trim()), _ => other.to_string() },
            };
            Outcome { status: RunStatus::Failed, error: Some(msg) }
        }
        Some(_) => {
            let status = if f.pending_questions > 0 { RunStatus::WaitingUser } else if f.pending_actions > 0 { RunStatus::AwaitingApproval } else { RunStatus::Done };
            Outcome { status, error: None }
        }
        None => {
            let code = f.exit_code.map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string());
            let tail = f.stderr_tail.trim();
            let msg = if tail.is_empty() { format!("claude exited with code {code} without a result") } else { format!("claude exited with code {code} without a result: {}", tail.chars().rev().take(600).collect::<String>().chars().rev().collect::<String>()) };
            Outcome { status: RunStatus::Failed, error: Some(msg) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok() -> ResultInfo { ResultInfo { subtype: "success".into(), is_error: false, num_turns: 2, ..Default::default() } }

    #[test]
    fn matrix() {
        let r = ok();
        let base = |result: Option<&ResultInfo>, q: i64, a: i64| finalize(&ExitFacts { result, exit_code: Some(0), pending_questions: q, pending_actions: a, stderr_tail: "", killed_reason: None });
        assert_eq!(base(Some(&r), 0, 0).status, RunStatus::Done);
        assert_eq!(base(Some(&r), 1, 0).status, RunStatus::WaitingUser);
        assert_eq!(base(Some(&r), 0, 2).status, RunStatus::AwaitingApproval);
        assert_eq!(base(Some(&r), 1, 2).status, RunStatus::WaitingUser, "questions win over proposals");
        let mt = ResultInfo { subtype: "error_max_turns".into(), is_error: true, num_turns: 3, ..Default::default() };
        let o = base(Some(&mt), 0, 0);
        assert_eq!(o.status, RunStatus::Failed);
        assert_eq!(o.error.as_deref(), Some("max turns (2) reached"));
        let none = finalize(&ExitFacts { result: None, exit_code: Some(2), pending_questions: 0, pending_actions: 0, stderr_tail: "boom\n", killed_reason: None });
        assert_eq!(none.status, RunStatus::Failed);
        assert_eq!(none.error.as_deref(), Some("claude exited with code 2 without a result: boom"));
        let killed = finalize(&ExitFacts { result: Some(&r), exit_code: Some(0), pending_questions: 5, pending_actions: 0, stderr_tail: "", killed_reason: Some("cancelled by user") });
        assert_eq!(killed.status, RunStatus::Failed);
        assert_eq!(killed.error.as_deref(), Some("cancelled by user"));
    }
}
