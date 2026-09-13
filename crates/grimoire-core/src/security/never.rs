//! The things that always need a seal, whatever the autonomy level says (§6.4).
//!
//! §6.4, in full: *"Nothing is ever exempt from the seal: sending a message, sending an email,
//! deleting a file outside the workspace, `git push --force`, anything that spends money, and
//! any write to a path containing `.env`, `.ssh`, `credentials`, or `.git/config`. This list is
//! in code, not in config, and `free` does not override it."*
//!
//! **In code, not in config.** There is no way to reach this list from a binding, a setting or a
//! command line, because the point of it is that it cannot be argued with — not by a writ, not by
//! a familiar, and not by the owner in a hurry. A test asserts that `free` does not move it.

use std::path::Path;

use crate::security::action::Action;

/// Why something can never be waved through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeverExempt(pub String);

/// Path fragments that always mean a seal, wherever they appear (§6.4).
const GUARDED_FRAGMENTS: &[&str] = &[".env", ".ssh", "credentials", ".git/config"];

/// Shell verbs that destroy or publish, and the flags that make them irreversible.
const FORCE_PUSH: &[&str] = &["--force", "-f", "--force-with-lease"];

/// Whether this action is on the list, and why.
///
/// `workspace` is where the familiar is allowed to work; "outside the workspace" in §6.4 is
/// measured against it. `home` lets `~` resolve in tests without touching the real home.
pub fn check(action: &Action, workspace: &Path, home: Option<&Path>) -> Option<NeverExempt> {
    match action {
        // "sending a message, sending an email" — always.
        Action::Send { detail } => Some(NeverExempt(format!(
            "Sending anything out of this machine always needs your seal. This would {detail}."
        ))),

        Action::Write { path } => guarded_path(path, home),

        Action::Shell { command } => shell(command, workspace, home),

        // A tool nobody has taught Grimoire could be any of the above.
        Action::Unknown { tool } => Some(NeverExempt(format!(
            "Grimoire does not know what `{tool}` does, so it cannot judge it. Unrecognised \
             always needs your seal."
        ))),

        Action::Read { .. } | Action::Network { .. } => None,
    }
}

/// A write to anything whose resolved path carries a guarded fragment.
///
/// Checked on the **resolved** path, so `~/work/../.ssh/config` is caught: a fragment test on
/// the raw string would not see the `.ssh` that the path actually reaches.
fn guarded_path(raw: &str, home: Option<&Path>) -> Option<NeverExempt> {
    let resolved = super::path::resolve(raw, home);
    let text = resolved.to_string_lossy();
    let hit = GUARDED_FRAGMENTS.iter().find(|frag| {
        if **frag == ".git/config" {
            text.contains(".git/config")
        } else {
            // Match a whole path segment, so `.environment` and `my.envelope` are not caught by
            // `.env`, while `/a/.env` and `/a/.env.local` are.
            resolved.components().any(|c| {
                let s = c.as_os_str().to_string_lossy();
                s == **frag || s.starts_with(&format!("{frag}."))
            })
        }
    })?;
    Some(NeverExempt(format!(
        "This writes to {}, and anything with `{hit}` in its path always needs your seal.",
        resolved.display()
    )))
}

/// Shell commands that are on the list however free the familiar is.
///
/// **Every command in the line is checked, not just the first.** `cd repo && git push --force`
/// begins with `cd`, so a check on the first word alone sees nothing to object to — and the
/// never-exempt list can be stepped around by typing four extra characters. A test caught
/// exactly that. The line is split on the separators a shell treats as "and then", and each
/// piece is judged on its own.
fn shell(command: &str, workspace: &Path, home: Option<&Path>) -> Option<NeverExempt> {
    segments(command).into_iter().find_map(|part| one_command(&part, workspace, home))
}

/// Split a command line into the commands it actually runs.
///
/// Deliberately crude and deliberately generous: anything that might separate two commands ends
/// a segment. Over-splitting costs at worst an extra seal request; under-splitting hides a
/// command from the list entirely, which is the failure that matters.
fn segments(command: &str) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), _) if c == q => {
                quote = None;
                parts.last_mut().expect("one").push(c);
            }
            (Some(_), _) => parts.last_mut().expect("one").push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                parts.last_mut().expect("one").push(c);
            }
            // `&&`, `||`, `;`, `|`, a newline, and the two spellings of a subshell.
            (None, '&' | '|') => {
                if chars.peek() == Some(&c) {
                    chars.next();
                }
                parts.push(String::new());
            }
            (None, ';' | '\n') => parts.push(String::new()),
            (None, '(' | ')' | '`') => parts.push(String::new()),
            (None, '$') if chars.peek() == Some(&'(') => {
                chars.next();
                parts.push(String::new());
            }
            (None, _) => parts.last_mut().expect("one").push(c),
        }
    }
    parts.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

/// One command from the line, with no separators left in it.
fn one_command(command: &str, workspace: &Path, home: Option<&Path>) -> Option<NeverExempt> {
    let words = shell_words(command);
    let lower = command.to_ascii_lowercase();

    // `git push --force`, in any of its spellings.
    if words.first().map(String::as_str) == Some("git")
        && words.iter().any(|w| w == "push")
        && words.iter().any(|w| FORCE_PUSH.contains(&w.as_str()))
    {
        return Some(NeverExempt(
            "A force push rewrites history that other people may already have. It always needs \
             your seal."
                .into(),
        ));
    }

    // Deleting something outside the workspace.
    if let Some(target) = deletion_target(&words) {
        let resolved = super::path::resolve(&target, home);
        if !super::path::contains(workspace, &resolved) {
            return Some(NeverExempt(format!(
                "This deletes {}, which is outside the workspace. That always needs your seal.",
                resolved.display()
            )));
        }
    }

    // Writing to a guarded path through a shell redirect or an editor.
    for word in &words {
        if (word.contains('/') || word.starts_with('.'))
            && let Some(found) = guarded_path(word, home)
        {
            return Some(found);
        }
    }

    // "anything that spends money" is not decidable in general; what is decidable is the
    // commands that exist to pay for things. Named rather than guessed at.
    const SPENDS: &[&str] = &["stripe ", "aws ", "gcloud ", "az ", "terraform apply", "npm publish", "cargo publish"];
    if let Some(hit) = SPENDS.iter().find(|v| lower.starts_with(*v) || lower.contains(&format!("| {v}"))) {
        return Some(NeverExempt(format!(
            "`{}` can spend money or change something you pay for, so it always needs your seal.",
            hit.trim()
        )));
    }

    None
}

/// The path a deleting command is aimed at, if it is one.
fn deletion_target(words: &[String]) -> Option<String> {
    let verb = words.first()?.as_str();
    let deletes = matches!(verb, "rm" | "rmdir" | "shred" | "unlink");
    if !deletes {
        return None;
    }
    // The first argument that is not a flag.
    words.iter().skip(1).find(|w| !w.starts_with('-')).cloned()
}

/// Split a command into words, respecting quotes just enough to keep a quoted path in one piece.
fn shell_words(command: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for c in command.chars() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => current.push(c),
            (None, '\'' | '"') => quote = Some(c),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            (None, _) => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn workspace() -> PathBuf {
        PathBuf::from("/work/essays")
    }
    fn home() -> PathBuf {
        PathBuf::from("/home/someone")
    }

    fn caught(action: &Action) -> bool {
        check(action, &workspace(), Some(&home())).is_some()
    }

    #[test]
    fn sending_anything_always_needs_a_seal() {
        assert!(caught(&Action::Send { detail: "mail to someone".into() }));
    }

    #[test]
    fn every_guarded_fragment_is_caught_in_a_write() {
        for path in [
            "/work/essays/.env",
            "/work/essays/.env.local",
            "~/.ssh/id_rsa",
            "/work/essays/credentials/token.json",
            "/work/essays/repo/.git/config",
        ] {
            assert!(caught(&Action::Write { path: path.into() }), "{path} was not guarded");
        }
    }

    #[test]
    fn a_guarded_fragment_is_caught_after_the_path_is_resolved() {
        // The escape a plain substring check misses: nothing in this string says `.ssh`, but
        // that is where it lands.
        let sneaky = "/work/essays/../../home/someone/.ssh/authorized_keys";
        assert!(caught(&Action::Write { path: sneaky.into() }), "a resolved guarded path slipped through");
    }

    #[test]
    fn ordinary_names_that_merely_look_similar_are_not_caught() {
        // A rule that fires on everything is one people learn to click through.
        for path in [
            "/work/essays/environment.md",
            "/work/essays/my.envelope",
            "/work/essays/credentialing-policy.md",
            "/work/essays/.gitignore",
        ] {
            assert!(!caught(&Action::Write { path: path.into() }), "{path} was caught but is harmless");
        }
    }

    #[test]
    fn a_force_push_always_needs_a_seal_however_it_is_spelled() {
        for command in [
            "git push --force",
            "git push -f origin main",
            "git push --force-with-lease origin main",
            "cd repo && git push --force",
        ] {
            assert!(caught(&Action::Shell { command: command.into() }), "{command} was not caught");
        }
        // And an ordinary push is not on the list.
        assert!(!caught(&Action::Shell { command: "git push origin main".into() }));
    }

    #[test]
    fn deleting_outside_the_workspace_always_needs_a_seal() {
        assert!(caught(&Action::Shell { command: "rm -rf /home/someone/notes".into() }));
        assert!(caught(&Action::Shell { command: "rm ../../etc/hosts".into() }));
        // Inside the workspace it is the autonomy level's business, not this list's.
        assert!(!caught(&Action::Shell { command: "rm /work/essays/draft.md".into() }));
        assert!(!caught(&Action::Shell { command: "rm -rf /work/essays/build".into() }));
    }

    #[test]
    fn a_quoted_path_with_a_space_is_still_one_path() {
        assert!(caught(&Action::Shell { command: "rm -rf '/home/someone/my notes'".into() }));
    }

    #[test]
    fn commands_that_spend_money_always_need_a_seal() {
        for command in ["npm publish", "cargo publish --token x", "terraform apply -auto-approve"] {
            assert!(caught(&Action::Shell { command: command.into() }), "{command} was not caught");
        }
    }

    #[test]
    fn an_unrecognised_tool_always_needs_a_seal() {
        assert!(caught(&Action::Unknown { tool: "SomethingNew".into() }));
    }

    #[test]
    fn reading_is_never_on_this_list() {
        // §6.4's lowest rung still lets a familiar read and think.
        assert!(!caught(&Action::Read { path: Some("/anywhere/at/all".into()) }));
    }
}
