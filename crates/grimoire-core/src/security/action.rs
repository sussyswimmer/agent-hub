//! What a familiar is about to do, as the seal understands it (§6.4).
//!
//! The engine speaks in its own tool names; Grimoire judges in terms of what those tools *do*.
//! Mapping one to the other happens here, once, so the decision logic never has to know that
//! `NotebookEdit` is a write or that `WebFetch` reaches the network.
//!
//! **An unrecognised tool is treated as dangerous, not as harmless.** A new tool in a later
//! release of the engine must not walk past a gate that only knows last year's names.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What kind of thing is about to happen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "kind")]
#[ts(export)]
pub enum Action {
    /// Reading, thinking, searching the filesystem. Never sealed: §6.4's lowest rung still lets
    /// a familiar "read and think".
    Read { path: Option<String> },
    Write { path: String },
    Shell { command: String },
    Network { url: Option<String> },
    /// A tool whose name says it sends something outward — mail, a message, a post.
    Send { detail: String },
    /// A tool Grimoire does not recognise. Sealed, always.
    Unknown { tool: String },
}

impl Action {
    /// A short line naming exactly what and where, for the seal request (§6.4: "the exact action,
    /// and the exact target path or command").
    pub fn describe(&self) -> String {
        match self {
            Action::Read { path: Some(p) } => format!("read {p}"),
            Action::Read { path: None } => "read".into(),
            Action::Write { path } => format!("write to {path}"),
            Action::Shell { command } => format!("run `{command}`"),
            Action::Network { url: Some(u) } => format!("fetch {u}"),
            Action::Network { url: None } => "reach the network".into(),
            Action::Send { detail } => format!("send: {detail}"),
            Action::Unknown { tool } => format!("use {tool}, which Grimoire does not recognise"),
        }
    }

    /// The path this action touches, when it touches one.
    pub fn path(&self) -> Option<&str> {
        match self {
            Action::Write { path } => Some(path),
            Action::Read { path } => path.as_deref(),
            _ => None,
        }
    }
}

/// Turn one engine tool call into an action.
///
/// `tool` is the engine's name for it; `input` is the tool's own arguments, as the hook received
/// them.
pub fn from_tool(tool: &str, input: &serde_json::Value) -> Action {
    let s = |key: &str| input.get(key).and_then(|v| v.as_str()).map(str::to_string);

    match tool {
        // Reading and searching. The one family that is never sealed.
        "Read" | "Glob" | "Grep" | "NotebookRead" | "TodoWrite" => {
            Action::Read { path: s("file_path").or_else(|| s("path")).or_else(|| s("pattern")) }
        }

        "Write" | "Edit" | "MultiEdit" => {
            Action::Write { path: s("file_path").unwrap_or_default() }
        }
        "NotebookEdit" => Action::Write { path: s("notebook_path").unwrap_or_default() },

        "Bash" | "BashOutput" | "KillShell" => {
            Action::Shell { command: s("command").unwrap_or_default() }
        }

        "WebFetch" => Action::Network { url: s("url") },
        "WebSearch" => Action::Network { url: s("query") },

        other => classify_unfamiliar(other, input),
    }
}

/// Anything not in the table above.
///
/// Tool servers name their tools, and the names are the only thing there is to go on. A name
/// that begins with a verb of sending is treated as a send; everything else is unknown, and
/// unknown means sealed. Erring the other way — assuming a strange tool is harmless — is how a
/// gate quietly stops being one.
fn classify_unfamiliar(tool: &str, input: &serde_json::Value) -> Action {
    let lower = tool.to_ascii_lowercase();
    // Strip an MCP prefix so `mcp__gmail__send_message` is judged on `send_message`.
    let bare = lower.rsplit("__").next().unwrap_or(&lower);

    const SENDING: &[&str] = &["send", "post", "email", "mail", "publish", "sms", "notify", "tweet"];
    if SENDING.iter().any(|v| bare.starts_with(v) || bare.contains(&format!("_{v}"))) {
        let detail = input
            .as_object()
            .and_then(|o| o.get("to").or_else(|| o.get("recipient")).or_else(|| o.get("channel")))
            .and_then(|v| v.as_str())
            .map(|to| format!("{tool} to {to}"))
            .unwrap_or_else(|| tool.to_string());
        return Action::Send { detail };
    }

    Action::Unknown { tool: tool.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_writing_tools_are_all_writes_with_their_path() {
        for (tool, key) in [("Write", "file_path"), ("Edit", "file_path"), ("NotebookEdit", "notebook_path")] {
            let a = from_tool(tool, &json!({ key: "/work/essay.md" }));
            assert_eq!(a, Action::Write { path: "/work/essay.md".into() }, "{tool}");
        }
    }

    #[test]
    fn reading_tools_are_reads_and_carry_what_they_read() {
        assert_eq!(
            from_tool("Read", &json!({ "file_path": "/work/essay.md" })),
            Action::Read { path: Some("/work/essay.md".into()) }
        );
        assert!(matches!(from_tool("Grep", &json!({ "pattern": "todo" })), Action::Read { .. }));
    }

    #[test]
    fn bash_carries_the_exact_command() {
        assert_eq!(
            from_tool("Bash", &json!({ "command": "git status" })),
            Action::Shell { command: "git status".into() }
        );
    }

    #[test]
    fn an_unrecognised_tool_is_unknown_rather_than_assumed_safe() {
        // The property that matters as the engine grows new tools: a name nobody has taught
        // Grimoire must not walk through the gate.
        let a = from_tool("SomeToolFromNextYear", &json!({}));
        assert_eq!(a, Action::Unknown { tool: "SomeToolFromNextYear".into() });
    }

    #[test]
    fn a_tool_whose_name_says_it_sends_is_a_send() {
        // §6.4's never-exempt list starts with "sending a message, sending an email".
        for tool in [
            "mcp__gmail__send_message",
            "mcp__slack__post_message",
            "send_email",
            "mcp__x__tweet",
        ] {
            assert!(
                matches!(from_tool(tool, &json!({})), Action::Send { .. }),
                "{tool} was not recognised as sending"
            );
        }
    }

    #[test]
    fn a_send_names_its_recipient_where_there_is_one() {
        let a = from_tool("mcp__gmail__send_message", &json!({ "to": "someone@example.com" }));
        assert_eq!(a.describe(), "send: mcp__gmail__send_message to someone@example.com");
    }

    #[test]
    fn every_action_can_say_exactly_what_it_is() {
        // §6.4: the request shows "the exact action, and the exact target path or command".
        assert!(Action::Write { path: "/work/a.md".into() }.describe().contains("/work/a.md"));
        assert!(Action::Shell { command: "rm -rf /".into() }.describe().contains("rm -rf /"));
        assert!(
            Action::Network { url: Some("https://example.com".into()) }
                .describe()
                .contains("https://example.com")
        );
    }
}
