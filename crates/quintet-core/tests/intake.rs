use std::path::Path;

use quintet_core::intake::{evaluate, frontmatter_json, resolve};
use quintet_core::registry::parse_agent_md;
use quintet_core::types::AgentDef;
use serde_json::{json, Map, Value};

fn def(id: &str) -> AgentDef {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agents-default").join(id).join("agent.md");
    parse_agent_md(&std::fs::read_to_string(&p).expect("read"), id, &p).def.expect("def")
}
fn m(v: Value) -> Map<String, Value> { v.as_object().cloned().unwrap_or_default() }
fn empty() -> Value { json!({}) }

#[test]
fn research_quick_task_from_chat_starts_immediately() {
    let d = def("research");
    let f = evaluate(&d, "What is FSRS?", &Map::new(), empty(), empty());
    assert!(f.can_start, "{:?}", f.missing);
    let by = |id: &str| f.fields.iter().find(|v| v.field.id == id).expect(id);
    assert_eq!(by("question").prefill, Some(json!("What is FSRS?")));
    assert_eq!(by("output").prefill, Some(json!(["brief"])));
    assert_eq!(by("depth").prefill, Some(json!("standard")));
    assert!(!by("citation_style").skipped, "no memory default yet");
    assert_eq!(by("graded").prefill, Some(json!("no")));
    assert!(by("integrity").skipped, "integrity skipped unless graded == yes");
    assert!(by("due_date").satisfied && by("due_date").prefill.is_none(), "optional fields never block");
    // Memory default → citation style skipped.
    let f2 = evaluate(&d, "What is FSRS?", &Map::new(), json!({"default_citation_style": "Chicago"}), empty());
    assert!(f2.fields.iter().find(|v| v.field.id == "citation_style").expect("cs").skipped);
    // Empty composer → the required question is missing.
    let f3 = evaluate(&d, "", &Map::new(), empty(), empty());
    assert!(!f3.can_start);
    assert_eq!(f3.missing, vec!["question".to_string()]);
}

#[test]
fn graded_answer_reveals_integrity_and_resolve_records_it() {
    let d = def("research");
    let answers = m(json!({"graded": "yes", "integrity": 2}));
    let f = evaluate(&d, "Summarise the AFC paper", &answers, empty(), empty());
    let i = f.fields.iter().find(|v| v.field.id == "integrity").expect("integrity");
    assert!(!i.skipped);
    assert_eq!(i.prefill, Some(json!(2)));
    let r = resolve(&d, "Summarise the AFC paper", &answers, empty(), json!({"class_of": 2028}));
    assert_eq!(r.integrity_level, Some(2));
    assert_eq!(r.intake.get("question"), Some(&json!("Summarise the AFC paper")));
    assert_eq!(r.intake.get("graded"), Some(&json!("yes")));
    assert!(r.intake.contains_key("depth") && !r.intake.contains_key("due_date"), "{:?}", r.intake);
    // Not graded → no integrity level at all.
    let r2 = resolve(&d, "x", &Map::new(), empty(), empty());
    assert_eq!(r2.integrity_level, None);
    assert!(!r2.intake.contains_key("integrity"));
}

#[test]
fn college_caps_essays_at_two_and_hides_essay_fields_in_other_modes() {
    let d = def("college");
    let r = resolve(&d, "Common App prompt 1", &m(json!({"integrity": 3})), empty(), empty());
    assert_eq!(r.integrity_level, Some(2), "hard cap from `max: 2`");
    let f = evaluate(&d, "verify Yale deadlines", &m(json!({"mode": "tracker"})), empty(), empty());
    let by = |id: &str| f.fields.iter().find(|v| v.field.id == id).expect(id);
    assert!(by("stage").skipped && by("draft_file").skipped && by("integrity").skipped);
    assert!(f.can_start);
    let r = resolve(&d, "verify Yale deadlines", &m(json!({"mode": "tracker"})), empty(), empty());
    assert_eq!(r.integrity_level, None);
    assert_eq!(r.intake.get("mode"), Some(&json!("tracker")));
}

#[test]
fn frontmatter_json_tolerates_everything() {
    assert_eq!(frontmatter_json("---\na: 1\nb: [x, y]\n---\nbody"), json!({"a": 1, "b": ["x", "y"]}));
    assert_eq!(frontmatter_json("---\n---\n# Memory"), json!({}));
    assert_eq!(frontmatter_json("no frontmatter"), json!({}));
    assert_eq!(frontmatter_json("---\n- just\n- a list\n---\n"), json!({}));
    assert_eq!(frontmatter_json("---\n: broken: [\n---\n"), json!({}));
}
