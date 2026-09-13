//! Phase 1 acceptance (CLAUDE.md §12): a real pty, resize, a flood, and no orphans.
//!
//! These drive `bash` rather than an agent CLI. The behaviour under test belongs to the pty
//! layer — echo, geometry, backpressure, the stop ladder — and `bash` exercises all of it
//! deterministically, in milliseconds, on any machine, with no network and no subscription.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use grimoire_core::summon::pty::{MAX_CHUNK, PtySession, Spawn};
use grimoire_core::summon::{Stopped, group_alive, scrubbed_env, stop_with};
use portable_pty::PtySize;

const SIZE: PtySize = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };

/// Collects everything the session emits, and counts the chunks it arrived in.
#[derive(Default)]
struct Collector {
    bytes: Mutex<Vec<u8>>,
    chunks: AtomicUsize,
}

impl Collector {
    fn sink(self: &Arc<Self>) -> grimoire_core::summon::Sink {
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

fn bash(args: &[&str]) -> Spawn {
    Spawn {
        program: "/bin/bash".into(),
        args: args.iter().map(|s| s.to_string()).collect(),
        cwd: std::env::temp_dir(),
        env: scrubbed_env(std::env::vars(), []),
        size: SIZE,
    }
}

/// Poll until `f` holds or the deadline passes. Returns whether it held.
fn until(timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    f()
}

#[test]
fn input_typed_into_the_pty_comes_back_out() {
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(bash(&["--noprofile", "--norc", "-i"]), out.sink()).expect("spawn");

    s.write(b"echo hello-from-the-pty\n").expect("write");
    assert!(
        until(Duration::from_secs(10), || out.text().contains("hello-from-the-pty")),
        "never saw the output; got: {:?}",
        out.text()
    );

    s.write(b"exit\n").expect("write");
    assert!(until(Duration::from_secs(10), || s.try_wait().expect("wait").is_some()));
}

#[test]
fn it_is_a_real_terminal_not_a_pipe() {
    // The engines Grimoire wraps check `isatty` and fall back to non-interactive output when it
    // is false. If this ever regresses to a pipe, every familiar silently changes behaviour.
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(
        bash(&["-c", "test -t 0 && test -t 1 && echo IS-A-TTY || echo IS-A-PIPE"]),
        out.sink(),
    )
    .expect("spawn");

    assert!(until(Duration::from_secs(10), || out.text().contains("IS-A-")), "no answer");
    assert!(out.text().contains("IS-A-TTY"), "not a tty: {:?}", out.text());
    let _ = s.wait();
}

#[test]
fn resizing_changes_the_geometry_the_program_sees() {
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(bash(&["--noprofile", "--norc", "-i"]), out.sink()).expect("spawn");

    s.write(b"stty size\n").expect("write");
    assert!(until(Duration::from_secs(10), || out.text().contains("24 80")), "before: {:?}", out.text());

    s.resize(PtySize { rows: 40, cols: 132, pixel_width: 0, pixel_height: 0 }).expect("resize");
    s.write(b"stty size\n").expect("write");
    assert!(until(Duration::from_secs(10), || out.text().contains("40 132")), "after: {:?}", out.text());

    s.write(b"exit\n").expect("write");
    let _ = s.wait();
}

#[test]
fn a_fifty_thousand_line_flood_is_delivered_whole_and_in_bounded_chunks() {
    // §12 Phase 1: `cat` a 50k-line file with the interface still responsive. "Responsive"
    // means the front-end is not handed one message per read: the reader coalesces, so the
    // chunk count stays far below the line count, and no single chunk is unbounded.
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(
        bash(&["-c", "for i in $(seq 1 50000); do echo \"line $i of the flood\"; done"]),
        out.sink(),
    )
    .expect("spawn");

    let started = Instant::now();
    assert!(
        until(Duration::from_secs(60), || s.drained()),
        "the flood did not finish within 60s"
    );
    let elapsed = started.elapsed();

    let text = out.text();
    assert!(text.contains("line 1 of the flood"), "missing the first line");
    assert!(text.contains("line 50000 of the flood"), "missing the last line");
    assert_eq!(text.matches("of the flood").count(), 50_000, "lines were lost or doubled");

    let chunks = out.chunks.load(Ordering::SeqCst);
    // Without coalescing this would be one message per 16KB read, in the thousands.
    assert!(chunks < 5_000, "reader did not coalesce: {chunks} chunks");
    // And the cap has to hold, or one message could still be megabytes.
    let total = out.bytes.lock().expect("lock").len();
    assert!(chunks >= total.div_ceil(MAX_CHUNK).max(1), "chunk cap was not applied");

    assert!(elapsed < Duration::from_secs(60), "took {elapsed:?}");
    let _ = s.wait();
}

#[test]
fn an_interruptible_familiar_stops_at_the_first_rung() {
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(bash(&["-c", "sleep 300"]), out.sink()).expect("spawn");
    let pid = s.pid();
    assert!(until(Duration::from_secs(5), || group_alive(pid)));

    let how = stop_with(&s, Duration::from_secs(5), Duration::from_secs(3)).expect("stop");
    assert_eq!(how, Stopped::Interrupt, "a plain sleep should die on SIGINT");
    assert!(!group_alive(pid), "the process group outlived the stop");
}

#[test]
fn a_familiar_that_ignores_signals_is_still_gone_afterwards() {
    // The case the ladder exists for: a process that traps INT and TERM and would otherwise
    // run forever. It must reach SIGKILL and leave nothing behind.
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(
        bash(&["-c", "trap '' INT TERM; echo TRAPPED; while true; do sleep 0.1; done"]),
        out.sink(),
    )
    .expect("spawn");
    let pid = s.pid();
    assert!(until(Duration::from_secs(10), || out.text().contains("TRAPPED")), "never started");

    let how = stop_with(&s, Duration::from_millis(300), Duration::from_millis(300)).expect("stop");
    assert_eq!(how, Stopped::Kill, "should have had to go all the way to SIGKILL");
    // Polled, not asserted outright: the `sleep` this loop spawns is killed with the group but
    // is then a zombie reparented to init, and a zombie keeps the group id resolvable until
    // init reaps it. Nothing is running at that point, which is what the assertion is about.
    assert!(
        until(Duration::from_secs(5), || !group_alive(pid)),
        "the process group outlived SIGKILL"
    );
}

#[test]
fn stopping_takes_the_whole_process_tree_not_just_the_child() {
    // A familiar spawns shells, and those spawn builds. Signalling only the child would orphan
    // every grandchild, and an orphaned build keeps burning the machine after the familiar is
    // gone from the rail. This is the test that proves the group, not the process, is signalled.
    let out = Arc::new(Collector::default());
    let tmp = tempfile::tempdir().expect("tmp");
    let marker = tmp.path().join("grandchild.pid");

    let script = format!(
        "( trap '' INT TERM; sleep 300 ) & echo $! > {m}; echo STARTED; wait",
        m = marker.display()
    );
    let s = PtySession::spawn(bash(&["-c", &script]), out.sink()).expect("spawn");

    assert!(until(Duration::from_secs(10), || marker.exists()), "grandchild never started");
    let grandchild: i32 = std::fs::read_to_string(&marker)
        .expect("read")
        .trim()
        .parse()
        .expect("pid");

    // Safety: signal 0 delivers nothing; it only performs the existence check.
    let alive = |p: i32| unsafe { libc::kill(p, 0) == 0 };
    assert!(until(Duration::from_secs(5), || alive(grandchild)), "grandchild not running");

    stop_with(&s, Duration::from_millis(300), Duration::from_millis(300)).expect("stop");

    assert!(
        until(Duration::from_secs(5), || !alive(grandchild)),
        "the grandchild ({grandchild}) survived: the signal went to the child, not the group"
    );
    assert!(!group_alive(s.pid()));
}

#[test]
fn a_thread_watching_for_the_exit_does_not_block_the_stop_ladder() {
    // Found by pressing Banish in the running application, where nothing happened at all and no
    // error was shown. The interface runs a watcher thread so it can mark a summoning ended;
    // the obvious way to write it is `session.wait()`, which holds the child lock until the
    // process exits — and `stop` needs that same lock. Every Banish then deadlocks, silently,
    // for as long as the familiar is alive. No test had a waiter thread, so nothing caught it.
    //
    // This reproduces the shape the application uses: a watcher polling alongside a stop.
    let out = Arc::new(Collector::default());
    let s = Arc::new(PtySession::spawn(bash(&["-c", "sleep 300"]), out.sink()).expect("spawn"));
    let pid = s.pid();

    let watcher = {
        let s = Arc::clone(&s);
        std::thread::spawn(move || {
            // Poll, never block: exactly what src-tauri/src/summonings.rs must do.
            for _ in 0..200 {
                if matches!(s.try_wait(), Ok(Some(_)) | Err(_)) || s.drained() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        })
    };

    // The stop must complete promptly even with the watcher running. A deadlock shows up here
    // as this call never returning, so the bound is the assertion.
    let started = Instant::now();
    let how = stop_with(&s, Duration::from_millis(300), Duration::from_millis(300)).expect("stop");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "stop took {:?} with a watcher running — the child lock is being held",
        started.elapsed()
    );
    assert_eq!(how, Stopped::Interrupt);
    assert!(watcher.join().expect("watcher"), "the watcher never noticed the exit");
    assert!(until(Duration::from_secs(5), || !group_alive(pid)));
}

#[test]
fn stopping_something_already_finished_is_not_an_error() {
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(bash(&["-c", "true"]), out.sink()).expect("spawn");
    assert!(until(Duration::from_secs(10), || s.try_wait().expect("wait").is_some()));
    assert_eq!(stop_with(&s, Duration::from_millis(50), Duration::from_millis(50)).expect("stop"), Stopped::Already);
}

#[test]
fn secrets_are_redacted_before_they_reach_the_transcript() {
    // §11. The sink is the transcript's only source, so a key echoed inside the pty must not
    // arrive here in the first place.
    let out = Arc::new(Collector::default());
    let key = format!("sk-ant-api03-{}", "Z".repeat(24));
    let s = PtySession::spawn(bash(&["-c", &format!("echo {key}")]), out.sink()).expect("spawn");

    assert!(until(Duration::from_secs(10), || s.drained()), "never finished");
    let text = out.text();
    assert!(!text.contains(&key), "the key reached the transcript: {text:?}");
    assert!(text.contains("[redacted]"), "expected a mask, got: {text:?}");
}

#[test]
fn a_secret_dribbled_out_one_byte_at_a_time_is_still_redacted() {
    // The hole the flusher's carry exists to close. Redaction matches whole tokens, so a key
    // that straddles two 16ms ticks would match neither half and reach the transcript in the
    // clear. A familiar printing slowly — which is what a real one does — hits exactly this.
    let out = Arc::new(Collector::default());
    let key = format!("ghp_{}", "Q".repeat(30));
    // `fold -w1` plus a delay puts a byte per line through the pty across many ticks.
    let script = format!(
        "printf '%s' '{key}' | fold -w1 | while read -r c; do printf '%s' \"$c\"; sleep 0.002; done; echo",
        key = key
    );
    let s = PtySession::spawn(bash(&["-c", &script]), out.sink()).expect("spawn");

    assert!(until(Duration::from_secs(30), || s.drained()), "never finished");
    let text = out.text();
    assert!(!text.contains(&key), "the key was reassembled in the clear: {text:?}");
    assert!(text.contains("[redacted]"), "expected a mask, got: {text:?}");
}

#[test]
fn holding_bytes_back_never_stalls_ordinary_output() {
    // The carry must not swallow a trailing word forever. A familiar that prints a prompt and
    // waits — `$ ` or `> ` or a bare word — has to reach the screen on the next tick.
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(
        bash(&["-c", "printf 'awaiting-your-word'; sleep 4"]),
        out.sink(),
    )
    .expect("spawn");

    assert!(
        until(Duration::from_secs(3), || out.text().contains("awaiting-your-word")),
        "a trailing word was held back instead of shown; got: {:?}",
        out.text()
    );
    let _ = stop_with(&s, Duration::from_millis(200), Duration::from_millis(200));
}

#[test]
fn the_environment_is_built_from_an_allow_list_not_inherited() {
    // §11: a process that never receives a credential cannot echo one.
    let env = scrubbed_env(
        [
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("HOME".to_string(), "/home/someone".to_string()),
            ("HTTPS_PROXY".to_string(), "http://proxy:3128".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), "sk-ant-secret".to_string()),
            ("SOME_FUTURE_TOKEN".to_string(), "whatever".to_string()),
            ("MY_DATABASE_PASSWORD".to_string(), "hunter2".to_string()),
            ("SSH_AUTH_SOCK".to_string(), "/tmp/agent".to_string()),
        ],
        [("GRIMOIRE_RUN".to_string(), "01J".to_string())],
    );
    let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();

    assert!(keys.contains(&"PATH") && keys.contains(&"HOME"));
    assert!(keys.contains(&"TERM"), "the engine needs a terminal type it can draw to");
    assert!(keys.contains(&"GRIMOIRE_RUN"), "the caller's own variables must get through");
    // Learned from a real engine: strip these and it cannot reach the network, so it falls
    // through to a login screen no matter how it is authenticated.
    assert!(keys.contains(&"HTTPS_PROXY"), "the engine must be able to reach the network");
    assert!(keys.contains(&"ANTHROPIC_API_KEY"), "the engine must be able to authenticate");

    // Everything else stays out — including names nobody has thought of yet. That is the whole
    // point of an allow-list, and it is what a deny-list could never promise.
    for leaked in ["SOME_FUTURE_TOKEN", "MY_DATABASE_PASSWORD", "SSH_AUTH_SOCK"] {
        assert!(!keys.contains(&leaked), "{leaked} was inherited");
    }
}

#[test]
fn the_pty_reports_end_of_file_when_the_child_exits() {
    // If the parent holds the slave open, the reader never sees EOF and the thread leaks for
    // the life of the application. Easy to get wrong, invisible until a hundred summonings in.
    let out = Arc::new(Collector::default());
    let s = PtySession::spawn(bash(&["-c", "echo done"]), out.sink()).expect("spawn");
    assert!(until(Duration::from_secs(10), || s.drained()), "the reader never saw EOF");
}
