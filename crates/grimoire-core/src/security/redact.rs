//! Stripping secrets out of terminal output before anything keeps it (§11).
//!
//! §11: "Redact anything matching a key pattern from PTY output before it reaches the
//! transcript." This runs on every chunk the PTY produces, on the way to both the transcript
//! and the screen, so a key echoed by a `printenv` never reaches either.
//!
//! It is deliberately a small set of *shapes* rather than a clever general matcher. A pattern
//! that tries to catch every possible secret will mangle ordinary output, and output that has
//! been mangled at random is worse than useless in a terminal. What is here are the prefixed,
//! self-identifying token formats that are unambiguous when they appear.

/// What replaces a match. Fixed width so it cannot be used to measure the original.
const MASK: &str = "[redacted]";

/// Prefixes that are unmistakably the start of a credential, with the minimum run of
/// token characters that has to follow before we believe it.
const PREFIXES: &[(&str, usize)] = &[
    ("sk-ant-", 16),   // Anthropic
    ("sk-proj-", 16),  // OpenAI project keys
    ("sk-", 20),       // other OpenAI-style; longer run required, since `sk-` alone is common
    ("ghp_", 16),      // GitHub personal
    ("gho_", 16),      // GitHub OAuth
    ("ghs_", 16),      // GitHub server-to-server
    ("github_pat_", 20),
    ("xoxb-", 16),     // Slack bot
    ("xoxp-", 16),     // Slack user
    ("AIza", 30),      // Google API
    ("ya29.", 20),     // Google OAuth access token
    ("AKIA", 16),      // AWS access key id
    ("ASIA", 16),      // AWS temporary
];

/// Whether a byte can appear inside a token body.
fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || b == b'~' || b == b'+'
}

/// Replace every credential-shaped run in `input` with a fixed mask.
///
/// Operates on bytes, not `str`: terminal output is not guaranteed to be valid UTF-8, and a
/// chunk boundary can fall inside a multi-byte character. Non-ASCII bytes are copied through
/// untouched, so this never corrupts text it does not match.
pub fn redact(input: &[u8]) -> Vec<u8> {
    // The overwhelmingly common case is a chunk with no secret in it at all. Check once, and
    // hand back an untouched copy rather than rebuilding the buffer byte by byte.
    if !PREFIXES.iter().any(|(p, _)| contains(input, p.as_bytes())) {
        return input.to_vec();
    }

    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    'outer: while i < input.len() {
        for (prefix, min_body) in PREFIXES {
            let pb = prefix.as_bytes();
            if input[i..].starts_with(pb) {
                let mut end = i + pb.len();
                while end < input.len() && is_token_byte(input[end]) {
                    end += 1;
                }
                if end - (i + pb.len()) >= *min_body {
                    out.extend_from_slice(MASK.as_bytes());
                    i = end;
                    continue 'outer;
                }
            }
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> String {
        String::from_utf8(redact(s.as_bytes())).expect("utf8")
    }

    #[test]
    fn an_anthropic_key_is_masked_wherever_it_appears() {
        let key = "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG";
        assert_eq!(r(key), "[redacted]");
        assert_eq!(r(&format!("ANTHROPIC_API_KEY={key}")), "ANTHROPIC_API_KEY=[redacted]");
        assert_eq!(r(&format!("using {key} now")), "using [redacted] now");
    }

    #[test]
    fn every_listed_shape_is_covered() {
        for (prefix, min) in PREFIXES {
            let body = "A".repeat(*min);
            let masked = r(&format!("{prefix}{body}"));
            assert_eq!(masked, "[redacted]", "{prefix} was not redacted");
        }
    }

    #[test]
    fn ordinary_output_survives_untouched() {
        // These are the false positives that would make a terminal unusable.
        for s in [
            "sk-",
            "npm install sk-cli",
            "AKIA",                        // the bare prefix, no body
            "let x = 1; // AIza is a name",
            "https://example.com/path?q=1",
            "AIzaShort",                   // too short to be a key
        ] {
            assert_eq!(r(s), s, "mangled: {s}");
        }
    }

    #[test]
    fn the_mask_does_not_leak_the_length_of_what_it_replaced() {
        let short = r(&format!("ghp_{}", "A".repeat(16)));
        let long = r(&format!("ghp_{}", "A".repeat(120)));
        assert_eq!(short, long);
    }

    #[test]
    fn invalid_utf8_passes_through_without_corruption() {
        // A chunk boundary can land mid-character; redaction must not care.
        let bytes = [0xff, 0xfe, b'h', b'i', 0x80];
        assert_eq!(redact(&bytes), bytes.to_vec());
    }

    #[test]
    fn two_keys_on_one_line_are_both_masked() {
        let line = format!("a=ghp_{} b=ghp_{}", "A".repeat(20), "B".repeat(20));
        assert_eq!(r(&line), "a=[redacted] b=[redacted]");
    }
}
