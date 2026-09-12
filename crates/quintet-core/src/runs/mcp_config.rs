//! Per-run `--mcp-config` JSON (CLAUDE.md §6, ADR-0005).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// How to start `quintet-mcp`: dev = `bun <repo>/mcp/src/index.ts`, prod = the compiled sidecar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLauncher {
    pub command: PathBuf,
    pub prefix_args: Vec<String>,
}

impl McpLauncher {
    pub fn dev(repo_root: &Path) -> Self {
        Self { command: PathBuf::from("bun"), prefix_args: vec![repo_root.join("mcp").join("src").join("index.ts").display().to_string()] }
    }
    pub fn sidecar(binary: &Path) -> Self {
        Self { command: binary.to_path_buf(), prefix_args: vec![] }
    }
}

/// Known `mcp_extra` names → server config. Unknown names are skipped with a warning.
pub fn default_extra_servers() -> BTreeMap<String, Value> {
    let mut m = BTreeMap::new();
    m.insert("playwright".to_string(), json!({"type": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--headless"]}));
    m
}

pub fn build_mcp_config(launcher: &McpLauncher, agent_id: &str, run_id: &str, home: &Path, output_dir: &Path, extra: &[String], extra_table: &BTreeMap<String, Value>) -> Value {
    let mut args: Vec<Value> = launcher.prefix_args.iter().map(|s| Value::String(s.clone())).collect();
    for s in ["serve", "--agent", agent_id, "--run", run_id] { args.push(Value::String(s.to_string())); }
    let mut servers = serde_json::Map::new();
    servers.insert("quintet".to_string(), json!({
        "type": "stdio",
        "command": launcher.command.display().to_string(),
        "args": args,
        "env": {
            "QUINTET_HOME": home.display().to_string(),
            "QUINTET_OUTPUT_DIR": output_dir.display().to_string(),
            "QUINTET_RUN_ID": run_id,
            "QUINTET_AGENT_ID": agent_id
        }
    }));
    for name in extra {
        match extra_table.get(name) {
            Some(cfg) => { servers.insert(name.clone(), cfg.clone()); }
            None => tracing::warn!(agent = agent_id, "unknown mcp_extra `{name}` skipped"),
        }
    }
    json!({ "mcpServers": servers })
}
