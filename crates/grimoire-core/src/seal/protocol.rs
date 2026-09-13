//! What the hook and the application say to each other (§6.4, DECISIONS.md 0004).
//!
//! The hook is a separate process, spawned by the engine, with no memory and no state. It sends
//! one request and waits for one answer, both a single line of JSON on a Unix socket. Keeping
//! the wire this small is deliberate: the hook is the part that must never hang, never crash and
//! never fail open, and the less it does the easier that is to be sure of.

use serde::{Deserialize, Serialize};

/// What the engine is about to do, as the hook reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    /// The engine session, which is how the application knows whose familiar this is.
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub cwd: String,
    /// The engine's own id for this call, carried through so the ledger can refer to it.
    pub tool_use_id: Option<String>,
}

/// What the application answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "decision")]
pub enum Response {
    /// Let it happen, and say why it did not need asking.
    ///
    /// The reason is not decoration. It is what the familiar reads, and it used to say
    /// "Sealed." for everything allowed — including the ordinary case where the binding already
    /// permitted the action and nobody was ever asked. §3 is explicit that the verb on the
    /// button is the verb in the result, and nothing had been sealed.
    Allow { reason: String },
    /// Stop it. `reason` goes back to the familiar so it can adapt (§6.4: "Refuse sends the
    /// refusal back into the PTY as a message so the familiar can adapt").
    Deny { reason: String },
}

impl Response {
    pub fn deny(reason: impl Into<String>) -> Self {
        Response::Deny { reason: reason.into() }
    }

    /// The owner looked at it and sealed it.
    pub fn sealed() -> Self {
        Response::Allow { reason: "Sealed.".into() }
    }

    /// The owner sealed it and said to stop asking for the rest of this commission (§6.4).
    pub fn sealed_always() -> Self {
        Response::Allow {
            reason: "Sealed, and not asked again for this commission.".into(),
        }
    }

    /// Its binding already allowed this, so nobody was asked.
    pub fn permitted() -> Self {
        Response::Allow { reason: "Within what your binding allows.".into() }
    }
}

/// The engine's `PreToolUse` reply, which is the only shape it understands.
///
/// Built here rather than in the hook so the exact field names live beside the rest of the
/// protocol, and so a test can assert them without running a hook.
pub fn hook_reply(response: &Response) -> serde_json::Value {
    match response {
        Response::Allow { reason } => serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "permissionDecisionReason": reason
            }
        }),
        Response::Deny { reason } => serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        }),
    }
}

/// The reply to print when the application cannot be reached, or does not answer in time.
///
/// **Fail closed, by construction.** DECISIONS.md 0004 measured that the engine's own hook
/// timeout fails *open*: a hook that misses its deadline has its tool call allowed. So the hook
/// never relies on that timeout — it keeps its own, shorter one, and when it expires it prints
/// this. Unreachable is a refusal; slow is a refusal; confused is a refusal.
pub fn fail_closed(why: &str) -> serde_json::Value {
    hook_reply(&Response::deny(format!(
        "Grimoire could not put this to its owner ({why}), so it is refused. Nothing is allowed \
         through unasked."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(v: &serde_json::Value) -> &str {
        v["hookSpecificOutput"]["permissionDecision"].as_str().unwrap_or("")
    }

    #[test]
    fn the_reply_uses_the_field_names_the_engine_reads() {
        // Measured against claude 2.1.270 (DECISIONS.md 0004). A typo in any of these names is
        // not an error the engine reports — it is a hook that silently stops denying anything.
        let v = hook_reply(&Response::deny("no"));
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert_eq!(decision(&v), "deny");
        assert_eq!(v["hookSpecificOutput"]["permissionDecisionReason"], "no");

        assert_eq!(decision(&hook_reply(&Response::sealed())), "allow");
    }

    #[test]
    fn an_allow_says_which_kind_of_allow_it_was() {
        // §3: the verb on the button is the verb in the result. Every allow used to report
        // "Sealed.", including the ordinary case where the binding already permitted the action
        // and the owner was never asked — so the familiar was told a seal had happened when
        // none had. Three different things happened; they read as three different things.
        let reason = |r: &Response| {
            hook_reply(r)["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap().to_string()
        };
        assert_eq!(reason(&Response::sealed()), "Sealed.");
        assert!(reason(&Response::sealed_always()).contains("not asked again"));

        let permitted = reason(&Response::permitted());
        assert!(permitted.contains("binding"), "{permitted}");
        assert!(!permitted.contains("Sealed"), "nothing was sealed: {permitted}");
    }

    #[test]
    fn every_way_of_failing_produces_a_denial() {
        // The one property the hook exists to have.
        for why in ["the application is not running", "it took too long", "a broken answer"] {
            assert_eq!(decision(&fail_closed(why)), "deny", "{why} did not fail closed");
        }
    }

    #[test]
    fn a_failure_says_why_rather_than_leaving_the_familiar_guessing() {
        let v = fail_closed("the application is not running");
        let reason = v["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap();
        assert!(reason.contains("the application is not running"), "{reason}");
        assert!(reason.contains("refused"), "{reason}");
    }

    #[test]
    fn the_wire_round_trips() {
        let request = Request {
            session_id: "s".into(),
            tool_name: "Write".into(),
            tool_input: serde_json::json!({ "file_path": "/tmp/a" }),
            cwd: "/tmp".into(),
            tool_use_id: Some("t".into()),
        };
        let line = serde_json::to_string(&request).expect("encode");
        assert_eq!(serde_json::from_str::<Request>(&line).expect("decode"), request);

        for response in [Response::sealed(), Response::permitted(), Response::deny("because")] {
            let line = serde_json::to_string(&response).expect("encode");
            assert_eq!(serde_json::from_str::<Response>(&line).expect("decode"), response);
        }
    }
}
