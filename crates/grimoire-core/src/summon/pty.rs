//! The pseudo-terminal a familiar runs inside (§6.1).
//!
//! A summoning is a real PTY, not a pipe, because the engines Grimoire wraps are interactive
//! terminal programs: they draw with escape sequences, read keys rather than lines, and check
//! `isatty` before they will do either. `portable-pty` gives the master/slave pair; everything
//! above the raw file descriptors is here.
//!
//! Two properties this module exists to guarantee:
//!
//! * **Output cannot flood the interface.** A familiar that `cat`s a large file produces bytes
//!   far faster than a webview can lay them out. The reader coalesces on a tick and caps each
//!   chunk, so the front-end sees a steady handful of messages a second rather than thousands.
//! * **Nothing leaves without passing the redactor.** Every byte goes through `security::redact`
//!   here, at the single point where PTY output enters the application, rather than at each of
//!   the places that later consume it (§11).

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::error::{Error, Result};
use crate::security::redact;

/// How long output is gathered before it is handed on. One frame at 60Hz: fast enough to feel
/// immediate, slow enough that a flood becomes tens of messages a second instead of thousands.
pub const COALESCE: Duration = Duration::from_millis(16);

/// The most bytes in a single chunk. A tick that has gathered more is split across several, so
/// one enormous write cannot produce one enormous message.
pub const MAX_CHUNK: usize = 64 * 1024;

/// Where redacted output goes. A plain callback rather than anything Tauri-shaped, so the whole
/// of this module is testable without a webview.
pub type Sink = Arc<dyn Fn(Vec<u8>) + Send + Sync>;

/// What to spawn, and how.
pub struct Spawn {
    pub program: std::path::PathBuf,
    pub args: Vec<String>,
    pub cwd: std::path::PathBuf,
    /// The complete environment. Built by [`scrubbed_env`], never inherited wholesale.
    pub env: Vec<(String, String)>,
    pub size: PtySize,
}

/// A running summoning.
pub struct PtySession {
    /// Behind a mutex so the whole session is `Sync` and can live in shared application state.
    /// `MasterPty` is `Send` but not `Sync`, and the only thing we do with it is `resize`.
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    /// The child's process id, which is also its process-group id: `portable-pty` calls
    /// `setsid` in the child, so it leads its own group and the stop ladder can signal the
    /// whole group at once.
    pid: u32,
    reader_done: Arc<AtomicBool>,
}

impl PtySession {
    /// Open a pty, spawn the program in it, and start pumping output into `sink`.
    pub fn spawn(spec: Spawn, sink: Sink) -> Result<Self> {
        let pair = native_pty_system()
            .openpty(spec.size)
            .map_err(|e| Error::other(format!("could not open a pseudo-terminal: {e}")))?;

        let mut cmd = CommandBuilder::new(&spec.program);
        for a in &spec.args {
            cmd.arg(a);
        }
        cmd.cwd(&spec.cwd);
        cmd.env_clear();
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::other(format!("could not start {}: {e}", spec.program.display())))?;
        let pid = child
            .process_id()
            .ok_or_else(|| Error::other("the child started but reported no process id"))?;

        // Drop the slave in the parent. If the parent keeps it open, the master never reports
        // EOF when the child exits, and the reader thread hangs for the life of the process.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| Error::other(format!("could not read from the pseudo-terminal: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| Error::other(format!("could not write to the pseudo-terminal: {e}")))?;

        let reader_done = Arc::new(AtomicBool::new(false));
        spawn_pump(reader, sink, Arc::clone(&reader_done));

        Ok(Self {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            pid,
            reader_done,
        })
    }

    /// Send typed input. Bytes as given: the familiar is reading keys, not lines.
    pub fn write(&self, bytes: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().map_err(|_| Error::other("the pty writer was poisoned"))?;
        w.write_all(bytes).map_err(|e| Error::other(format!("could not send input: {e}")))?;
        w.flush().map_err(|e| Error::other(format!("could not send input: {e}")))
    }

    /// Tell the program its window changed. Without this a full-screen interface keeps drawing
    /// to the old geometry and the buffer tears.
    pub fn resize(&self, size: PtySize) -> Result<()> {
        self.master
            .lock()
            .map_err(|_| Error::other("the pty master was poisoned"))?
            .resize(size)
            .map_err(|e| Error::other(format!("could not resize the pseudo-terminal: {e}")))
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The exit status, if the child has finished. Never blocks.
    pub fn try_wait(&self) -> Result<Option<u32>> {
        let mut c = self.child.lock().map_err(|_| Error::other("the child handle was poisoned"))?;
        match c.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(Error::other(format!("could not check on the familiar: {e}"))),
        }
    }

    /// Block until the child exits. Used by the stop ladder between signals.
    pub fn wait(&self) -> Result<u32> {
        let mut c = self.child.lock().map_err(|_| Error::other("the child handle was poisoned"))?;
        c.wait()
            .map(|s| s.exit_code())
            .map_err(|e| Error::other(format!("could not wait for the familiar: {e}")))
    }

    /// End the child with the platform's native process termination primitive.
    pub fn kill(&self) -> Result<()> {
        self.child
            .lock()
            .map_err(|_| Error::other("the child handle was poisoned"))?
            .kill()
            .map_err(|e| Error::other(format!("could not stop the familiar: {e}")))
    }

    /// Whether the reader thread has seen end-of-file. Once this is true no further output
    /// will arrive, which is what "the transcript is complete" means.
    pub fn drained(&self) -> bool {
        self.reader_done.load(Ordering::SeqCst)
    }
}

/// Start the two threads that move output from the pty to `sink`.
///
/// **Reading and flushing have to be separate threads.** The obvious single-threaded version —
/// read, append, flush if the tick has elapsed — has a fatal flaw: `read` blocks, so bytes
/// gathered by the last read sit in the buffer until the *next* one returns. For a program
/// that prints a prompt and waits for input, the next read never returns, and the prompt is
/// never delivered. That is every turn of every interactive familiar, so the whole application
/// would appear to hang. Caught by the pty tests; do not merge these back into one loop.
fn spawn_pump(mut reader: Box<dyn Read + Send>, sink: Sink, done: Arc<AtomicBool>) {
    let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(MAX_CHUNK)));
    let eof = Arc::new(AtomicBool::new(false));

    // Reader: block on the pty, append, and never do anything slow while holding the lock.
    {
        let buffer = Arc::clone(&buffer);
        let eof = Arc::clone(&eof);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Ok(mut b) = buffer.lock() {
                            b.extend_from_slice(&chunk[..n]);
                        } else {
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    // Anything else, EIO included, is how a pty reports the child has gone.
                    Err(_) => break,
                }
            }
            eof.store(true, Ordering::SeqCst);
        });
    }

    // Flusher: wake on the tick, take whatever has arrived, redact it, pass it on.
    std::thread::spawn(move || {
        // Bytes held back because they might be the front of a credential split across two
        // ticks. See `split_at_safe_boundary`.
        let mut carry: Vec<u8> = Vec::new();

        loop {
            std::thread::sleep(COALESCE);
            let at_eof = eof.load(Ordering::SeqCst);

            let mut fresh = match buffer.lock() {
                Ok(mut b) => std::mem::take(&mut *b),
                Err(_) => break,
            };
            // Nothing new this tick means the familiar has stopped writing — it is at a prompt,
            // or thinking. That distinction is what decides whether holding bytes back is safe.
            let went_quiet = fresh.is_empty();

            let taken = if carry.is_empty() {
                fresh
            } else {
                carry.append(&mut fresh);
                std::mem::take(&mut carry)
            };

            if at_eof || went_quiet {
                // Either nothing more is coming at all, or nothing is coming right now. In both
                // cases no later byte can extend a token that ends here, so there is nothing to
                // wait for and holding on would only hide output.
                //
                // This is the case the stall test exists for. A prompt like `awaiting-your-word`
                // is all token characters, so a carry that only expired at EOF would sit on it
                // for as long as the familiar waited — which is the very hang this whole pump
                // was rewritten to avoid.
                emit(&taken, &sink);
                if at_eof {
                    break;
                }
                continue;
            }

            // Output is still flowing, so the tail may be the front of a credential whose rest
            // arrives next tick. Hold it back just long enough to find out.
            let (ready, held) = split_at_safe_boundary(&taken);
            carry = held.to_vec();
            emit(ready, &sink);
        }

        done.store(true, Ordering::SeqCst);
    });
}

/// The longest credential prefix plus the longest body we would still treat as one token.
/// A tail shorter than this cannot be ruled out as the start of a key.
const CARRY_MAX: usize = 128;

/// Split a buffer into what is safe to emit now and what has to wait for the next tick.
///
/// Redaction matches whole tokens, so a key that straddles two ticks matches neither half and
/// reaches the transcript in the clear — a real §11 hole, and one that only shows up under
/// exactly the timing that a long-running familiar produces. So a trailing run of token
/// characters is held back until the next tick proves where it ends.
///
/// The held tail is bounded: past `CARRY_MAX` it cannot be the beginning of anything we
/// recognise, and holding an unbounded run would stall output on a long base64 blob.
fn split_at_safe_boundary(buf: &[u8]) -> (&[u8], &[u8]) {
    let is_token = |b: u8| {
        b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || b == b'~' || b == b'+'
    };

    let mut start = buf.len();
    while start > 0 && is_token(buf[start - 1]) && buf.len() - start < CARRY_MAX {
        start -= 1;
    }
    // A tail that ran to the cap is not a credential we know; let it through rather than stall.
    if buf.len() - start >= CARRY_MAX {
        return (buf, &[]);
    }
    buf.split_at(start)
}

/// Redact, then emit in pieces no larger than [`MAX_CHUNK`].
fn emit(bytes: &[u8], sink: &Sink) {
    if bytes.is_empty() {
        return;
    }
    // Redaction happens here, once, at the only point PTY output enters the application (§11).
    let clean = redact(bytes);
    for piece in clean.chunks(MAX_CHUNK) {
        sink(piece.to_vec());
    }
}

/// Build the environment a familiar runs with.
///
/// Allow-list, not deny-list. Inheriting the whole environment and removing the names we happen
/// to recognise would leak every one we did not think of, so the default is to pass nothing and
/// name what gets through.
///
/// **The first version of this list was too short, and a real engine caught it.** Started with
/// only the shell basics, `claude` came up on its login screen: it could not reach the network,
/// because the proxy and CA settings had been stripped, and it had no provider credentials,
/// because those live in the environment for anyone not signed in through the keychain. An
/// engine that cannot authenticate is not a security win; it is a familiar that does nothing.
///
/// So three groups get through, and nothing else:
///
/// * **Shell basics** — where home is, what is on PATH, which locale to format in.
/// * **Reachability** — proxy and CA-bundle settings. These carry no secrets, and without them
///   an engine on a proxied or corporate network simply cannot make a request.
/// * **Provider credentials** — the variables each engine defines for its own auth. §11 requires
///   that *Grimoire* never stores a key, logs one, or puts one in an error message, and it does
///   none of those: these are read straight from the environment the user already has, passed to
///   the one process entitled to them, and never touched again. On macOS, where `claude` signs
///   in through the keychain by itself, none of them will be set and none will be passed.
///
/// Anything outside those groups does not reach the familiar, including names that do not exist
/// yet. `extra` is appended last, so a binding can add to its own environment but never smuggle
/// something in ahead of the list.
pub fn scrubbed_env(
    inherited: impl IntoIterator<Item = (String, String)>,
    extra: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    /// Where home is, what is runnable, how to format.
    const BASICS: &[&str] = &[
        "HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR",
    ];

    /// How to reach the network. No secrets here — addresses and certificate paths.
    const REACHABILITY: &[&str] = &[
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "all_proxy", "no_proxy",
        "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "AWS_CA_BUNDLE",
    ];

    /// Each engine's own auth. Passed through, never stored, never logged.
    const PROVIDER: &[&str] = &[
        // Anthropic, direct or through a gateway.
        "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
        // Amazon Bedrock.
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
        "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
        // Google Vertex.
        "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUD_ML_REGION",
        // The other engines' keys, for when §4's other values can be summoned.
        "OPENAI_API_KEY", "OPENAI_BASE_URL", "GEMINI_API_KEY", "DASHSCOPE_API_KEY",
    ];

    let allowed = |k: &str| {
        BASICS.contains(&k) || REACHABILITY.contains(&k) || PROVIDER.contains(&k)
    };

    let mut env: Vec<(String, String)> =
        inherited.into_iter().filter(|(k, _)| allowed(k)).collect();

    // A terminal type xterm.js renders faithfully, and truecolour so the engine's own palette
    // survives rather than being quantised to sixteen colours.
    env.push(("TERM".into(), "xterm-256color".into()));
    env.push(("COLORTERM".into(), "truecolor".into()));
    // Say who is asking, so an engine that wants to behave differently under a harness can.
    env.push(("GRIMOIRE".into(), "1".into()));

    env.extend(extra);
    env
}
