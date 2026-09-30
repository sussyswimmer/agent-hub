//! Reading what a run actually cost, from the engine's own transcript (§6.5, §6.9).
//!
//! §6.5 asks for tokens "parsed from the CLI's own reporting where it emits it, wall-clock
//! otherwise". For an interactive engine the obvious place to look is the terminal, and it is
//! the wrong one: the numbers there are drawn with cursor-positioning escapes, reflowed on every
//! resize, and rewritten in place as a turn progresses. Scraping that would be a guess dressed
//! up as a measurement.
//!
//! `claude` writes a JSONL transcript per session instead, one line per message, each assistant
//! line carrying a `usage` object with exact counts. Grimoire names the session itself with
//! `--session-id`, so it knows precisely which file is its own rather than having to guess from
//! timestamps. That is a real number, from the engine, with no parsing of anything drawn.
//!
//! When the file is not there — a different engine, an older CLI, a session that never started —
//! nothing is reported. An absent number is honest; a fabricated one is not.

use std::path::{Path, PathBuf};

use crate::ledger::Tokens;

/// What one session has used so far.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Usage {
    pub tokens: Tokens,
    /// Assistant messages, which is what §6.5 means by a turn.
    pub turns: i64,
}

impl Usage {
    /// What a session has used since `earlier`, a reading taken from the same session.
    ///
    /// A familiar that stays summoned can take one commission after another in the same engine
    /// session, and the transcript counts the whole session. Each commission is metered from a
    /// reading taken when it was handed over, so the second is not charged for the first (§6.5
    /// budgets a commission, not a summoning).
    pub fn since(self, earlier: Usage) -> Usage {
        Usage { tokens: self.tokens.since(earlier.tokens), turns: (self.turns - earlier.turns).max(0) }
    }
}

/// Where `claude` keeps its transcripts. One directory per working directory, named after it.
fn projects_dir() -> Option<PathBuf> {
    std::env::home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Find the transcript for a session id.
///
/// Searched by name across the project directories rather than derived from the working
/// directory: the slug rule is the engine's business and could change, while the file is always
/// `<session-id>.jsonl`. One shallow scan, and it cannot drift.
pub fn transcript_for(session_id: &str) -> Option<PathBuf> {
    let projects = projects_dir()?;
    let wanted = format!("{session_id}.jsonl");
    for entry in std::fs::read_dir(projects).ok()?.flatten() {
        let candidate = entry.path().join(&wanted);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Total the usage in a transcript.
///
/// Reads the whole file each time. These are a few hundred lines even for a long session, and a
/// total that is always right is worth more than an incremental read that can drift after a
/// resume or a compaction.
pub fn read_transcript(path: &Path) -> Usage {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Usage::default();
    };

    let mut usage = Usage::default();
    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // A half-written last line is normal while a run is live.
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(u) = value.get("message").and_then(|m| m.get("usage")) else {
            continue;
        };

        let n = |key: &str| u.get(key).and_then(|v| v.as_i64()).unwrap_or(0);
        usage.tokens = usage.tokens.plus(Tokens {
            input: n("input_tokens"),
            output: n("output_tokens"),
            cache_read: n("cache_read_input_tokens"),
            cache_write: n("cache_creation_input_tokens"),
        });
        usage.turns += 1;
    }
    usage
}

/// Usage for a session, or nothing if its transcript cannot be found.
pub fn for_session(session_id: &str) -> Option<Usage> {
    let path = transcript_for(session_id)?;
    Some(read_transcript(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINES: &str = r#"{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}
{"type":"system","subtype":"init"}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":2,"output_tokens":8,"cache_read_input_tokens":50,"cache_creation_input_tokens":0}}}
"#;

    fn write(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).expect("write");
        p
    }

    #[test]
    fn a_later_commission_is_metered_from_its_own_start() {
        let tmp = tempfile::tempdir().expect("tmp");
        let whole = read_transcript(&write(tmp.path(), "s.jsonl", LINES));
        let first_turn_only = Usage {
            tokens: Tokens { input: 10, output: 20, cache_read: 100, cache_write: 5 },
            turns: 1,
        };
        let second = whole.since(first_turn_only);
        assert_eq!(second.turns, 1);
        assert_eq!(second.tokens, Tokens { input: 2, output: 8, cache_read: 50, cache_write: 0 });
        assert_eq!(Usage::default().since(whole), Usage::default(), "a shorter reading is not a refund");
    }

    #[test]
    fn every_assistant_turn_is_counted_once() {
        let tmp = tempfile::tempdir().expect("tmp");
        let usage = read_transcript(&write(tmp.path(), "s.jsonl", LINES));

        assert_eq!(usage.turns, 2, "user and system lines are not turns");
        assert_eq!(usage.tokens.input, 12);
        assert_eq!(usage.tokens.output, 28);
        assert_eq!(usage.tokens.cache_read, 150);
        assert_eq!(usage.tokens.cache_write, 5);
        assert_eq!(usage.tokens.total(), 195);
    }

    #[test]
    fn a_half_written_last_line_does_not_lose_the_rest() {
        // The file is being appended to while a run is live, so a truncated final line is the
        // normal case rather than corruption.
        let tmp = tempfile::tempdir().expect("tmp");
        let usage = read_transcript(&write(tmp.path(), "s.jsonl", &format!("{LINES}{{\"type\":\"assis")));
        assert_eq!(usage.turns, 2);
        assert_eq!(usage.tokens.total(), 195);
    }

    #[test]
    fn a_missing_transcript_reports_nothing_rather_than_guessing() {
        let usage = read_transcript(Path::new("/nonexistent/none.jsonl"));
        assert_eq!(usage, Usage::default());
        assert_eq!(usage.tokens.total(), 0);
    }

    #[test]
    fn a_message_with_no_usage_block_is_skipped_not_counted_as_zero() {
        let tmp = tempfile::tempdir().expect("tmp");
        let body = "{\"type\":\"assistant\",\"message\":{\"model\":\"m\"}}\n";
        assert_eq!(read_transcript(&write(tmp.path(), "s.jsonl", body)).turns, 0);
    }
}
