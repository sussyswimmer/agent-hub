//! Pure builder for the `claude -p` argument vector. Encodes every Phase 0 finding
//! (`docs/claude-cli-notes.md` §8, ADR-0001, ADR-0002, ADR-0004). The task text is NOT an
//! argument: it goes on stdin, because the variadic flags would swallow a trailing prompt.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::types::{IntegrityLevel, Model};

/// Built-in tools exposed to every run (`--tools`). Everything else built in is hidden.
pub const BUILTIN_TOOLS: &str = "Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch";

/// Always denied (CLAUDE.md §3.2 global denylist + ADR-0004).
pub const GLOBAL_DENYLIST: &[&str] = &[
    "Bash(curl *)",
    "Bash(wget *)",
    "Bash(git push *)",
    "Bash(rm -rf *)",
    "mcp__*__send_*",
    "mcp__*__delete_*",
    "mcp__*__create_*",
    "NotebookEdit",
];

pub const QUINTET_MCP_RULE: &str = "mcp__quintet__*";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionMode {
    /// Fresh run: the app pre-assigns the UUID (`--session-id`).
    New(String),
    /// Continue an existing session (`--resume`).
    Resume(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunSpec {
    pub model: Model,
    pub max_turns: u32,
    pub budget_usd: f64,
    pub system_prompt_file: PathBuf,
    /// `None` = no MCP servers at all (still `--strict-mcp-config`).
    pub mcp_config_file: Option<PathBuf>,
    /// The agent's `allowed_tools` as written in frontmatter.
    pub allowed_tools: Vec<String>,
    pub integrity_level: Option<IntegrityLevel>,
    /// Absolute path of `agents/<id>/memory.md`, for the `Edit(//…)` rule.
    pub memory_abs: PathBuf,
    pub session: SessionMode,
    /// Adds `--restricted --add-dir <dir>` for each dir (ADR-0001 add-on).
    pub restricted_to: Vec<PathBuf>,
    /// Extra allowed working directories (`--add-dir`), always: the run's output folder, so the
    /// CLI can list, read and write deliverables outside the workspace cwd.
    pub add_dirs: Vec<PathBuf>,
}

fn is_file_write_tool(rule: &str) -> bool {
    let name = rule.split('(').next().unwrap_or(rule).trim();
    matches!(name, "Write" | "Edit" | "MultiEdit" | "NotebookEdit")
}

/// The `--allowedTools` list actually passed, after integrity stripping.
pub fn effective_allowed_tools(spec: &RunSpec) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let strip = matches!(spec.integrity_level, Some(0) | Some(1));
    for t in &spec.allowed_tools {
        let t = t.trim();
        if t.is_empty() || (strip && is_file_write_tool(t)) {
            continue;
        }
        if !out.iter().any(|x| x == t) {
            out.push(t.to_string());
        }
    }
    if strip {
        let mem = format!("Edit(//{})", spec.memory_abs.display().to_string().trim_start_matches('/'));
        out.push(mem);
        if !out.iter().any(|x| x == "Read") {
            out.push("Read".to_string());
        }
    }
    if !out.iter().any(|x| x == QUINTET_MCP_RULE) {
        out.push(QUINTET_MCP_RULE.to_string());
    }
    out
}

pub fn permission_mode(spec: &RunSpec) -> &'static str {
    match spec.integrity_level {
        Some(0) | Some(1) => "default",
        _ => "acceptEdits",
    }
}

fn os(s: impl AsRef<str>) -> OsString {
    OsString::from(s.as_ref())
}

pub fn build_args(spec: &RunSpec) -> Vec<OsString> {
    let mut a: Vec<OsString> = vec![os("-p"), os("--output-format"), os("stream-json"), os("--verbose")];
    match &spec.session {
        SessionMode::New(id) => { a.push(os("--session-id")); a.push(os(id)); }
        SessionMode::Resume(id) => { a.push(os("--resume")); a.push(os(id)); }
    }
    a.push(os("--model")); a.push(os(spec.model.alias()));
    a.push(os("--max-turns")); a.push(os(spec.max_turns.to_string()));
    a.push(os("--max-budget-usd")); a.push(os(format!("{:.2}", spec.budget_usd)));
    a.push(os("--append-system-prompt-file")); a.push(spec.system_prompt_file.as_os_str().to_owned());
    a.push(os("--setting-sources")); a.push(os(""));
    a.push(os("--disable-slash-commands"));
    a.push(os("--strict-mcp-config"));
    if let Some(f) = &spec.mcp_config_file {
        a.push(os("--mcp-config")); a.push(f.as_os_str().to_owned());
    }
    if !spec.restricted_to.is_empty() {
        a.push(os("--restricted"));
        for d in &spec.restricted_to { a.push(os("--add-dir")); a.push(d.as_os_str().to_owned()); }
    }
    for d in &spec.add_dirs { a.push(os("--add-dir")); a.push(d.as_os_str().to_owned()); }
    a.push(os("--tools")); a.push(os(BUILTIN_TOOLS));
    a.push(os("--permission-mode")); a.push(os(permission_mode(spec)));
    a.push(os("--permission-prompts")); a.push(os("none"));
    a.push(os("--allowedTools"));
    for t in effective_allowed_tools(spec) { a.push(os(t)); }
    a.push(os("--disallowedTools"));
    for d in GLOBAL_DENYLIST { a.push(os(d)); }
    a
}

/// For logs: the command as one shell-ish line (paths quoted).
pub fn render(bin: &Path, args: &[OsString]) -> String {
    let mut s = bin.display().to_string();
    for a in args {
        let t = a.to_string_lossy();
        if t.is_empty() { s.push_str(" \"\""); }
        else if t.contains([' ', '(', ')', '*']) { s.push_str(&format!(" \"{t}\"")); }
        else { s.push(' '); s.push_str(&t); }
    }
    s
}
