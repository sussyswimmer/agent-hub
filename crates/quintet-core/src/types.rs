//! IPC types shared with the UI. `cargo test -p quintet-core export_bindings` writes them to
//! `src/lib/generated/` through ts-rs, so they are defined exactly once (CLAUDE.md §14).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub type IntegrityLevel = u8; // 0..=3

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RunStatus {
    Queued,
    Running,
    WaitingUser,
    AwaitingApproval,
    Done,
    Failed,
    Stale,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Queued => "queued",
            RunStatus::Running => "running",
            RunStatus::WaitingUser => "waiting_user",
            RunStatus::AwaitingApproval => "awaiting_approval",
            RunStatus::Done => "done",
            RunStatus::Failed => "failed",
            RunStatus::Stale => "stale",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "queued" => RunStatus::Queued,
            "running" => RunStatus::Running,
            "waiting_user" => RunStatus::WaitingUser,
            "awaiting_approval" => RunStatus::AwaitingApproval,
            "done" => RunStatus::Done,
            "failed" => RunStatus::Failed,
            "stale" => RunStatus::Stale,
            _ => return None,
        })
    }
    pub fn is_terminal(self) -> bool {
        matches!(self, RunStatus::Done | RunStatus::Failed | RunStatus::Stale)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Model {
    Opus,
    Sonnet,
    Haiku,
}

impl Model {
    pub fn alias(self) -> &'static str {
        match self {
            Model::Opus => "opus",
            Model::Sonnet => "sonnet",
            Model::Haiku => "haiku",
        }
    }
}

/// `integrity:` in frontmatter: `false | true | when_graded`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum Integrity {
    Flag(bool),
    #[serde(rename = "when_graded")]
    Mode(IntegrityMode),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum IntegrityMode {
    WhenGraded,
}

impl Default for Integrity {
    fn default() -> Self {
        Integrity::Flag(false)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum IntakeType {
    Text,
    Single,
    Multi,
    Date,
    File,
    Integrity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct IntakeField {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: IntakeType,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    #[ts(type = "unknown | null")]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub skip_if: Option<String>,
    /// Integrity fields only: hard cap (College essays: 2).
    #[serde(default)]
    pub max: Option<IntegrityLevel>,
    /// Text fields only: fill from the composer text when the task is typed into Chat.
    #[serde(default)]
    pub from_chat: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct Schedule {
    pub name: String,
    pub cron: String,
    #[serde(default = "default_tz")]
    pub tz: String,
    pub task: String,
    #[serde(default)]
    pub model: Option<Model>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_tz() -> String {
    "Asia/Saigon".to_string()
}
fn default_true() -> bool {
    true
}

/// Parsed `agent.md` frontmatter (CLAUDE.md §4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    #[serde(default = "default_version")]
    pub version: u32,
    pub mission: String,
    #[serde(default)]
    pub owns: Vec<String>,
    #[serde(default)]
    pub does_not_own: Vec<String>,
    pub model: Model,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
    #[serde(default)]
    pub integrity: Integrity,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub mcp_extra: Vec<String>,
    #[serde(default)]
    pub state_snapshot: Option<String>,
    #[serde(default)]
    pub intake: Vec<IntakeField>,
    #[serde(default)]
    pub schedules: Vec<Schedule>,
    pub outputs_dir: String,
    pub board: String,
}

fn default_version() -> u32 {
    1
}
fn default_max_turns() -> u32 {
    40
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgentRunState {
    Idle,
    Running,
    Waiting,
    Error,
}

/// Sidebar row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSummary {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub version: u32,
    pub mission: String,
    /// `None` when the agent failed to parse; `error` then has the message.
    pub error: Option<String>,
    pub hash: String,
    pub run_state: AgentRunState,
    /// Pending approvals + questions for this agent.
    pub badge: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentDetail {
    pub summary: AgentSummary,
    pub def: Option<AgentDef>,
    pub body: String,
    pub memory: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StartRunArgs {
    pub agent_id: String,
    pub task_text: String,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub intake: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub integrity_level: Option<IntegrityLevel>,
    /// `manual` (default) or `scheduled:<name>`.
    #[serde(default)]
    pub trigger: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunRow {
    pub id: String,
    pub agent_id: String,
    pub trigger: String,
    pub status: RunStatus,
    pub session_id: Option<String>,
    pub integrity_level: Option<IntegrityLevel>,
    pub intake_json: Option<String>,
    pub task_title: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub cost_usd: Option<f64>,
    #[ts(type = "number | null")]
    pub tokens_in: Option<i64>,
    #[ts(type = "number | null")]
    pub tokens_out: Option<i64>,
    #[ts(type = "number | null")]
    pub turns: Option<i64>,
    pub error: Option<String>,
    pub summary: Option<String>,
    #[ts(type = "number | null")]
    pub pid: Option<i64>,
    pub log_path: Option<String>,
    pub output_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum UiRowKind {
    Text,
    Tool,
    Question,
    Proposal,
    Output,
    System,
    Result,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum UiRowState {
    Running,
    Done,
    Error,
}

/// One friendly line in the Chat run card, derived from a stream event (CLAUDE.md §3.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UiRow {
    #[ts(type = "number")]
    pub seq: i64,
    pub kind: UiRowKind,
    pub label: String,
    pub detail: Option<String>,
    pub tool_use_id: Option<String>,
    pub state: UiRowState,
    pub ts: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuestionItem {
    pub id: String,
    pub prompt: String,
    #[serde(rename = "type")]
    pub kind: String, // single | multi | text
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Question {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub questions: Vec<QuestionItem>,
    #[ts(type = "Record<string, unknown> | null")]
    pub answers: Option<serde_json::Value>,
    pub status: String, // pending | answered | stale
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Action {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[ts(type = "unknown")]
    pub payload: serde_json::Value,
    pub preview_md: String,
    pub reason: Option<String>,
    pub status: String, // pending | approved | rejected | executed | failed
    #[ts(type = "unknown | null")]
    pub result: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OutputFile {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub path: String,
    pub kind: String, // md | csv | png | docx | feedback
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Preflight {
    pub ok: bool,
    pub cli_version: Option<String>,
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunStreamEvent {
    pub run_id: String,
    pub row: UiRow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunStatusEvent {
    pub run: RunRow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathsInfo {
    pub home: String,
    pub db_file: String,
    pub agents: String,
    pub outputs: String,
    pub logs_runs: String,
}

/// One intake field as the form should show it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IntakeFieldView {
    pub field: IntakeField,
    /// `skip_if` evaluated true: hide it, do not require it.
    pub skipped: bool,
    /// Current value: the partial answer, else the composer text (from_chat), else the default.
    #[ts(type = "unknown | null")]
    pub prefill: Option<serde_json::Value>,
    /// Required fields are satisfied when skipped or when `prefill` is non-empty.
    pub satisfied: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IntakeForm {
    pub agent_id: String,
    pub fields: Vec<IntakeFieldView>,
    pub can_start: bool,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResolvedIntake {
    #[ts(type = "Record<string, unknown>")]
    pub intake: serde_json::Map<String, serde_json::Value>,
    pub integrity_level: Option<IntegrityLevel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskArgs {
    pub agent_id: String,
    pub task_text: String,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub answers: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub trigger: Option<String>,
}
