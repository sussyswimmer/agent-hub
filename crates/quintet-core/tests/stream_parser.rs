//! Every Phase 0 fixture parses without error; specific events and UI rows are asserted.

use std::path::Path;

use quintet_core::stream::{parse_line, to_ui_rows, tool_label, StreamEvent};
use quintet_core::types::{UiRowKind, UiRowState};

fn fixture(name: &str) -> Vec<Vec<StreamEvent>> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stream").join(name);
    let text = std::fs::read_to_string(&p).expect("fixture");
    text.lines().filter(|l| !l.trim().is_empty()).map(|l| parse_line(l).unwrap_or_else(|e| panic!("{name}: {e}: {l}"))).collect()
}

fn flat(name: &str) -> Vec<StreamEvent> {
    fixture(name).into_iter().flatten().collect()
}

fn result(events: &[StreamEvent]) -> Option<&quintet_core::stream::ResultInfo> {
    events.iter().find_map(|e| if let StreamEvent::Result(r) = e { Some(r) } else { None })
}

#[test]
fn all_fixtures_parse() {
    for f in std::fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stream")).expect("dir") {
        let name = f.expect("entry").file_name().to_string_lossy().into_owned();
        if !name.ends_with(".jsonl") { continue; }
        let events = flat(&name);
        assert!(!events.is_empty(), "{name} produced no events");
        // Every non-empty line yields at least one event, unknown types included.
        for e in &events { let _ = e.type_label(); }
    }
}

#[test]
fn simple_text_has_isolated_init_and_success() {
    let ev = flat("simple_text.jsonl");
    let init = ev.iter().find_map(|e| if let StreamEvent::Init(i) = e { Some(i) } else { None }).expect("init");
    assert!(init.skills.is_empty());
    assert_eq!(init.plugins, 0);
    assert!(init.model.starts_with("claude-haiku"));
    assert!(ev.iter().any(|e| matches!(e, StreamEvent::Text(t) if t.starts_with("QUINTET-OK"))));
    let r = result(&ev).expect("result");
    assert_eq!(r.subtype, "success");
    assert!(!r.is_error);
    assert!(r.total_cost_usd > 0.0);
    assert!(r.usage.output_tokens > 0);
    assert!(r.text.as_deref().unwrap_or("").starts_with("QUINTET-OK"));
}

#[test]
fn mcp_ping_round_trip() {
    let ev = flat("mcp_ping.jsonl");
    let init = ev.iter().find_map(|e| if let StreamEvent::Init(i) = e { Some(i) } else { None }).expect("init");
    assert_eq!(init.mcp_servers.len(), 1);
    assert_eq!(init.mcp_servers[0].name, "quintet");
    assert_eq!(init.mcp_servers[0].status, "connected");
    assert!(init.tools.iter().any(|t| t == "mcp__quintet__ping"));
    let use_id = ev.iter().find_map(|e| if let StreamEvent::ToolUse { id, name, .. } = e { (name == "mcp__quintet__ping").then(|| id.clone()) } else { None }).expect("tool_use");
    assert!(ev.iter().any(|e| matches!(e, StreamEvent::ToolResult { tool_use_id, is_error: false, text } if *tool_use_id == use_id && text == "pong")));
}

#[test]
fn permission_denials_are_surfaced() {
    let ev = flat("bash_permission_denied.jsonl");
    let denied = ev.iter().find_map(|e| if let StreamEvent::PermissionDenied { tool_name, message, tool_use_id, reason } = e { Some((tool_name.clone(), message.clone(), tool_use_id.clone(), reason.clone())) } else { None }).expect("permission_denied event");
    assert_eq!(denied.0, "Bash");
    assert!(denied.1.contains("curl"));
    assert!(denied.2.is_some());
    assert_eq!(denied.3.as_deref(), Some("subcommandResults"));
    let r = result(&ev).expect("result");
    assert_eq!(r.permission_denials.len(), 1);
    assert_eq!(r.permission_denials[0].tool_name, "Bash");
    let rows: Vec<_> = ev.iter().enumerate().flat_map(|(i, e)| to_ui_rows(e, i as i64, "t")).collect();
    assert!(rows.iter().any(|r| r.kind == UiRowKind::Error && r.label == "Blocked: Bash" && r.state == UiRowState::Error));
    assert!(rows.iter().any(|r| r.label.starts_with("Running: curl")));

    let ev = flat("mcp_permission_denied.jsonl");
    assert!(ev.iter().any(|e| matches!(e, StreamEvent::ToolResult { is_error: true, .. })));
    assert_eq!(result(&ev).expect("result").permission_denials.len(), 1);
}

#[test]
fn mcp_server_failed_is_visible() {
    let ev = flat("mcp_server_failed.jsonl");
    let init = ev.iter().find_map(|e| if let StreamEvent::Init(i) = e { Some(i) } else { None }).expect("init");
    assert_eq!(init.mcp_servers[0].status, "failed");
    let rows = to_ui_rows(&StreamEvent::Init(init.clone()), 0, "t");
    assert!(rows.iter().any(|r| r.kind == UiRowKind::Error && r.label.contains("failed")));
}

#[test]
fn error_results() {
    let ev = flat("max_turns_error.jsonl");
    let r = result(&ev).expect("result");
    assert_eq!(r.subtype, "error_max_turns");
    assert!(r.is_error);
    assert_eq!(r.num_turns, 3);
    let rows = to_ui_rows(&StreamEvent::Result(r.clone()), 9, "t");
    assert_eq!(rows[0].kind, UiRowKind::Error);
    assert!(rows[0].label.contains("turn limit"));

    let ev = flat("interrupted_sigint.jsonl");
    let r = result(&ev).expect("result");
    assert_eq!(r.subtype, "error_during_execution");
    assert!(r.is_error);

    let ev = flat("killed_sigterm.jsonl");
    assert!(result(&ev).is_none(), "SIGTERM leaves no result event");
}

#[test]
fn unknown_events_are_tolerated_and_silent() {
    for name in ["remote_session_noise.jsonl", "background_task_events.jsonl"] {
        let ev = flat(name);
        let unknown = ev.iter().filter(|e| matches!(e, StreamEvent::Unknown { .. } | StreamEvent::SystemOther { .. })).count();
        assert!(unknown > 0, "{name} should contain unknown/system-other events");
        for e in &ev {
            if matches!(e, StreamEvent::Unknown { .. } | StreamEvent::SystemOther { .. } | StreamEvent::RateLimit(_) | StreamEvent::Thinking) {
                assert!(to_ui_rows(e, 0, "t").is_empty(), "{e:?} must not produce a row");
            }
        }
    }
    let ev = flat("simple_text.jsonl");
    assert!(ev.iter().any(|e| matches!(e, StreamEvent::RateLimit(r) if !r.status.is_empty())));
}

#[test]
fn resume_turn_keeps_session() {
    let ev = flat("resume_turn.jsonl");
    let init = ev.iter().find_map(|e| if let StreamEvent::Init(i) = e { Some(i) } else { None }).expect("init");
    let r = result(&ev).expect("result");
    assert_eq!(init.session_id, r.session_id);
    assert!(r.text.as_deref().unwrap_or("").contains("PELICAN-42"));
}

#[test]
fn tool_labels() {
    let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).expect("json");
    assert_eq!(tool_label("WebSearch", &j(r#"{"query":"FSRS spaced repetition"}"#)).0, "Searching the web: FSRS spaced repetition");
    assert_eq!(tool_label("WebFetch", &j(r#"{"url":"https://github.com/open-spaced-repetition/fsrs4anki/wiki"}"#)).0, "Reading github.com/open-spaced-repetition/fsrs4anki/wiki");
    assert_eq!(tool_label("Read", &j(r#"{"file_path":"/HOME/Quintet/agents/x/workspace/notes.md"}"#)).0, "Reading notes.md");
    assert_eq!(tool_label("Bash", &j(r#"{"command":"uv run analysis.py"}"#)).0, "Running: uv run analysis.py");
    assert_eq!(tool_label("mcp__quintet__ask_user", &j(r#"{"questions":[{"id":"a"},{"id":"b"}]}"#)).0, "Asked 2 questions");
    assert_eq!(tool_label("mcp__quintet__propose_action", &j(r#"{"type":"calendar.create_events","payload":[],"preview_md":"x"}"#)).0, "Proposed: calendar.create_events");
    assert_eq!(tool_label("mcp__quintet__save_output", &j(r#"{"title":"Brief","path":"brief.md","kind":"md"}"#)).0, "Saved: Brief");
    assert_eq!(tool_label("mcp__quintet__now", &j("{}")).0, "Checked the time");
    // A parse error is an Err, not a panic.
    assert!(parse_line("not json").is_err());
}
