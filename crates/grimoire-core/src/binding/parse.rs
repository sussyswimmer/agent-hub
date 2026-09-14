//! Turning a `.binding.md` file into a familiar (§4).
//!
//! Two rules from §4 drive the whole design:
//!
//! * **A binding that fails validation is never silently dropped and never half-loaded.** It
//!   comes back as a [`Binding`] carrying the error, so the rail can show it in oxblood with the
//!   reason inline. Losing a familiar because of a typo would be worse than showing a broken one.
//! * **An unknown key is a warning, not an error.** Which means the frontmatter is read twice:
//!   once into the schema, once into a plain map, and the leftovers become warnings.
//!
//! The body after the frontmatter is the **writ**, and it is passed through verbatim. Nothing
//! templates it, nothing injects into it; the only substitution is `{{intake.*}}`, and that
//! happens later, when a commission actually has answers.

use std::path::{Path, PathBuf};

use crate::binding::schema::{
    BindingFrontmatter, KNOWN_AETHER_KEYS, KNOWN_BOUNDS_KEYS, KNOWN_INTAKE_KEYS, KNOWN_KEYS,
};

/// A binding as read from disk: either a familiar, or the reason it is not one.
#[derive(Debug, Clone, PartialEq)]
pub struct Binding {
    /// Slug of the file name, minus `.binding.md`. Stable even when the binding is broken, so a
    /// familiar keeps its place in the rail while its file is being edited.
    pub id: String,
    pub path: PathBuf,
    /// `None` when the frontmatter did not validate.
    pub front: Option<BindingFrontmatter>,
    /// The prose after the frontmatter, verbatim.
    pub writ: String,
    /// Why this is not a familiar. Shown inline in oxblood (§4).
    pub error: Option<String>,
    /// Non-fatal complaints, chiefly unknown keys.
    pub warnings: Vec<String>,
}

impl Binding {
    /// The name to show. Falls back to the id so a broken binding still has a label.
    pub fn display_name(&self) -> String {
        self.front.as_ref().map(|f| f.name.clone()).unwrap_or_else(|| self.id.clone())
    }

    pub fn is_valid(&self) -> bool {
        self.error.is_none() && self.front.is_some()
    }
}

/// Whether a path is a binding. Anything else in the folder is ignored rather than complained
/// about: people keep notes and backups next to their files.
pub fn is_binding_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".binding.md") && !n.starts_with('.'))
}

/// The id for a binding file: `vellum.binding.md` → `vellum`.
pub fn id_for(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_suffix(".binding.md"))
        .unwrap_or("unnamed")
        .to_string()
}

/// Read and parse one binding. Errors become a [`Binding`] carrying the message, never a `Err`,
/// because every file in the folder has to end up somewhere the user can see it.
pub fn load(path: &Path) -> Binding {
    let id = id_for(path);
    match std::fs::read_to_string(path) {
        Ok(text) => parse(&id, path, &text),
        Err(e) => Binding {
            id,
            path: path.to_path_buf(),
            front: None,
            writ: String::new(),
            error: Some(format!("Could not read this file: {e}")),
            warnings: vec![],
        },
    }
}

/// Split the frontmatter from the writ and validate the former.
pub fn parse(id: &str, path: &Path, text: &str) -> Binding {
    let broken = |msg: String| Binding {
        id: id.to_string(),
        path: path.to_path_buf(),
        front: None,
        writ: String::new(),
        error: Some(msg),
        warnings: vec![],
    };

    let Some((yaml, writ)) = split_frontmatter(text) else {
        return broken(
            "This file has no YAML frontmatter. A binding starts with `---` on its own first \
             line, and closes with another `---` before the writ."
                .into(),
        );
    };

    let front: BindingFrontmatter = match serde_yaml_ng::from_str(&yaml) {
        Ok(f) => f,
        Err(e) => return broken(friendly_yaml_error(&e.to_string())),
    };

    if front.archivist && front.autonomy == crate::types::Autonomy::Free {
        return broken(
            "An archivist cannot use `autonomy: free`. Set it to `propose` or `bounded`; every commission it proposes must reach the seal queue."
                .into(),
        );
    }

    let mut warnings = unknown_keys(&yaml);
    warnings.extend(quibbles(&front));

    Binding {
        id: id.to_string(),
        path: path.to_path_buf(),
        front: Some(front),
        writ,
        error: None,
        warnings,
    }
}

/// Split `---\n…\n---\n` off the front. Returns the YAML and everything after it.
///
/// Tolerates a leading byte-order mark and `\r\n`, because a file that came through an editor on
/// another platform should not be a parse error.
fn split_frontmatter(text: &str) -> Option<(String, String)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let text = text.replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n")?;
    // The closing fence is a line that is exactly `---`.
    let end = rest
        .match_indices("\n---")
        .find(|(i, _)| {
            let after = &rest[i + 4..];
            after.is_empty() || after.starts_with('\n')
        })
        .map(|(i, _)| i)?;
    let yaml = rest[..end].to_string();
    let writ = rest[end + 4..].trim_start_matches('\n').to_string();
    Some((yaml, writ))
}

/// Every key in the frontmatter that the schema does not know about (§4: a warning, not an
/// error). Walks the nested maps too, so a typo inside `bounds` is caught rather than ignored.
fn unknown_keys(yaml: &str) -> Vec<String> {
    let Ok(value) = serde_yaml_ng::from_str::<serde_yaml_ng::Value>(yaml) else {
        return vec![];
    };
    let Some(map) = value.as_mapping() else { return vec![] };

    let mut out = Vec::new();
    let check = |m: &serde_yaml_ng::Mapping, known: &[&str], where_: &str, out: &mut Vec<String>| {
        for k in m.keys().filter_map(|k| k.as_str()) {
            if !known.contains(&k) {
                out.push(match where_ {
                    "" => format!("`{k}` is not something a binding understands, so it is ignored."),
                    w => format!("`{k}` is not something `{w}` understands, so it is ignored."),
                });
            }
        }
    };

    check(map, KNOWN_KEYS, "", &mut out);
    if let Some(m) = map.get("bounds").and_then(|v| v.as_mapping()) {
        check(m, KNOWN_BOUNDS_KEYS, "bounds", &mut out);
    }
    if let Some(m) = map.get("aether").and_then(|v| v.as_mapping()) {
        check(m, KNOWN_AETHER_KEYS, "aether", &mut out);
    }
    if let Some(seq) = map.get("intake").and_then(|v| v.as_sequence()) {
        for item in seq {
            if let Some(m) = item.as_mapping() {
                check(m, KNOWN_INTAKE_KEYS, "intake", &mut out);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Things that parse but will not do what the author meant. Warnings, because the binding is
/// still usable and the author is the only person who can decide.
fn quibbles(front: &BindingFrontmatter) -> Vec<String> {
    let mut out = Vec::new();

    for field in &front.intake {
        if field.kind == crate::binding::schema::IntakeKind::Select && field.options.is_empty() {
            out.push(format!(
                "The intake question `{}` is a select with no options, so there is nothing to pick.",
                field.id
            ));
        }
    }

    // `bounds` is only read at `autonomy: bounded` (§6.4). Setting it at another level looks
    // like protection that is not there, which is the most dangerous kind of misunderstanding.
    let has_bounds = !front.bounds.write.is_empty()
        || !front.bounds.deny.is_empty()
        || !front.bounds.shell.is_empty();
    if has_bounds && front.autonomy != crate::types::Autonomy::Bounded {
        out.push(format!(
            "`bounds` is only read when `autonomy: bounded`, and this binding is `{}`, so those \
             lists do nothing here.",
            serde_yaml_ng::to_string(&front.autonomy).unwrap_or_default().trim()
        ));
    }

    if let Some(t) = front.aether.tokens
        && t <= 0
    {
        out.push("`aether.tokens` is zero or less, which stops the commission immediately. \
                  Remove the line to leave it unmetered."
            .into());
    }

    out
}

/// serde_yaml's messages are accurate and unwelcoming. §3 asks errors to say what happened and
/// what to do, so the common ones get a sentence a person can act on.
fn friendly_yaml_error(raw: &str) -> String {
    // serde_yaml puts the position on the end of the message. Take it off before rewriting the
    // rest, or it ends up in the middle of a sentence *and* again at the end — which is exactly
    // what the first version did: "Use one of: `ledger` at line 2 column 8. (line 2 column 8)".
    let (body, at) = match raw.rfind(" at line ") {
        // `+ 4` steps over " at " so the parenthetical reads "(line 2 column 8)".
        Some(i) => (&raw[..i], format!(" ({})", &raw[i + 4..])),
        None => (raw, String::new()),
    };

    if let Some(field) = body.strip_prefix("missing field `").and_then(|s| s.split('`').next()) {
        return format!(
            "This binding has no `{field}`, and a familiar needs one. Add it to the frontmatter."
        );
    }

    if body.contains("unknown variant") {
        let got = body
            .split("unknown variant `")
            .nth(1)
            .and_then(|s| s.split('`').next())
            .unwrap_or("that");
        let allowed = body
            .split("expected one of ")
            .nth(1)
            .map(|s| s.trim_end_matches('.').trim())
            .unwrap_or_default();
        return if allowed.is_empty() {
            format!("`{got}` is not a value Grimoire knows.{at}")
        } else {
            format!("`{got}` is not a value Grimoire knows. Use one of: {allowed}.{at}")
        };
    }

    if body.contains("invalid type") {
        return format!("A value in the frontmatter is the wrong kind of thing.{at} {body}.");
    }

    format!("The frontmatter could not be read. {body}.{at}")
}

#[cfg(test)]
mod tests {
    use super::friendly_yaml_error;

    /// The position must appear once, at the end, and never inside the advice.
    fn position_count(s: &str) -> usize {
        s.matches("line 2").count()
    }

    #[test]
    fn an_unknown_value_names_what_is_allowed_and_says_where_once() {
        let raw = "unknown variant `brass`, expected one of `quill`, `lantern`, `crucible`, \
                   `compass`, `ledger` at line 2 column 8";
        let out = friendly_yaml_error(raw);
        assert!(out.contains("`brass` is not a value"), "{out}");
        assert!(out.contains("`quill`"), "{out}");
        assert_eq!(position_count(&out), 1, "the position is repeated: {out}");
        assert!(out.ends_with("(line 2 column 8)"), "{out}");
        // And the allowed list must not have swallowed the position.
        assert!(!out.contains("`ledger` at line"), "{out}");
    }

    #[test]
    fn a_missing_field_says_which_and_what_to_do() {
        let out = friendly_yaml_error("missing field `order` at line 5 column 1");
        assert!(out.contains("`order`"), "{out}");
        assert!(out.contains("Add it to the frontmatter"), "{out}");
    }

    #[test]
    fn a_message_with_no_position_does_not_grow_an_empty_one() {
        let out = friendly_yaml_error("something went sideways");
        assert!(!out.contains("()"), "{out}");
        assert!(!out.contains("line"), "{out}");
    }
}
