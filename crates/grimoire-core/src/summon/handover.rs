//! Giving a familiar its commission (§6.2).
//!
//! Until this existed, a commission was written to the table, marked `running` when a summoning
//! picked it up, and never shown to the engine at all. The familiar sat at an empty prompt while
//! the interface said it was working. There are two moments a commission can reach an engine,
//! and each has its own way in:
//!
//! * **At summon**, as the engine's first message: a positional argument, after `--` so a task
//!   that begins with a dash is read as words and not as an option.
//! * **To an engine already running**, as typed input. The engine is a terminal program and the
//!   pty is its keyboard; there is no other channel (the breaker's steer messages use the same
//!   one).

/// The arguments that make a newly summoned engine start on `prompt`.
///
/// `claude [options] [prompt]` starts an interactive session with the prompt already submitted.
/// Empty when there is no prompt, so a summoning with nothing to do opens at an empty prompt as
/// it always has.
pub fn initial_prompt(prompt: &str) -> Vec<String> {
    if prompt.trim().is_empty() {
        return Vec::new();
    }
    vec!["--".into(), prompt.to_string()]
}

/// What to type into a running engine to hand it `prompt`, without the final Enter.
///
/// The Enter is sent separately and a moment later (see the caller): an engine that has just
/// been handed a paste may still be taking it in, and an Enter inside the same read can land in
/// the paste rather than submit it.
///
/// `bracketed` is whether the engine has turned on bracketed paste (`ESC [ ? 2004 h`), which
/// [`PasteMode`] watches for. With it, the whole commission goes in as one paste and its line
/// breaks survive. Without it every newline would be a press of Enter and submit half a
/// commission, so the lines are joined with spaces instead: flatter, but whole.
///
/// Control characters are dropped either way. A commission is words; a stray escape in one
/// could drive the engine's interface, and a paste-end marker could end the paste early and
/// have the rest of the text typed as keys.
pub fn keystrokes(prompt: &str, bracketed: bool) -> Vec<u8> {
    let clean: String = prompt
        .trim()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .map(|c| if c == '\t' { ' ' } else { c })
        .collect();
    let mut out = Vec::with_capacity(clean.len() + 12);
    if bracketed {
        out.extend_from_slice(b"\x1b[200~");
        out.extend_from_slice(clean.as_bytes());
        out.extend_from_slice(b"\x1b[201~");
    } else {
        let joined = clean.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
        out.extend_from_slice(joined.as_bytes());
    }
    out
}

/// Whether the engine currently has bracketed paste on, read from what it writes to the
/// terminal.
///
/// Fed every chunk of output in order. The switch sequences can be split across two reads, so
/// the tail of each chunk is kept and looked at again with the next.
#[derive(Debug, Default)]
pub struct PasteMode {
    on: bool,
    tail: Vec<u8>,
}

const ON: &[u8] = b"\x1b[?2004h";
const OFF: &[u8] = b"\x1b[?2004l";

impl PasteMode {
    pub fn on(&self) -> bool {
        self.on
    }

    pub fn feed(&mut self, chunk: &[u8]) {
        let mut window = std::mem::take(&mut self.tail);
        window.extend_from_slice(chunk);
        // The last switch in the window wins.
        let last_on = rfind(&window, ON);
        let last_off = rfind(&window, OFF);
        match (last_on, last_off) {
            (Some(a), Some(b)) => self.on = a > b,
            (Some(_), None) => self.on = true,
            (None, Some(_)) => self.on = false,
            (None, None) => {}
        }
        let keep = ON.len() - 1;
        let from = window.len().saturating_sub(keep);
        self.tail = window[from..].to_vec();
    }
}

fn rfind(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if hay.len() < needle.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).rev().find(|&i| &hay[i..i + needle.len()] == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commission_goes_after_the_double_dash_so_a_leading_dash_is_not_an_option() {
        assert_eq!(initial_prompt("-v tighten the essay"), vec!["--", "-v tighten the essay"]);
    }

    #[test]
    fn nothing_to_do_adds_no_arguments() {
        assert!(initial_prompt("").is_empty());
        assert!(initial_prompt("  \n ").is_empty());
    }

    #[test]
    fn with_paste_mode_the_commission_is_one_paste_and_keeps_its_lines() {
        assert_eq!(keystrokes("Read it.\nThen cut it.", true), b"\x1b[200~Read it.\nThen cut it.\x1b[201~".to_vec());
    }

    #[test]
    fn without_paste_mode_the_lines_are_joined_so_no_newline_submits_half_of_it() {
        assert_eq!(keystrokes("Read it.\n\n  Then cut it.  \n", false), b"Read it. Then cut it.".to_vec());
    }

    #[test]
    fn control_characters_cannot_end_the_paste_or_drive_the_interface() {
        let hostile = "one\x1b[201~two\x07\x03three\tfour";
        let typed = keystrokes(hostile, true);
        assert_eq!(typed, b"\x1b[200~one[201~twothree four\x1b[201~".to_vec());
        // Exactly one paste start and one paste end: the text could not close it early.
        let text = String::from_utf8(typed).expect("utf8");
        assert_eq!(text.matches("\x1b[201~").count(), 1);
    }

    #[test]
    fn paste_mode_follows_the_last_switch_even_split_across_reads() {
        let mut mode = PasteMode::default();
        assert!(!mode.on());
        mode.feed(b"hello \x1b[?20");
        mode.feed(b"04h drawn");
        assert!(mode.on(), "a switch split across two reads was missed");
        mode.feed(b"\x1b[?2004l\x1b[?2004h");
        assert!(mode.on());
        mode.feed(b"bye \x1b[?2004l");
        assert!(!mode.on());
        mode.feed(b"plain output with no switch in it at all");
        assert!(!mode.on(), "output without a switch changed the mode");
    }
}
