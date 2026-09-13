//! Tests that drive a **real** engine binary.
//!
//! All `#[ignore]`d: they need a `claude` binary installed, so they must not fail a run on a
//! machine without one. Run them deliberately:
//!
//! ```text
//! cargo test -p grimoire-core --test engine -- --ignored --nocapture
//! ```
//!
//! They answer the two questions print mode could not, both logged against Phase 1 in TASKS.md:
//! whether an interactive engine gets past its first-run screens inside our pty, and whether
//! the seal's `PreToolUse` hook fires there (DECISIONS.md 0004 measured it only with `-p`).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use grimoire_core::summon::{PtySession, PtySize, Sink, Spawn, resolve, scrubbed_env, stop_with};
use grimoire_core::types::Engine;

#[derive(Default)]
struct Collector {
    bytes: Mutex<Vec<u8>>,
    chunks: AtomicUsize,
}

impl Collector {
    fn sink(self: &Arc<Self>) -> Sink {
        let me = Arc::clone(self);
        Arc::new(move |b: Vec<u8>| {
            me.chunks.fetch_add(1, Ordering::SeqCst);
            me.bytes.lock().expect("lock").extend_from_slice(&b);
        })
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes.lock().expect("lock")).into_owned()
    }
}

fn until(timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    f()
}

/// Collapse whitespace away entirely, so a substring check survives the engine laying text out
/// with cursor-positioning escapes instead of spaces. Without this, "Let's get started" is on
/// screen but matches nothing, because the gaps between words are `ESC [ 9 G`, not spaces.
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Terminal output is full of escape sequences; strip them before looking for words.
fn plain(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // CSI and OSC both run until a terminator; close enough for a substring check.
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn claude(args: &[&str], cwd: &std::path::Path, sink: Sink) -> PtySession {
    let resolved = resolve(Engine::Claude, None, std::env::var("PATH").ok().as_deref())
        .expect("claude is not on PATH; this test needs it");
    PtySession::spawn(
        Spawn {
            program: resolved.path().to_path_buf(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: cwd.to_path_buf(),
            env: scrubbed_env(std::env::vars(), []),
            size: PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 },
        },
        sink,
    )
    .expect("spawn")
}

#[test]
#[ignore = "needs a claude binary"]
fn a_real_engine_draws_its_interface_and_answers_the_keyboard() {
    // The half of §12 Phase 1 that a pipe cannot reach. An interactive CLI reads the terminal
    // directly, so piping into `script` never touches it — which is why this was still open
    // after the print-mode probes in DECISIONS.md 0004.
    //
    // What this proves: the engine starts inside our pty, believes it has a terminal, draws its
    // full interface with colour and cursor positioning, and — the part that matters — *reacts
    // to keystrokes we send*, advancing from one screen to the next. That is a working
    // bidirectional terminal, which is what the pty layer owes the rest of the application.
    //
    // What it deliberately does not assert: a model turn. See the note at the end.
    let tmp = tempfile::tempdir().expect("tmp");
    let out = Arc::new(Collector::default());
    let s = claude(&[], tmp.path(), out.sink());

    let screen = || squash(&plain(&out.text()));

    assert!(
        until(Duration::from_secs(60), || !out.text().is_empty()),
        "the engine drew nothing at all inside the pty"
    );

    // It thinks it has a terminal: this banner is only drawn to a tty.
    assert!(
        until(Duration::from_secs(30), || screen().contains("WelcometoClaudeCode")),
        "no interactive banner; the engine may not believe it has a terminal:\n{}",
        plain(&out.text())
    );

    // Colour and cursor positioning came through unmangled, which is what the redactor's
    // pass-through and the chunking have to preserve.
    let raw = out.text();
    assert!(raw.contains("\u{1b}[38;2;"), "truecolour escapes did not survive the pipeline");

    // The keyboard half. Wait for it to finish drawing and go quiet first — the banner arrives
    // well before whatever screen follows it, and sampling in between races the engine.
    let mut settled = screen().len();
    assert!(
        until(Duration::from_secs(30), || {
            std::thread::sleep(Duration::from_millis(400));
            let now = screen().len();
            let stable = now == settled && now > 0;
            settled = now;
            stable
        }),
        "the engine never stopped drawing:\n{}",
        plain(&out.text())
    );

    let before = screen();
    println!(
        "settled at {} chars; first-run screens shown: {}",
        before.len(),
        before.contains("Choosethetextstyle") || before.contains("Let'sgetstarted")
    );

    // Press a key. On a fresh machine this answers a first-run question and moves to the next
    // screen; on one already onboarded it lands in the prompt box. Either way the screen must
    // change, and if input were not reaching the pty it could not.
    s.write(b"\r").expect("write");
    assert!(
        until(Duration::from_secs(20), || screen() != before),
        "the engine did not react to a keypress: input is not reaching the pty"
    );
    println!("the engine reacted to a keystroke");

    let _ = stop_with(&s, Duration::from_secs(5), Duration::from_secs(3));

    // A full model turn through the *interactive* interface is not asserted here, and the
    // reason is the machine, not the code. This container has never run `claude` interactively,
    // so `hasCompletedOnboarding` is unset and the first-run flow asks to pick a login method —
    // even though `oauthAccount` is present and `claude -p` answers normally with exactly the
    // environment `scrubbed_env` provides. Completing that flow wants an OAuth code pasted from
    // a browser, which a sandbox cannot do.
    //
    // Grimoire deliberately does not pre-write `hasCompletedOnboarding` to get around it. That
    // would mean editing the user's own CLI configuration behind their back to skip a consent
    // screen, which is not ours to skip. A summoning is a real terminal: the first one on a new
    // machine shows the first-run questions and the user answers them once, exactly as they
    // would in any terminal. TASKS.md carries this as the one Phase 1 criterion to confirm on
    // the owner's machine.
}

#[test]
#[ignore = "needs a claude binary"]
fn output_arrives_while_the_engine_sits_at_its_prompt() {
    // The regression that motivated splitting the reader from the flusher. An engine that draws
    // its interface and then waits must still have delivered every byte of it: if output only
    // arrives when the *next* read returns, a waiting engine shows nothing at all.
    let tmp = tempfile::tempdir().expect("tmp");
    let out = Arc::new(Collector::default());
    let s = claude(&["--restricted", "--tools", "Read"], tmp.path(), out.sink());

    assert!(until(Duration::from_secs(60), || !out.text().is_empty()), "nothing drawn");
    let at_first_sight = out.text().len();

    // Let it settle at whatever screen it reached and stop writing.
    std::thread::sleep(Duration::from_secs(3));
    let after_settling = out.text().len();

    // Nothing should still be held: a byte written before the pause has to have been delivered.
    std::thread::sleep(Duration::from_secs(2));
    assert_eq!(
        out.text().len(),
        after_settling,
        "bytes were still trickling out after the engine went quiet — something is holding them"
    );
    assert!(after_settling >= at_first_sight);
    println!("delivered {after_settling} bytes in {} chunks", out.chunks.load(Ordering::SeqCst));

    let _ = stop_with(&s, Duration::from_secs(2), Duration::from_secs(1));
}

#[test]
#[ignore = "needs a claude binary"]
fn stopping_a_real_engine_leaves_nothing_behind() {
    // §12 Phase 1: quit leaves no orphan. An engine is a heavier process tree than `bash`.
    let tmp = tempfile::tempdir().expect("tmp");
    let out = Arc::new(Collector::default());
    let s = claude(&["--restricted", "--tools", "Read"], tmp.path(), out.sink());
    let pid = s.pid();

    assert!(until(Duration::from_secs(60), || !out.text().is_empty()), "never started");
    let how = stop_with(&s, Duration::from_secs(5), Duration::from_secs(3)).expect("stop");
    println!("stopped at: {how:?}");

    assert!(
        until(Duration::from_secs(10), || !grimoire_core::summon::group_alive(pid)),
        "the engine's process group outlived the stop ladder"
    );
}
