//! The hook: the small process the engine runs before every tool call (§6.4, DECISIONS.md 0004).
//!
//! The engine spawns this, hands it a JSON description of what it is about to do, and obeys what
//! it prints. It is the only place in Grimoire that sits between a familiar and an action, which
//! is why §11 can say the Rust layer is the law: a writ telling the familiar to ignore the seal
//! never reaches here, because this is not part of the conversation.
//!
//! **Everything about this file is arranged around failing closed.** The engine's own hook
//! timeout was measured to fail *open* — a hook that misses it has its tool call allowed — so
//! this never relies on it. It keeps its own deadline, well inside whatever the engine is
//! configured to wait, and denies the moment anything is not going to plan: no socket, no
//! answer, a slow answer, an answer it cannot read.

use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::seal::protocol::{Request, Response, fail_closed, hook_reply};

/// How long the hook will wait for the owner before refusing on their behalf.
///
/// §6.4 gives seal requests thirty minutes before they time out into `bind`, so the hook waits a
/// little past that and then refuses. The engine's own timeout must be configured longer still,
/// or it would expire first — and its expiry is the one that fails open.
pub const HOOK_DEADLINE: Duration = Duration::from_secs(31 * 60);

/// How long to wait just to reach the application. Short: either it is listening or it is not.
const CONNECT_DEADLINE: Duration = Duration::from_secs(5);

/// Read the engine's payload, ask the application, and print the engine's answer.
///
/// Returns the JSON to print. Never returns an error: there is no failure here that should
/// result in anything other than a denial.
pub fn run(socket: &Path, stdin: &mut impl Read) -> serde_json::Value {
    let mut payload = String::new();
    if let Err(e) = stdin.read_to_string(&mut payload) {
        return fail_closed(&format!("the request could not be read: {e}"));
    }

    let request = match parse(&payload) {
        Ok(r) => r,
        Err(e) => return fail_closed(&e),
    };

    match ask(socket, &request) {
        Ok(response) => hook_reply(&response),
        Err(why) => fail_closed(&why),
    }
}

/// Pull the fields Grimoire needs out of the engine's `PreToolUse` payload.
fn parse(payload: &str) -> Result<Request, String> {
    let v: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("the request was not readable JSON: {e}"))?;
    let s = |key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);

    let tool_name = s("tool_name").ok_or("the request named no tool")?;
    Ok(Request {
        session_id: s("session_id").unwrap_or_default(),
        tool_name,
        tool_input: v.get("tool_input").cloned().unwrap_or(serde_json::Value::Null),
        cwd: s("cwd").unwrap_or_default(),
        tool_use_id: s("tool_use_id"),
    })
}

/// Put the request to the application and wait for its answer.
#[cfg(unix)]
fn ask(socket: &Path, request: &Request) -> Result<Response, String> {
    let mut stream = UnixStream::connect(socket)
        .map_err(|e| format!("Grimoire is not listening on {}: {e}", socket.display()))?;

    stream
        .set_write_timeout(Some(CONNECT_DEADLINE))
        .and_then(|_| stream.set_read_timeout(Some(HOOK_DEADLINE)))
        .map_err(|e| format!("the connection could not be given a deadline: {e}"))?;

    let mut line = serde_json::to_string(request).map_err(|e| format!("the request could not be encoded: {e}"))?;
    line.push('\n');
    stream.write_all(line.as_bytes()).map_err(|e| format!("the request could not be sent: {e}"))?;
    stream.flush().map_err(|e| format!("the request could not be sent: {e}"))?;

    let mut reply = String::new();
    BufReader::new(&stream)
        .read_line(&mut reply)
        .map_err(|e| format!("no answer came back: {e}"))?;

    if reply.trim().is_empty() {
        // The socket closed without a decision — the application quit mid-question, most likely.
        return Err("the answer was empty".into());
    }
    serde_json::from_str(reply.trim()).map_err(|e| format!("the answer could not be read: {e}"))
}

#[cfg(not(unix))]
fn ask(_socket: &Path, _request: &Request) -> Result<Response, String> {
    Err("seal hooks require Unix sockets and are not yet available on Windows".into())
}

/// The settings file that installs this hook for one summoning.
///
/// Written per summoning and passed with `--settings`, so the hook is configuration outside the
/// conversation: there is no prompt, no tool argument and no writ that can reach it.
///
/// The engine-side timeout is deliberately far longer than [`HOOK_DEADLINE`]. Whichever deadline
/// expires first decides, and the engine's failure mode is to allow — so it must never be the
/// one that goes first.
pub fn settings_json(hook_command: &str) -> serde_json::Value {
    serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "*",
                "hooks": [{
                    "type": "command",
                    "command": hook_command,
                    "timeout": HOOK_DEADLINE.as_secs() + 600,
                }]
            }]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(v: &serde_json::Value) -> String {
        v["hookSpecificOutput"]["permissionDecision"].as_str().unwrap_or("").to_string()
    }

    const PAYLOAD: &str = r#"{"session_id":"abc","cwd":"/work","hook_event_name":"PreToolUse",
        "tool_name":"Write","tool_input":{"file_path":"/work/a.md","content":"hi"},
        "tool_use_id":"toolu_1"}"#;

    #[test]
    fn the_engines_payload_is_read_into_a_request() {
        let r = parse(PAYLOAD).expect("parse");
        assert_eq!(r.tool_name, "Write");
        assert_eq!(r.session_id, "abc");
        assert_eq!(r.cwd, "/work");
        assert_eq!(r.tool_input["file_path"], "/work/a.md");
        assert_eq!(r.tool_use_id.as_deref(), Some("toolu_1"));
    }

    #[test]
    fn a_payload_with_no_tool_is_refused_rather_than_guessed_at() {
        assert!(parse(r#"{"session_id":"abc"}"#).is_err());
    }

    #[test]
    fn there_is_no_socket_so_the_answer_is_deny() {
        // The most likely failure in practice: the engine is running and Grimoire is not.
        let out = run(Path::new("/nonexistent/seal.sock"), &mut PAYLOAD.as_bytes());
        assert_eq!(decision(&out), "deny");
    }

    #[test]
    fn rubbish_on_stdin_is_deny_not_a_crash() {
        // A hook that panics prints nothing, and a hook that prints nothing is one the engine
        // treats as having no opinion.
        for payload in ["", "not json at all", "{}", "[1,2,3]", "null"] {
            let out = run(Path::new("/nonexistent/seal.sock"), &mut payload.as_bytes());
            assert_eq!(decision(&out), "deny", "payload {payload:?} did not fail closed");
        }
    }

    #[test]
    fn the_hooks_own_deadline_is_well_inside_the_engines() {
        // The whole fail-closed design rests on this ordering. If the engine's timeout expired
        // first its failure mode would take over, and that one allows.
        let settings = settings_json("/path/to/grimoire seal-hook");
        let engine = settings["hooks"]["PreToolUse"][0]["hooks"][0]["timeout"].as_u64().expect("timeout");
        assert!(
            engine > HOOK_DEADLINE.as_secs(),
            "the engine would time out first ({engine}s) and its timeout fails open"
        );
    }

    #[test]
    fn the_hook_is_installed_for_every_tool_not_a_chosen_few() {
        // A matcher listing the tools we happen to know would let a new one straight past.
        let settings = settings_json("grimoire seal-hook");
        assert_eq!(settings["hooks"]["PreToolUse"][0]["matcher"], "*");
    }
}
