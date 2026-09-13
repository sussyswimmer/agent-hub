//! The end of the socket that decides (§6.4, §11).
//!
//! A hook connects, sends what its familiar is about to do, and waits. This looks the action up
//! against the binding's autonomy and bounds, and either answers straight away or raises a
//! request and holds the connection open until the owner deals with it.
//!
//! Holding the connection is what makes the seal a gate rather than a notification. The engine
//! is blocked inside its own tool call for as long as this takes, so nothing happens while the
//! question is open — which is precisely §6.4's "the summoning pauses".

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use crate::db::Db;
use crate::error::{Error, Result};
use crate::seal::protocol::{Request, Response};
use crate::seal::{Resolution, SealKind};
use crate::security::{self, Action, Verdict};

/// What the server needs to know about a live summoning to judge its actions.
#[derive(Debug, Clone)]
pub struct Summoned {
    pub familiar_id: String,
    pub familiar_name: String,
    pub commission_id: Option<String>,
    pub autonomy: crate::types::Autonomy,
    pub bounds: crate::binding::schema::Bounds,
    pub workspace: PathBuf,
}

/// The live summonings, by the engine session id the hook reports.
pub type Sessions = Arc<Mutex<HashMap<String, Summoned>>>;

/// A request waiting on the owner, and the way to answer it.
struct Waiting {
    decided: mpsc::Sender<Resolution>,
}

/// The application's side of the seal.
/// Called whenever the queue changes, so the interface can ask again.
///
/// A nudge rather than the rows themselves: the queue has one source of truth, and this only
/// says that it moved.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

pub struct Server {
    db: Db,
    sessions: Sessions,
    waiting: Arc<Mutex<HashMap<String, Waiting>>>,
    socket: PathBuf,
    on_change: Mutex<Option<OnChange>>,
}

impl Server {
    /// Start listening. The socket is removed first: a file left by a crashed run would
    /// otherwise make every future start fail, and a seal that cannot start is one that denies
    /// everything.
    pub fn start(db: Db, sessions: Sessions, socket: &Path) -> Result<Arc<Self>> {
        if let Some(parent) = socket.parent() {
            std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        }
        let _ = std::fs::remove_file(socket);

        let listener = UnixListener::bind(socket).map_err(|e| Error::io(socket, e))?;
        // The socket is a way to be asked for permission; only its owner should be able to use
        // it. Nothing else on the machine has business answering for this person.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600));
        }

        let server = Arc::new(Self {
            db,
            sessions,
            waiting: Arc::default(),
            socket: socket.to_path_buf(),
            on_change: Mutex::new(None),
        });

        let accepting = Arc::clone(&server);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let s = Arc::clone(&accepting);
                        // One thread per hook: each blocks until its own question is answered,
                        // and several familiars may be waiting at once.
                        std::thread::spawn(move || s.serve(stream));
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "a hook could not be accepted");
                    }
                }
            }
        });

        tracing::info!(socket = %socket.display(), "the seal is listening");
        Ok(server)
    }

    pub fn socket(&self) -> &Path {
        &self.socket
    }

    /// Be told when the queue moves. Set once, at startup.
    pub fn on_change(&self, f: OnChange) {
        if let Ok(mut slot) = self.on_change.lock() {
            *slot = Some(f);
        }
    }

    fn changed(&self) {
        if let Ok(slot) = self.on_change.lock()
            && let Some(f) = slot.as_ref()
        {
            f();
        }
    }

    /// Handle one hook, start to finish.
    fn serve(&self, stream: UnixStream) {
        let mut reader = BufReader::new(match stream.try_clone() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "a hook connection could not be read");
                return;
            }
        });
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            return;
        }

        let response = match serde_json::from_str::<Request>(line.trim()) {
            Ok(request) => self.judge(&request),
            // A hook that sends something unreadable gets a refusal, not the benefit of the
            // doubt. The hook itself also fails closed, so this is the second of two.
            Err(e) => Response::deny(format!("Grimoire could not read that request ({e}), so it is refused.")),
        };

        let mut out = stream;
        let mut reply = serde_json::to_string(&response).unwrap_or_else(|_| {
            r#"{"decision":"deny","reason":"the answer could not be encoded"}"#.to_string()
        });
        reply.push('\n');
        let _ = out.write_all(reply.as_bytes());
        let _ = out.flush();
    }

    /// Decide one action: the law, then the queue.
    fn judge(&self, request: &Request) -> Response {
        let action = security::from_tool(&request.tool_name, &request.tool_input);

        // A session Grimoire does not know about is one it did not start. Refuse: answering for
        // a familiar we cannot identify would mean approving on behalf of a stranger.
        let Some(summoned) = self.sessions.lock().ok().and_then(|s| s.get(&request.session_id).cloned()) else {
            return Response::deny(
                "Grimoire does not recognise this session, so it cannot judge what it is doing. \
                 Refused.",
            );
        };

        let ctx = security::Context {
            autonomy: summoned.autonomy,
            bounds: &summoned.bounds,
            workspace: &summoned.workspace,
            home: None,
        };

        let reason = match security::decide(&action, &ctx) {
            Verdict::Allow => return Response::permitted(),
            Verdict::Seal(reason) => reason,
        };
        // The content a write is about to put on disk, so the owner sees what they are sealing
        // rather than only where it lands (§6.4: "a diff where one applies").
        let content = written_content(&request.tool_input);

        // It needs asking. Without a commission there is nothing to attach the request to and
        // nothing for "don't ask again" to be scoped to, so it is simply refused.
        let Some(commission_id) = summoned.commission_id.clone() else {
            return Response::deny(format!(
                "{reason} There is no commission running, so there is nothing to seal it against."
            ));
        };

        let kind = crate::seal::kind_of(&action);

        // §6.4's middle button, scoped to this commission only.
        match crate::seal::always_sealed(&self.db, &commission_id, kind) {
            Ok(true) => return Response::sealed_always(),
            Ok(false) => {}
            Err(e) => tracing::warn!(error = %e, "could not check for a standing seal"),
        }

        self.ask(&summoned, &commission_id, kind, &action, &reason, content)
    }

    /// Raise the request and wait for the owner.
    fn ask(
        &self,
        summoned: &Summoned,
        commission_id: &str,
        kind: SealKind,
        action: &Action,
        reason: &str,
        content: Option<String>,
    ) -> Response {
        let preview = content.or_else(|| preview_of(action));
        let seal_id = match crate::seal::raise(&self.db, crate::seal::Raise {
            commission_id,
            familiar_id: &summoned.familiar_id,
            familiar_name: &summoned.familiar_name,
            kind,
            action: &action.describe(),
            reason,
            preview: preview.as_deref(),
        }) {
            Ok(id) => id,
            Err(e) => {
                // Unable even to record the question. Refuse: a request nobody can see is one
                // nobody can answer, and allowing it would be allowing it silently.
                return Response::deny(format!(
                    "Grimoire could not raise this for your seal ({e}), so it is refused."
                ));
            }
        };

        let (tx, rx) = mpsc::channel();
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.insert(seal_id.clone(), Waiting { decided: tx });
        }
        self.changed();

        // Wait, but never for ever. §6.4 gives thirty minutes, after which the request times out
        // into `bind` — which for the familiar in front of it is a refusal.
        let outcome = rx.recv_timeout(crate::seal::TIMEOUT);
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.remove(&seal_id);
        }

        match outcome {
            Ok(Resolution::SealedAlways) => Response::sealed_always(),
            Ok(resolution) if resolution.allows() => Response::sealed(),
            Ok(Resolution::Refused) => Response::deny(format!(
                "Refused. {reason} Do something else, or explain why this is needed and ask again."
            )),
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = crate::seal::resolve(&self.db, &seal_id, Resolution::TimedOut);
                Response::deny(
                    "Nobody answered this within thirty minutes, so it is refused and the \
                     commission is bound. Stop and wait.",
                )
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Response::deny("Grimoire stopped waiting on this, so it is refused.")
            }
        }
    }

    /// Answer a request the owner has just decided. Wakes whichever hook is blocked on it.
    pub fn decide(&self, seal_id: &str, resolution: Resolution) -> Result<crate::seal::Seal> {
        let seal = crate::seal::resolve(&self.db, seal_id, resolution)?;
        self.changed();
        if let Ok(waiting) = self.waiting.lock()
            && let Some(w) = waiting.get(seal_id)
        {
            // The hook may have given up already — its own deadline, or a banished familiar.
            let _ = w.decided.send(resolution);
        }
        Ok(seal)
    }

    /// Time out anything that has been waiting too long. Called on a tick.
    pub fn tick(&self) {
        match crate::seal::expire_stale(&self.db) {
            Ok(expired) => {
                if !expired.is_empty() {
                    self.changed();
                }
                for seal_id in expired {
                    if let Ok(waiting) = self.waiting.lock()
                        && let Some(w) = waiting.get(&seal_id)
                    {
                        let _ = w.decided.send(Resolution::TimedOut);
                    }
                }
            }
            Err(e) => tracing::warn!(error = %e, "could not expire stale seal requests"),
        }
    }

    /// Run [`Server::tick`] every `every` for the life of the application.
    pub fn tick_forever(self: &Arc<Self>, every: Duration) {
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(every);
                me.tick();
            }
        });
    }
}

/// What to show beside the request: the content about to be written, or the command (§6.4).
fn preview_of(action: &Action) -> Option<String> {
    match action {
        Action::Write { .. } => None,
        Action::Shell { command } => Some(command.clone()),
        _ => None,
    }
}

/// The content a write is about to put on disk, pulled out of the tool's own arguments.
///
/// Kept separate from [`Action`], which deliberately carries only what the decision needs. This
/// is for the owner to read, not for the law to weigh.
pub fn written_content(tool_input: &serde_json::Value) -> Option<String> {
    for key in ["content", "new_string", "new_source"] {
        if let Some(text) = tool_input.get(key).and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
    }
    None
}
