use std::ffi::OsString;
use std::path::PathBuf;

use quintet_core::runs::cmd::{build_args, effective_allowed_tools, render, RunSpec, SessionMode, BUILTIN_TOOLS, GLOBAL_DENYLIST};
use quintet_core::runs::mcp_config::{build_mcp_config, default_extra_servers, McpLauncher};
use quintet_core::types::Model;

fn spec() -> RunSpec {
    RunSpec {
        model: Model::Opus,
        max_turns: 60,
        budget_usd: 2.0,
        system_prompt_file: PathBuf::from("/HOME/Quintet/logs/runs/R1.system.md"),
        mcp_config_file: Some(PathBuf::from("/HOME/Quintet/logs/runs/R1.mcp.json")),
        allowed_tools: vec!["WebSearch".into(), "WebFetch".into(), "Read".into(), "Write".into(), "Edit".into(), "Bash(python3:*)".into(), "mcp__quintet__*".into()],
        integrity_level: None,
        memory_abs: PathBuf::from("/HOME/Quintet/agents/research/memory.md"),
        session: SessionMode::New("11111111-2222-3333-4444-555555555555".into()),
        restricted_to: vec![],
    }
}

fn strs(a: &[OsString]) -> Vec<String> { a.iter().map(|s| s.to_string_lossy().into_owned()).collect() }

fn value_after<'a>(args: &'a [String], flag: &str) -> &'a str { let i = args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("missing {flag}")); &args[i + 1] }

fn values_after(args: &[String], flag: &str) -> Vec<String> {
    let i = args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("missing {flag}"));
    args[i + 1..].iter().take_while(|a| !a.starts_with("--")).cloned().collect()
}

#[test]
fn default_level_accept_edits_and_full_allowlist() {
    let a = strs(&build_args(&spec()));
    assert_eq!(&a[..4], &["-p", "--output-format", "stream-json", "--verbose"]);
    assert_eq!(value_after(&a, "--session-id"), "11111111-2222-3333-4444-555555555555");
    assert!(!a.contains(&"--resume".to_string()));
    assert_eq!(value_after(&a, "--model"), "opus");
    assert_eq!(value_after(&a, "--max-turns"), "60");
    assert_eq!(value_after(&a, "--max-budget-usd"), "2.00");
    assert_eq!(value_after(&a, "--append-system-prompt-file"), "/HOME/Quintet/logs/runs/R1.system.md");
    assert_eq!(value_after(&a, "--setting-sources"), "");
    assert!(a.contains(&"--disable-slash-commands".to_string()));
    assert!(a.contains(&"--strict-mcp-config".to_string()));
    assert_eq!(value_after(&a, "--mcp-config"), "/HOME/Quintet/logs/runs/R1.mcp.json");
    assert_eq!(value_after(&a, "--tools"), BUILTIN_TOOLS);
    assert_eq!(value_after(&a, "--permission-mode"), "acceptEdits");
    assert_eq!(value_after(&a, "--permission-prompts"), "none");
    let allowed = values_after(&a, "--allowedTools");
    assert!(allowed.contains(&"Write".to_string()) && allowed.contains(&"Edit".to_string()));
    assert_eq!(allowed.iter().filter(|x| *x == "mcp__quintet__*").count(), 1, "no duplicate mcp rule");
    let denied = values_after(&a, "--disallowedTools");
    assert_eq!(denied, GLOBAL_DENYLIST.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    // Nothing positional after the last variadic flag: the task text goes on stdin.
    assert!(a.last().map(|l| GLOBAL_DENYLIST.contains(&l.as_str())).unwrap_or(false));
    assert!(!a.contains(&"--restricted".to_string()));
}

#[test]
fn level_one_strips_file_writers_and_adds_memory_rule() {
    let mut s = spec();
    s.integrity_level = Some(1);
    let allowed = effective_allowed_tools(&s);
    assert!(!allowed.iter().any(|t| t == "Write" || t == "Edit"), "{allowed:?}");
    assert!(allowed.contains(&"Edit(//HOME/Quintet/agents/research/memory.md)".to_string()), "{allowed:?}");
    assert!(allowed.contains(&"Read".to_string()));
    assert!(allowed.contains(&"WebSearch".to_string()));
    assert!(allowed.contains(&"Bash(python3:*)".to_string()));
    assert!(allowed.contains(&"mcp__quintet__*".to_string()));
    let a = strs(&build_args(&s));
    assert_eq!(value_after(&a, "--permission-mode"), "default");
    assert_eq!(value_after(&a, "--permission-prompts"), "none");
    s.integrity_level = Some(0);
    assert_eq!(value_after(&strs(&build_args(&s)), "--permission-mode"), "default");
    s.integrity_level = Some(2);
    assert_eq!(value_after(&strs(&build_args(&s)), "--permission-mode"), "acceptEdits");
    assert!(effective_allowed_tools(&s).contains(&"Write".to_string()));
    // Path-scoped Write rules from frontmatter are stripped too at level 1.
    s.integrity_level = Some(1);
    s.allowed_tools = vec!["Write(./out/*)".into(), "Edit(./x.md)".into()];
    let allowed = effective_allowed_tools(&s);
    assert_eq!(allowed, vec!["Edit(//HOME/Quintet/agents/research/memory.md)".to_string(), "Read".to_string(), "mcp__quintet__*".to_string()]);
}

#[test]
fn resume_restricted_and_no_mcp() {
    let mut s = spec();
    s.session = SessionMode::Resume("sess-1".into());
    s.mcp_config_file = None;
    s.restricted_to = vec![PathBuf::from("/HOME/Quintet")];
    let a = strs(&build_args(&s));
    assert_eq!(value_after(&a, "--resume"), "sess-1");
    assert!(!a.contains(&"--session-id".to_string()));
    assert!(!a.contains(&"--mcp-config".to_string()));
    assert!(a.contains(&"--strict-mcp-config".to_string()));
    assert!(a.contains(&"--restricted".to_string()));
    assert_eq!(value_after(&a, "--add-dir"), "/HOME/Quintet");
    let r = render(&PathBuf::from("claude"), &build_args(&s));
    assert!(r.starts_with("claude -p --output-format stream-json --verbose --resume sess-1"));
    assert!(r.contains("--setting-sources \"\""));
    assert!(r.contains("\"Bash(curl *)\""));
}

#[test]
fn mcp_config_shape() {
    let l = McpLauncher::dev(&PathBuf::from("/REPO"));
    let cfg = build_mcp_config(&l, "research", "R1", &PathBuf::from("/HOME/Quintet"), &PathBuf::from("/HOME/Quintet/outputs/research/2026-09-12-x"), &["playwright".to_string(), "nope".to_string()], &default_extra_servers());
    let q = &cfg["mcpServers"]["quintet"];
    assert_eq!(q["type"], "stdio");
    assert_eq!(q["command"], "bun");
    assert_eq!(q["args"], serde_json::json!(["/REPO/mcp/src/index.ts", "serve", "--agent", "research", "--run", "R1"]));
    assert_eq!(q["env"]["QUINTET_HOME"], "/HOME/Quintet");
    assert_eq!(q["env"]["QUINTET_OUTPUT_DIR"], "/HOME/Quintet/outputs/research/2026-09-12-x");
    assert!(cfg["mcpServers"]["playwright"].is_object());
    assert!(cfg["mcpServers"].get("nope").is_none());
    let side = McpLauncher::sidecar(&PathBuf::from("/Applications/Quintet.app/Contents/MacOS/quintet-mcp"));
    let cfg = build_mcp_config(&side, "a", "r", &PathBuf::from("/h"), &PathBuf::from("/o"), &[], &Default::default());
    assert_eq!(cfg["mcpServers"]["quintet"]["command"], "/Applications/Quintet.app/Contents/MacOS/quintet-mcp");
    assert_eq!(cfg["mcpServers"]["quintet"]["args"][0], "serve");
}
