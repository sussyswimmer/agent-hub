//! `claude -p --output-format stream-json` parser and the friendly UI-row mapping (CLAUDE.md §3.4).
//!
//! Shapes were captured in Phase 0 (`docs/claude-cli-notes.md` §4). Anything unrecognised becomes
//! `StreamEvent::Unknown` so a new CLI event type never fails a run.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::{UiRow, UiRowKind, UiRowState};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct InitInfo {
    pub session_id: String,
    pub model: String,
    pub tools: Vec<String>,
    pub mcp_servers: Vec<McpServerStatus>,
    pub skills: Vec<String>,
    pub plugins: usize,
    pub agents: Vec<String>,
    pub permission_mode: Option<String>,
    pub claude_code_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub cache_creation_input_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Denial {
    pub tool_name: String,
    pub tool_use_id: Option<String>,
    pub tool_input: Value,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ResultInfo {
    pub subtype: String,
    pub is_error: bool,
    pub num_turns: i64,
    pub total_cost_usd: f64,
    pub session_id: String,
    /// Final assistant text (`result`), or the error text.
    pub text: Option<String>,
    pub usage: Usage,
    pub permission_denials: Vec<Denial>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RateLimit {
    pub status: String,
    pub window: Option<String>,
    pub utilization: Option<f64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum StreamEvent {
    Init(InitInfo),
    PermissionDenied { tool_name: String, tool_use_id: Option<String>, message: String, reason: Option<String> },
    SystemOther { subtype: String },
    Thinking,
    Text(String),
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, is_error: bool, text: String },
    Result(ResultInfo),
    RateLimit(RateLimit),
    Unknown { kind: String },
}

impl StreamEvent {
    /// The raw `type` (with `/subtype` for system events), stored in `run_events.type`.
    pub fn type_label(&self) -> String {
        match self {
            StreamEvent::Init(_) => "system/init".into(),
            StreamEvent::PermissionDenied { .. } => "system/permission_denied".into(),
            StreamEvent::SystemOther { subtype } => format!("system/{subtype}"),
            StreamEvent::Thinking => "assistant/thinking".into(),
            StreamEvent::Text(_) => "assistant/text".into(),
            StreamEvent::ToolUse { .. } => "assistant/tool_use".into(),
            StreamEvent::ToolResult { .. } => "user/tool_result".into(),
            StreamEvent::Result(r) => format!("result/{}", r.subtype),
            StreamEvent::RateLimit(_) => "rate_limit_event".into(),
            StreamEvent::Unknown { kind } => kind.clone(),
        }
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}
fn strs(v: &Value, k: &str) -> Vec<String> {
    v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect()).unwrap_or_default()
}

/// Text of a `tool_result` content field: a string, or an array of `{type:"text", text}` blocks.
fn content_text(v: &Value) -> String {
    match v {
        Value::String(t) => t.clone(),
        Value::Array(blocks) => blocks.iter().filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Parse one stdout line. Returns every event it contains (an `assistant` message may hold several
/// content blocks). `Err` only for malformed JSON.
pub fn parse_line(line: &str) -> std::result::Result<Vec<StreamEvent>, serde_json::Error> {
    let v: Value = serde_json::from_str(line)?;
    Ok(parse_value(&v))
}

pub fn parse_value(v: &Value) -> Vec<StreamEvent> {
    let kind = s(v, "type").unwrap_or_default();
    match kind.as_str() {
        "system" => {
            let subtype = s(v, "subtype").unwrap_or_default();
            match subtype.as_str() {
                "init" => vec![StreamEvent::Init(InitInfo {
                    session_id: s(v, "session_id").unwrap_or_default(),
                    model: s(v, "model").unwrap_or_default(),
                    tools: strs(v, "tools"),
                    mcp_servers: v.get("mcp_servers").and_then(Value::as_array).map(|a| a.iter().map(|m| McpServerStatus { name: s(m, "name").unwrap_or_default(), status: s(m, "status").unwrap_or_default() }).collect()).unwrap_or_default(),
                    skills: strs(v, "skills"),
                    plugins: v.get("plugins").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
                    agents: strs(v, "agents"),
                    permission_mode: s(v, "permissionMode"),
                    claude_code_version: s(v, "claude_code_version"),
                })],
                "permission_denied" => vec![StreamEvent::PermissionDenied {
                    tool_name: s(v, "tool_name").unwrap_or_default(),
                    tool_use_id: s(v, "tool_use_id"),
                    message: s(v, "message").unwrap_or_default(),
                    reason: s(v, "decision_reason_type"),
                }],
                _ => vec![StreamEvent::SystemOther { subtype }],
            }
        }
        "assistant" => {
            let blocks = v.pointer("/message/content").and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for b in blocks {
                match s(&b, "type").as_deref() {
                    Some("text") => out.push(StreamEvent::Text(s(&b, "text").unwrap_or_default())),
                    Some("thinking") => out.push(StreamEvent::Thinking),
                    Some("tool_use") => out.push(StreamEvent::ToolUse { id: s(&b, "id").unwrap_or_default(), name: s(&b, "name").unwrap_or_default(), input: b.get("input").cloned().unwrap_or(Value::Null) }),
                    _ => {}
                }
            }
            out
        }
        "user" => {
            let blocks = v.pointer("/message/content").and_then(Value::as_array).cloned().unwrap_or_default();
            blocks.iter().filter(|b| s(b, "type").as_deref() == Some("tool_result")).map(|b| StreamEvent::ToolResult {
                tool_use_id: s(b, "tool_use_id").unwrap_or_default(),
                is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                text: content_text(b.get("content").unwrap_or(&Value::Null)),
            }).collect()
        }
        "result" => {
            let usage = v.get("usage").cloned().unwrap_or(Value::Null);
            let i = |k: &str| usage.get(k).and_then(Value::as_i64).unwrap_or(0);
            vec![StreamEvent::Result(ResultInfo {
                subtype: s(v, "subtype").unwrap_or_default(),
                is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                num_turns: v.get("num_turns").and_then(Value::as_i64).unwrap_or(0),
                total_cost_usd: v.get("total_cost_usd").and_then(Value::as_f64).unwrap_or(0.0),
                session_id: s(v, "session_id").unwrap_or_default(),
                text: s(v, "result").or_else(|| s(v, "error")),
                usage: Usage { input_tokens: i("input_tokens"), output_tokens: i("output_tokens"), cache_read_input_tokens: i("cache_read_input_tokens"), cache_creation_input_tokens: i("cache_creation_input_tokens") },
                permission_denials: v.get("permission_denials").and_then(Value::as_array).map(|a| a.iter().map(|d| Denial { tool_name: s(d, "tool_name").unwrap_or_default(), tool_use_id: s(d, "tool_use_id"), tool_input: d.get("tool_input").cloned().unwrap_or(Value::Null) }).collect()).unwrap_or_default(),
                duration_ms: v.get("duration_ms").and_then(Value::as_i64),
            })]
        }
        "rate_limit_event" => {
            let info = v.get("rate_limit_info").cloned().unwrap_or(Value::Null);
            vec![StreamEvent::RateLimit(RateLimit {
                status: s(&info, "status").unwrap_or_default(),
                window: s(&info, "rateLimitType"),
                utilization: info.get("utilization").and_then(Value::as_f64),
                resets_at: info.get("resetsAt").and_then(Value::as_i64),
            })]
        }
        "" => vec![StreamEvent::Unknown { kind: "<no type>".into() }],
        other => vec![StreamEvent::Unknown { kind: other.to_string() }],
    }
}

fn short(s: &str, n: usize) -> String {
    let t = s.trim().replace('\n', " ");
    if t.chars().count() <= n { t } else { format!("{}…", t.chars().take(n).collect::<String>()) }
}

fn host_path(url: &str) -> String {
    let u = url.trim_start_matches("https://").trim_start_matches("http://");
    short(u, 60)
}

fn file_name(p: &str) -> String {
    std::path::Path::new(p).file_name().and_then(|s| s.to_str()).map(str::to_owned).unwrap_or_else(|| p.to_string())
}

/// Friendly label for a tool call.
pub fn tool_label(name: &str, input: &Value) -> (String, Option<String>) {
    let g = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("");
    match name {
        "WebSearch" => (format!("Searching the web: {}", short(g("query"), 80)), None),
        "WebFetch" => (format!("Reading {}", host_path(g("url"))), Some(g("url").to_string())),
        "Read" => (format!("Reading {}", file_name(g("file_path"))), Some(g("file_path").to_string())),
        "Glob" => (format!("Finding files: {}", short(g("pattern"), 60)), None),
        "Grep" => (format!("Searching files for: {}", short(g("pattern"), 60)), None),
        "Write" => (format!("Writing {}", file_name(g("file_path"))), Some(g("file_path").to_string())),
        "Edit" => (format!("Editing {}", file_name(g("file_path"))), Some(g("file_path").to_string())),
        "Bash" => (format!("Running: {}", short(g("command"), 60)), Some(g("command").to_string())),
        "mcp__quintet__ask_user" => {
            let n = input.get("questions").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            (format!("Asked {n} question{}", if n == 1 { "" } else { "s" }), None)
        }
        "mcp__quintet__propose_action" => (format!("Proposed: {}", g("type")), Some(short(g("preview_md"), 200))),
        "mcp__quintet__save_output" => (format!("Saved: {}", short(g("title"), 80)), Some(g("path").to_string())),
        "mcp__quintet__now" => ("Checked the time".to_string(), None),
        n if n.starts_with("mcp__quintet__") => (n.trim_start_matches("mcp__quintet__").replace('_', " "), Some(short(&input.to_string(), 120))),
        n if n.starts_with("mcp__") => (n.replace("__", " › ").replace('_', " "), Some(short(&input.to_string(), 120))),
        other => (other.to_string(), Some(short(&input.to_string(), 120))),
    }
}

fn kind_for_tool(name: &str) -> UiRowKind {
    match name {
        "mcp__quintet__ask_user" => UiRowKind::Question,
        "mcp__quintet__propose_action" => UiRowKind::Proposal,
        "mcp__quintet__save_output" => UiRowKind::Output,
        _ => UiRowKind::Tool,
    }
}

/// Map one event to zero or more UI rows. `seq` is the event sequence number.
pub fn to_ui_rows(ev: &StreamEvent, seq: i64, ts: &str) -> Vec<UiRow> {
    let row = |kind: UiRowKind, label: String, detail: Option<String>, tool_use_id: Option<String>, state: UiRowState| UiRow { seq, kind, label, detail, tool_use_id, state, ts: ts.to_string() };
    match ev {
        StreamEvent::Init(i) => {
            let mut rows = vec![row(UiRowKind::System, format!("Started · {}", i.model), None, None, UiRowState::Done)];
            for m in &i.mcp_servers {
                if m.status != "connected" {
                    rows.push(row(UiRowKind::Error, format!("MCP server `{}` {}", m.name, m.status), None, None, UiRowState::Error));
                }
            }
            rows
        }
        StreamEvent::PermissionDenied { tool_name, tool_use_id, message, .. } => vec![row(UiRowKind::Error, format!("Blocked: {tool_name}"), Some(message.clone()), tool_use_id.clone(), UiRowState::Error)],
        StreamEvent::SystemOther { .. } | StreamEvent::Thinking | StreamEvent::RateLimit(_) | StreamEvent::Unknown { .. } => vec![],
        StreamEvent::Text(t) => if t.trim().is_empty() { vec![] } else { vec![row(UiRowKind::Text, t.clone(), None, None, UiRowState::Done)] },
        StreamEvent::ToolUse { id, name, input } => {
            let (label, detail) = tool_label(name, input);
            vec![row(kind_for_tool(name), label, detail, Some(id.clone()), UiRowState::Running)]
        }
        StreamEvent::ToolResult { tool_use_id, is_error, text } => vec![row(UiRowKind::Tool, String::new(), Some(short(text, 200)), Some(tool_use_id.clone()), if *is_error { UiRowState::Error } else { UiRowState::Done })],
        StreamEvent::Result(r) => {
            let (kind, state, label) = if r.is_error {
                (UiRowKind::Error, UiRowState::Error, match r.subtype.as_str() {
                    "error_max_turns" => format!("Stopped: turn limit reached after {} turns", r.num_turns),
                    "error_during_execution" => "Interrupted".to_string(),
                    other => format!("Failed: {other}"),
                })
            } else {
                (UiRowKind::Result, UiRowState::Done, format!("Finished · {} turn{} · ${:.3}", r.num_turns, if r.num_turns == 1 { "" } else { "s" }, r.total_cost_usd))
            };
            vec![row(kind, label, r.text.clone(), None, state)]
        }
    }
}

/// Rebuild the Chat rows of a finished or running run from its persisted events.
pub fn replay_rows(events: &[crate::db::runs::EventRow]) -> Vec<UiRow> {
    let mut out = Vec::new();
    for e in events {
        let parsed = match serde_json::from_str::<Value>(&e.json) { Ok(v) => parse_value(&v), Err(_) => vec![StreamEvent::Unknown { kind: "<unparseable>".into() }] };
        for ev in &parsed { out.extend(to_ui_rows(ev, e.seq, &e.created_at)); }
    }
    out
}
