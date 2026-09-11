use quintet_core::db::Db;
use quintet_core::prompt::{assemble, format_saigon, integrity_rules, intake_to_yaml, PromptInputs, RunContext, PROTOCOL};
use quintet_core::snapshot::state_snapshot;

fn ctx() -> RunContext {
    RunContext {
        now_saigon: "Thursday 2026-09-11 10:05 +07:00 (Asia/Saigon)".into(),
        trigger: "manual".into(),
        integrity_level: Some(1),
        intake_yaml: "question: What is FSRS?\ndepth: standard\noutput: [brief]".into(),
        task: "What is FSRS?".into(),
        output_dir: "/HOME/Quintet/outputs/research/2026-09-11-what-is-fsrs".into(),
        workspace: "/HOME/Quintet/agents/research/workspace".into(),
        memory_path: "/HOME/Quintet/agents/research/memory.md".into(),
    }
}

#[test]
fn sections_in_spec_order_with_all_inputs() {
    let run = ctx();
    let p = assemble(&PromptInputs { run: &run, profile: "## School & grades\nSSIS", role_body: "# Role\nYou are the Analyst.", memory: "---\n---\n# Memory\ndefault_citation_style: Chicago", state: "Recently saved sources: none yet." });
    let idx = |h: &str| p.find(h).unwrap_or_else(|| panic!("missing header {h}\n{p}"));
    let order = [idx("# Quintet protocol"), idx("# Run context"), idx("# Maxwell"), idx("# Your role"), idx("# Your memory"), idx("# Relevant state")];
    assert!(order.windows(2).all(|w| w[0] < w[1]), "headers out of order: {order:?}");
    assert!(p.contains(PROTOCOL.trim_end()));
    assert!(p.contains("- Now: Thursday 2026-09-11 10:05 +07:00 (Asia/Saigon)"));
    assert!(p.contains("- Trigger: manual"));
    assert!(p.contains("- Integrity level: 1. Level 1 — Coach only."));
    assert!(p.contains("- Output directory (deliverables, register with save_output): /HOME/Quintet/outputs/research/2026-09-11-what-is-fsrs"));
    assert!(p.contains("- Memory file: /HOME/Quintet/agents/research/memory.md"));
    assert!(p.contains("```yaml\nquestion: What is FSRS?\ndepth: standard\noutput: [brief]\n```"));
    assert!(p.contains("Task:\n\nWhat is FSRS?"));
    assert!(p.contains("# Maxwell\n\n## School & grades\nSSIS"));
    assert!(p.contains("# Your role\n\n# Role\nYou are the Analyst."));
    assert!(p.contains("# Your memory\n\n---\n---\n# Memory\ndefault_citation_style: Chicago"));
    assert!(p.ends_with("# Relevant state\n\nRecently saved sources: none yet.\n"));
    // Protocol must state the memory location decided in ADR-0004 and the proposal rule.
    assert!(PROTOCOL.contains("`../memory.md`"));
    assert!(PROTOCOL.contains("\"proposed\", never \"done\""));
}

#[test]
fn empty_inputs_have_placeholders_and_no_integrity() {
    let mut run = ctx();
    run.integrity_level = None;
    run.intake_yaml = String::new();
    let p = assemble(&PromptInputs { run: &run, profile: "", role_body: "You are X.", memory: "  \n", state: "" });
    assert!(p.contains("- Integrity level: not applicable to this task."));
    assert!(!p.contains("Intake answers:"));
    assert!(p.contains("# Maxwell\n\n(profile.md is empty)"));
    assert!(p.contains("# Your memory\n\n(memory.md is empty)"));
    assert!(p.contains("# Relevant state\n\nNo state yet."));
    for l in 0..=3u8 { assert!(integrity_rules(l).starts_with(&format!("Level {l}"))); }
}

#[test]
fn intake_yaml_and_time_formatting() {
    let m: serde_json::Map<String, serde_json::Value> = serde_json::from_str(r#"{"question":"Is 3:1 odd?","depth":"standard","output":["brief","lit_review"],"n":2,"flag":true,"due":null}"#).expect("json");
    let y = intake_to_yaml(&m);
    assert!(y.contains("question: \"Is 3:1 odd?\""), "{y}");
    assert!(y.contains("depth: standard"));
    assert!(y.contains("output: [brief, lit_review]"));
    assert!(y.contains("n: 2"));
    assert!(y.contains("flag: true"));
    assert!(y.contains("due: null"));
    let t = chrono::DateTime::parse_from_rfc3339("2026-09-11T03:05:00Z").expect("t").with_timezone(&chrono::Utc);
    assert_eq!(format_saigon(t), "Friday 2026-09-11 10:05 +07:00 (Asia/Saigon)");
}

#[test]
fn snapshots_run_against_the_schema() {
    let db = Db::open_in_memory().expect("db");
    for name in ["research_recent", "college_tracker", "scout_upcoming", "school_next14", "tutor_weak_spots"] {
        let s = state_snapshot(name, &db).expect(name);
        assert!(s.ends_with("none yet."), "{name}: {s}");
    }
    assert!(state_snapshot("nope", &db).expect("unknown").contains("unknown snapshot"));
    db.conn().expect("conn").execute("INSERT INTO weak_spots(id, topic, concept, error_type, count, last_seen, created_at, updated_at) VALUES ('w1','calculus','chain rule','misconception',3,'2026-09-01T00:00:00Z','x','x')", []).expect("insert");
    let s = state_snapshot("tutor_weak_spots", &db).expect("ws");
    assert!(s.contains("chain rule · misconception ×3"), "{s}");
}
