//! App-launch checks: `claude --version` and `claude auth status` (CLAUDE.md §3.2).

use std::path::Path;
use std::time::Duration;

use crate::runs::process::scrubbed_env;
use crate::types::Preflight;

pub async fn preflight(claude_bin: &Path) -> Preflight {
    let env = scrubbed_env(&[]);
    let run = |args: &[&str]| {
        let mut c = tokio::process::Command::new(claude_bin);
        c.args(args).env_clear().envs(&env).stdin(std::process::Stdio::null()).kill_on_drop(true);
        c.output()
    };
    let version = match tokio::time::timeout(Duration::from_secs(20), run(&["--version"])).await {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Ok(Ok(o)) => return Preflight { ok: false, cli_version: None, logged_in: false, auth_method: None, error: Some(format!("`claude --version` failed: {}", String::from_utf8_lossy(&o.stderr).trim())) },
        Ok(Err(e)) => return Preflight { ok: false, cli_version: None, logged_in: false, auth_method: None, error: Some(format!("cannot run `{}`: {e}. Install Claude Code and make sure it is on PATH.", claude_bin.display())) },
        Err(_) => return Preflight { ok: false, cli_version: None, logged_in: false, auth_method: None, error: Some("`claude --version` timed out".into()) },
    };
    match tokio::time::timeout(Duration::from_secs(30), run(&["auth", "status"])).await {
        Ok(Ok(o)) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let v: serde_json::Value = serde_json::from_str(text.trim()).unwrap_or(serde_json::Value::Null);
            let logged_in = v.get("loggedIn").and_then(|b| b.as_bool()).unwrap_or(false);
            let auth_method = v.get("authMethod").and_then(|s| s.as_str()).map(str::to_owned);
            Preflight { ok: logged_in, cli_version: Some(version), logged_in, auth_method, error: if logged_in { None } else { Some("Claude Code is not logged in. Run `claude` once in a terminal and sign in with your subscription.".into()) } }
        }
        Ok(Err(e)) => Preflight { ok: false, cli_version: Some(version), logged_in: false, auth_method: None, error: Some(format!("`claude auth status` failed: {e}")) },
        Err(_) => Preflight { ok: false, cli_version: Some(version), logged_in: false, auth_method: None, error: Some("`claude auth status` timed out".into()) },
    }
}
