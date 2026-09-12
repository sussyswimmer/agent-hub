//! Intake forms (CLAUDE.md §4): which fields to show, what to prefill, and when the run can start
//! without a form at all. `skip_if` is evaluated over `memory.*` / `profile.*` (YAML frontmatter of
//! the agent's memory.md and shared/profile.md) and `task.*` (composer text + answers so far).

use serde_json::{Map, Value};

use crate::registry::frontmatter::split_frontmatter;
use crate::skip_if::{self, Ctx};
use crate::types::{AgentDef, IntakeField, IntakeFieldView, IntakeForm, IntakeType, IntegrityLevel, ResolvedIntake};

/// YAML frontmatter of a markdown file as JSON (`{}` when absent or unparsable).
pub fn frontmatter_json(text: &str) -> Value {
    match split_frontmatter(text) {
        Ok((yaml, _)) => serde_yaml_ng::from_str::<Value>(&yaml).ok().filter(Value::is_object).unwrap_or_else(|| Value::Object(Map::new())),
        Err(_) => Value::Object(Map::new()),
    }
}

fn is_empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

fn prefill_for(f: &IntakeField, task_text: &str, partial: &Map<String, Value>) -> Option<Value> {
    if let Some(v) = partial.get(&f.id)
        && !is_empty(Some(v))
    {
        return Some(v.clone());
    }
    if f.kind == IntakeType::Text && f.from_chat && !task_text.trim().is_empty() {
        return Some(Value::String(task_text.trim().to_string()));
    }
    f.default.clone().filter(|d| !is_empty(Some(d)))
}

fn clamp_integrity(v: &Value, max: Option<IntegrityLevel>) -> Value {
    let n = v.as_u64().unwrap_or(1).min(3) as u8;
    Value::from(n.min(max.unwrap_or(3)))
}

fn task_ctx(def: &AgentDef, task_text: &str, partial: &Map<String, Value>) -> Value {
    let mut m = Map::new();
    m.insert("text".into(), Value::String(task_text.to_string()));
    for f in &def.intake {
        if let Some(v) = prefill_for(f, task_text, partial) { m.insert(f.id.clone(), v); }
    }
    for (k, v) in partial { m.insert(k.clone(), v.clone()); }
    Value::Object(m)
}

pub fn evaluate(def: &AgentDef, task_text: &str, partial: &Map<String, Value>, memory_fm: Value, profile_fm: Value) -> IntakeForm {
    let ctx = Ctx { memory: memory_fm, profile: profile_fm, task: task_ctx(def, task_text, partial) };
    let mut fields = Vec::new();
    let mut missing = Vec::new();
    for f in &def.intake {
        let skipped = f.skip_if.as_deref().map(|e| skip_if::should_skip(e, &ctx)).unwrap_or(false);
        let mut prefill = prefill_for(f, task_text, partial);
        if f.kind == IntakeType::Integrity { prefill = prefill.map(|v| clamp_integrity(&v, f.max)); }
        let satisfied = skipped || !f.required || !is_empty(prefill.as_ref());
        if !satisfied { missing.push(f.id.clone()); }
        fields.push(IntakeFieldView { field: f.clone(), skipped, prefill, satisfied });
    }
    IntakeForm { agent_id: def.id.clone(), can_start: missing.is_empty(), missing, fields }
}

/// The intake map recorded on the run (non-skipped fields with a value) and the integrity level.
pub fn resolve(def: &AgentDef, task_text: &str, answers: &Map<String, Value>, memory_fm: Value, profile_fm: Value) -> ResolvedIntake {
    let form = evaluate(def, task_text, answers, memory_fm, profile_fm);
    let mut intake = Map::new();
    let mut integrity_level = None;
    for v in form.fields {
        if v.skipped { continue; }
        let Some(val) = v.prefill else { continue };
        if v.field.kind == IntakeType::Integrity { integrity_level = val.as_u64().map(|n| n as u8); }
        intake.insert(v.field.id, val);
    }
    ResolvedIntake { intake, integrity_level }
}
