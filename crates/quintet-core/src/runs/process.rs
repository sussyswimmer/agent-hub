//! Spawning `claude` in its own process group and killing it gracefully (SIGINT → grace → SIGKILL).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};

/// Environment for a child run: the parent's env minus every Claude Code / remote-session variable.
pub fn scrubbed_env(extra: &[(String, String)]) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars()
        .filter(|(k, _)| !(k == "CLAUDECODE" || k.starts_with("CLAUDE_") || k.starts_with("SESSION_INGRESS")))
        .collect();
    for (k, v) in extra { env.insert(k.clone(), v.clone()); }
    env
}

pub struct Spawned {
    pub child: Child,
    pub pid: u32,
}

pub async fn spawn(bin: &Path, args: &[OsString], cwd: &Path, env: &HashMap<String, String>, stdin_text: &str) -> std::io::Result<Spawned> {
    let mut cmd = Command::new(bin);
    cmd.args(args).current_dir(cwd).env_clear().envs(env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    let mut child = cmd.spawn()?;
    let pid = child.id().unwrap_or(0);
    if let Some(mut stdin) = child.stdin.take() {
        let text = stdin_text.to_owned();
        tokio::spawn(async move {
            let _ = stdin.write_all(text.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }
    Ok(Spawned { child, pid })
}

#[cfg(unix)]
fn signal_group(pid: u32, sig: i32) {
    if pid == 0 { return; }
    // Negative pid = the whole process group (the child called setpgid via process_group(0)).
    unsafe {
        if libc::kill(-(pid as i32), sig) != 0 {
            libc::kill(pid as i32, sig);
        }
    }
}

/// SIGINT (the CLI ends the turn cleanly), wait `grace`, then SIGKILL the group.
pub async fn kill_gracefully(child: &mut Child, pid: u32, grace: Duration) {
    #[cfg(unix)]
    {
        signal_group(pid, libc::SIGINT);
        if tokio::time::timeout(grace, child.wait()).await.is_ok() {
            // The leader exited cleanly; reap anything it left behind in the group.
            signal_group(pid, libc::SIGKILL);
            return;
        }
        signal_group(pid, libc::SIGKILL);
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

/// Is a process with this pid alive (best effort, unix only)?
pub fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        if pid == 0 { return false; }
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    { let _ = pid; false }
}

/// Does the pid look like a `claude` process? Linux reads /proc; elsewhere we trust `pid_alive`.
pub fn pid_is_claude(pid: u32) -> bool {
    if let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) {
        return cmdline.split(|b| *b == 0).next().map(|first| String::from_utf8_lossy(first).contains("claude")).unwrap_or(false);
    }
    pid_alive(pid)
}

#[cfg(unix)]
pub fn terminate_pid(pid: u32) { signal_group(pid, libc::SIGTERM); }

/// Kill every process still in the child's group (orphaned Bash children after the CLI exited).
#[cfg(unix)]
pub fn kill_stragglers(pid: u32) { signal_group(pid, libc::SIGKILL); }
#[cfg(not(unix))]
pub fn kill_stragglers(_pid: u32) {}
#[cfg(not(unix))]
pub fn terminate_pid(_pid: u32) {}
