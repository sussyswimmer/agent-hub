//! Split `agent.md` into YAML frontmatter and prose body.

/// Returns `(yaml, body)`. The file must start with `---\n` and contain a closing `\n---\n`.
pub fn split_frontmatter(text: &str) -> Result<(String, String), String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text); // BOM
    let rest = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
        .ok_or_else(|| "agent.md must start with a `---` frontmatter line".to_string())?;
    // Closing fence: a line that is exactly `---`.
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let yaml = rest[..offset].to_string();
            let body = rest[offset + line.len()..].to_string();
            return Ok((yaml, body));
        }
        offset += line.len();
    }
    Err("frontmatter is never closed (missing a `---` line)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_basic() {
        let (y, b) = split_frontmatter("---\nid: x\nname: X\n---\nBody line\n").unwrap();
        assert_eq!(y, "id: x\nname: X\n");
        assert_eq!(b, "Body line\n");
    }

    #[test]
    fn empty_body_ok() {
        let (y, b) = split_frontmatter("---\nid: x\n---\n").unwrap();
        assert_eq!(y, "id: x\n");
        assert_eq!(b, "");
    }

    #[test]
    fn errors() {
        assert!(split_frontmatter("id: x\n").is_err());
        assert!(split_frontmatter("---\nid: x\n").is_err());
    }
}
