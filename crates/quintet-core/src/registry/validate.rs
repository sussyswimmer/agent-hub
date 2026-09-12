//! Frontmatter validation: JSON Schema first (friendly messages), then semantic checks.

use std::sync::OnceLock;

use serde_json::Value;

use crate::types::{AgentDef, IntakeType, Model};

pub const SCHEMA_JSON: &str = include_str!("../../../../agents-default/agent.schema.json");

pub const KNOWN_SNAPSHOTS: &[&str] = &[
    "research_recent",
    "college_tracker",
    "scout_upcoming",
    "school_next14",
    "tutor_weak_spots",
];

fn validator() -> &'static jsonschema::Validator {
    static V: OnceLock<jsonschema::Validator> = OnceLock::new();
    V.get_or_init(|| {
        let schema: Value = serde_json::from_str(SCHEMA_JSON).expect("agent.schema.json is valid JSON");
        jsonschema::validator_for(&schema).expect("agent.schema.json is a valid schema")
    })
}

/// Errors as `path: message` lines. Empty = valid.
pub fn schema_errors(doc: &Value) -> Vec<String> {
    validator()
        .iter_errors(doc)
        .map(|e| {
            let path = e.instance_path().to_string();
            let path = if path.is_empty() { "/".to_string() } else { path };
            format!("{path}: {e}")
        })
        .collect()
}

pub fn semantic_errors(def: &AgentDef, folder_id: &str) -> Vec<String> {
    let mut errs = Vec::new();
    if def.id != folder_id {
        errs.push(format!("id `{}` must equal the folder name `{folder_id}`", def.id));
    }
    if !(1..=500).contains(&def.max_turns) {
        errs.push(format!("max_turns must be 1..=500 (got {})", def.max_turns));
    }
    let _ = Model::Opus; // enum is enforced by serde
    let mut seen = std::collections::HashSet::new();
    for f in &def.intake {
        if !seen.insert(f.id.as_str()) {
            errs.push(format!("intake: duplicate field id `{}`", f.id));
        }
        match f.kind {
            IntakeType::Single | IntakeType::Multi => {
                let Some(opts) = &f.options else {
                    errs.push(format!("intake.{}: `options` is required for type {:?}", f.id, f.kind));
                    continue;
                };
                if let Some(d) = &f.default {
                    let bad = match (f.kind, d) {
                        (IntakeType::Single, Value::String(s)) => !opts.contains(s),
                        (IntakeType::Multi, Value::Array(a)) => a.iter().any(|v| !v.as_str().is_some_and(|s| opts.contains(&s.to_string()))),
                        (IntakeType::Single, _) => true,
                        (IntakeType::Multi, _) => true,
                        _ => false,
                    };
                    if bad {
                        errs.push(format!("intake.{}: default {d} is not one of the options", f.id));
                    }
                }
            }
            IntakeType::Integrity => {
                if let Some(m) = f.max
                    && m > 3 {
                        errs.push(format!("intake.{}: max must be ≤ 3", f.id));
                    }
                if let Some(d) = &f.default {
                    match d.as_u64() {
                        Some(n) if n <= 3 => {
                            if let Some(m) = f.max
                                && n > u64::from(m) {
                                    errs.push(format!("intake.{}: default {n} exceeds max {m}", f.id));
                                }
                        }
                        _ => errs.push(format!("intake.{}: default must be an integer 0..=3", f.id)),
                    }
                }
            }
            IntakeType::Text | IntakeType::Date | IntakeType::File => {
                if f.options.is_some() {
                    errs.push(format!("intake.{}: `options` only applies to single/multi", f.id));
                }
            }
        }
        if f.from_chat && f.kind != IntakeType::Text {
            errs.push(format!("intake.{}: from_chat only applies to text fields", f.id));
        }
        if let Some(expr) = &f.skip_if
            && let Err(e) = crate::skip_if::validate(expr) {
                errs.push(format!("intake.{}: skip_if: {e}", f.id));
            }
    }
    if let Some(s) = &def.state_snapshot
        && !KNOWN_SNAPSHOTS.contains(&s.as_str()) {
            errs.push(format!("state_snapshot `{s}` is not one of {}", KNOWN_SNAPSHOTS.join(", ")));
        }
    let mut sched_names = std::collections::HashSet::new();
    for s in &def.schedules {
        if !sched_names.insert(s.name.as_str()) {
            errs.push(format!("schedules: duplicate name `{}`", s.name));
        }
        let fields = s.cron.split_whitespace().count();
        if !(5..=6).contains(&fields) {
            errs.push(format!("schedules.{}: cron `{}` must have 5 or 6 fields", s.name, s.cron));
        }
        if s.tz.parse::<chrono_tz::Tz>().is_err() {
            errs.push(format!("schedules.{}: unknown timezone `{}`", s.name, s.tz));
        }
    }
    errs
}
