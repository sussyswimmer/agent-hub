//! System-prompt assembly (CLAUDE.md §3.3). Six sections, fixed order, each under a `#` header.

use crate::types::IntegrityLevel;

pub const PROTOCOL: &str = include_str!("protocol.md");

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RunContext {
    /// e.g. `Thursday 2026-09-11 10:05 (+07:00, Asia/Saigon)`
    pub now_saigon: String,
    /// `manual` or `scheduled:<name>`
    pub trigger: String,
    pub integrity_level: Option<IntegrityLevel>,
    /// Intake answers rendered as YAML (empty when there were none).
    pub intake_yaml: String,
    pub task: String,
    pub output_dir: String,
    pub workspace: String,
    pub memory_path: String,
}

#[derive(Debug, Clone, Copy)]
pub struct PromptInputs<'a> {
    pub run: &'a RunContext,
    pub profile: &'a str,
    pub role_body: &'a str,
    pub memory: &'a str,
    pub state: &'a str,
}

pub fn integrity_rules(level: IntegrityLevel) -> &'static str {
    match level {
        0 => "Level 0 — No AI. You may plan, schedule and remind. You may not touch the content of the assignment at all: no explanations of the material, no feedback on it, no examples.",
        1 => "Level 1 — Coach only. You may explain concepts, ask guiding questions, give feedback on text Maxwell wrote, and check answers he produced. You may not write any text or solution he could submit. Your tools cannot write deliverable files at this level.",
        2 => "Level 2 — Labeled examples. Everything from level 1, plus short examples on a *parallel* problem or sentence, each boxed as `EXAMPLE — rewrite in your own words`. Never produce the actual answer or submission text.",
        _ => "Level 3 — AI-assisted (the teacher allows it). You may draft sections he will revise. Add a disclosure note at the top of any drafted output stating that it was AI-assisted. Never pretend the work is unassisted.",
    }
}

pub fn assemble(i: &PromptInputs<'_>) -> String {
    let r = i.run;
    let mut out = String::with_capacity(8 * 1024);

    out.push_str("# Quintet protocol\n\n");
    out.push_str(PROTOCOL.trim_end());
    out.push_str("\n\n");

    out.push_str("# Run context\n\n");
    out.push_str(&format!("- Now: {}\n", r.now_saigon));
    out.push_str(&format!("- Trigger: {}\n", r.trigger));
    match r.integrity_level {
        Some(l) => out.push_str(&format!("- Integrity level: {l}. {}\n", integrity_rules(l))),
        None => out.push_str("- Integrity level: not applicable to this task.\n"),
    }
    out.push_str(&format!("- Working directory (scratch): {}\n", r.workspace));
    out.push_str(&format!("- Output directory (deliverables, register with save_output): {}\n", r.output_dir));
    out.push_str(&format!("- Memory file: {}\n", r.memory_path));
    if !r.intake_yaml.trim().is_empty() {
        out.push_str("\nIntake answers:\n\n```yaml\n");
        out.push_str(r.intake_yaml.trim_end());
        out.push_str("\n```\n");
    }
    out.push_str("\nTask:\n\n");
    out.push_str(r.task.trim());
    out.push_str("\n\n");

    out.push_str("# Maxwell\n\n");
    out.push_str(if i.profile.trim().is_empty() { "(profile.md is empty)" } else { i.profile.trim_end() });
    out.push_str("\n\n");

    out.push_str("# Your role\n\n");
    out.push_str(i.role_body.trim_end());
    out.push_str("\n\n");

    out.push_str("# Your memory\n\n");
    out.push_str(if i.memory.trim().is_empty() { "(memory.md is empty)" } else { i.memory.trim_end() });
    out.push_str("\n\n");

    out.push_str("# Relevant state\n\n");
    out.push_str(if i.state.trim().is_empty() { "No state yet." } else { i.state.trim_end() });
    out.push('\n');
    out
}

/// `Thursday 2026-09-11 10:05 (+07:00, Asia/Saigon)`.
pub fn now_saigon() -> String {
    format_saigon(chrono::Utc::now())
}

pub fn format_saigon(t: chrono::DateTime<chrono::Utc>) -> String {
    let local = t.with_timezone(&chrono_tz::Asia::Saigon);
    format!("{} (Asia/Saigon)", local.format("%A %Y-%m-%d %H:%M %:z"))
}

/// Render intake answers as simple YAML (`key: value` per line; lists inline).
pub fn intake_to_yaml(intake: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut lines = Vec::new();
    for (k, v) in intake {
        let rendered = match v {
            serde_json::Value::String(s) => yaml_scalar(s),
            serde_json::Value::Array(a) => format!("[{}]", a.iter().map(|x| match x { serde_json::Value::String(s) => yaml_scalar(s), o => o.to_string() }).collect::<Vec<_>>().join(", ")),
            serde_json::Value::Null => "null".to_string(),
            o => o.to_string(),
        };
        lines.push(format!("{k}: {rendered}"));
    }
    lines.join("\n")
}

fn yaml_scalar(s: &str) -> String {
    let needs_quote = s.is_empty() || s.contains([':', '#', '\n', '"', '\'', '[', ']', '{', '}']) || s.starts_with(['-', '?', '&', '*', '!', '|', '>', '%', '@', '`', ' ']) || matches!(s, "true" | "false" | "null" | "yes" | "no") || s.parse::<f64>().is_ok();
    if needs_quote { serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\"")) } else { s.to_string() }
}
