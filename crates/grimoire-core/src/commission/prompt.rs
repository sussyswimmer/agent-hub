//! `{{intake.*}}` substitution (§4, §6.2).
//!
//! This is the **only** templating in Grimoire. §4 is emphatic about the writ: "passed verbatim
//! to the CLI as its system prompt. Do not template it, do not inject anything into it except
//! the documented `{{intake.*}}` substitutions." So this is deliberately a small, dull string
//! replacement and not a template engine — no conditionals, no loops, no filters, nothing that
//! could turn a writ into a program.

use std::collections::BTreeMap;

/// Replace every `{{intake.<id>}}` with its answer.
///
/// Rules, each chosen so a surprise is impossible rather than merely unlikely:
///
/// * Whitespace inside the braces is allowed: `{{ intake.piece }}` is the same placeholder. It
///   is what people type.
/// * A placeholder with no answer becomes the empty string, and is reported. Leaving the literal
///   `{{intake.piece}}` in the prompt would send the familiar a template it cannot read.
/// * Substitution is single-pass: an answer that itself contains `{{intake.x}}` is left alone.
///   Otherwise an answer could reach into the writ, which is the thing §4 forbids.
///
/// Returns the filled text and the ids that had no answer.
pub fn fill(template: &str, answers: &BTreeMap<String, String>) -> (String, Vec<String>) {
    let mut out = String::with_capacity(template.len());
    let mut missing = Vec::new();
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        let Some(end_rel) = rest[start..].find("}}") else {
            break; // An unclosed brace is just text.
        };
        let end = start + end_rel;
        let inner = rest[start + 2..end].trim();

        match inner.strip_prefix("intake.") {
            Some(key) if !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_') => {
                out.push_str(&rest[..start]);
                match answers.get(key) {
                    Some(v) => out.push_str(v),
                    None => missing.push(key.to_string()),
                }
            }
            // Anything else in braces is not ours. `{{ 2 + 2 }}` in a writ is prose about
            // braces, and rewriting it would be exactly the injection §4 rules out.
            _ => out.push_str(&rest[..end + 2]),
        }
        rest = &rest[end + 2..];
    }

    out.push_str(rest);
    missing.sort();
    missing.dedup();
    (out, missing)
}

/// Which placeholders a template uses. Lets the interface check a commission against its
/// binding's intake before anything is dispatched.
pub fn placeholders(template: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let Some(end_rel) = rest[start..].find("}}") else { break };
        let end = start + end_rel;
        let inner = rest[start + 2..end].trim();
        if let Some(key) = inner.strip_prefix("intake.")
            && !key.is_empty()
            && key.chars().all(|c| c.is_alphanumeric() || c == '_')
        {
            found.push(key.to_string());
        }
        rest = &rest[end + 2..];
    }
    found.sort();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answers(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn a_placeholder_is_replaced_by_its_answer() {
        let (out, missing) = fill(
            "Work on {{intake.piece}} with a {{intake.mode}} pass.",
            &answers(&[("piece", "the swimming essay"), ("mode", "structural")]),
        );
        assert_eq!(out, "Work on the swimming essay with a structural pass.");
        assert!(missing.is_empty());
    }

    #[test]
    fn spaces_inside_the_braces_are_allowed_because_people_type_them() {
        let (out, _) = fill("{{ intake.piece }}", &answers(&[("piece", "x")]));
        assert_eq!(out, "x");
    }

    #[test]
    fn an_unanswered_placeholder_empties_rather_than_leaking_the_template() {
        // Sending the familiar a literal `{{intake.audience}}` would have it reading markup.
        let (out, missing) = fill("For {{intake.audience}}.", &answers(&[]));
        assert_eq!(out, "For .");
        assert_eq!(missing, vec!["audience"]);
    }

    #[test]
    fn an_answer_containing_a_placeholder_is_not_expanded_again() {
        // The injection this guards against: an answer that reaches into the writ. §4 allows
        // exactly one substitution pass, and an answer is data, never template.
        let (out, _) = fill(
            "{{intake.a}} and {{intake.b}}",
            &answers(&[("a", "{{intake.b}}"), ("b", "second")]),
        );
        assert_eq!(out, "{{intake.b}} and second");
    }

    #[test]
    fn braces_that_are_not_ours_are_left_exactly_as_they_were() {
        for text in [
            "Use {{handlebars}} in the output.",
            "A literal {{ intake }} with no dot.",
            "{{intake.}} is not a key.",
            "{{intake.has-a-dash}} is not one either.",
            "An unclosed {{intake.piece is just text.",
        ] {
            let (out, missing) = fill(text, &answers(&[("piece", "X")]));
            assert_eq!(out, text, "rewrote something that was not a placeholder: {text}");
            assert!(missing.is_empty());
        }
    }

    #[test]
    fn the_same_placeholder_twice_is_filled_twice() {
        let (out, _) = fill("{{intake.x}}/{{intake.x}}", &answers(&[("x", "a")]));
        assert_eq!(out, "a/a");
    }

    #[test]
    fn a_template_with_no_placeholders_is_returned_untouched() {
        let text = "Just a plain instruction.";
        assert_eq!(fill(text, &answers(&[])).0, text);
    }

    #[test]
    fn placeholders_lists_what_a_template_needs() {
        assert_eq!(
            placeholders("{{intake.b}} {{intake.a}} {{intake.b}} {{other}}"),
            vec!["a", "b"]
        );
    }
}
