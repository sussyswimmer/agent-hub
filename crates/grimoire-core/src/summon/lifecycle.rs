//! Ending a summoning without leaving anything behind (§6.1).
//!
//! A familiar is rarely one process. `claude` spawns shells, and those spawn compilers and test
//! runners. Signalling the child alone orphans everything under it, and orphaned build jobs go
//! on burning the machine long after their familiar has gone from the rail.
//!
//! So every signal goes to the process **group**. `portable-pty` calls `setsid` in the child, so
//! the child leads a new session and a new group whose id is its own pid, and `killpg` reaches
//! the whole tree in one call.
//!
//! The ladder is patient before it is forceful:
//!
//! | Step | Signal | Then wait | Why |
//! | --- | --- | --- | --- |
//! | 1 | `SIGINT` | 5s | What ctrl-C sends. An interactive CLI takes it as "stop", saves its session and exits tidily. |
//! | 2 | `SIGTERM` | 3s | Politely fatal. Catches anything that ignored the interrupt but still has a handler. |
//! | 3 | `SIGKILL` | — | Cannot be caught. The last resort, and it always works. |

use std::time::{Duration, Instant};

use crate::error::Result;
use crate::summon::pty::PtySession;

pub const INTERRUPT_GRACE: Duration = Duration::from_secs(5);
pub const TERMINATE_GRACE: Duration = Duration::from_secs(3);

/// How far down the ladder it was necessary to go. Worth recording in the ledger: a familiar
/// that routinely needs `SIGKILL` is misbehaving, and that is invisible if every stop is
/// reported the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stopped {
    /// It had already exited before we signalled anything.
    Already,
    Interrupt,
    Terminate,
    Kill,
}

/// Walk the ladder until the process group is gone.
pub fn stop(session: &PtySession) -> Result<Stopped> {
    stop_with(session, INTERRUPT_GRACE, TERMINATE_GRACE)
}

/// The ladder with explicit waits, so a test does not take eight seconds to run.
pub fn stop_with(session: &PtySession, interrupt: Duration, terminate: Duration) -> Result<Stopped> {
    if session.try_wait()?.is_some() {
        return Ok(Stopped::Already);
    }

    let pid = session.pid();

    signal_group(pid, libc::SIGINT);
    if wait_for_exit(session, interrupt)? {
        return Ok(Stopped::Interrupt);
    }

    signal_group(pid, libc::SIGTERM);
    if wait_for_exit(session, terminate)? {
        return Ok(Stopped::Terminate);
    }

    signal_group(pid, libc::SIGKILL);
    // SIGKILL cannot be caught or ignored, but the exit still has to be reaped before the
    // process leaves the table. Block for the child we own.
    session.wait()?;
    // Grandchildren are a different matter. We killed them too, but their parent is now dead,
    // so they are reparented to init and stay in the process table as zombies until init
    // reaps them. Nothing is running, yet the group id still resolves. Give that a bounded
    // moment to settle so callers are not told a corpse is alive; never block on it, because
    // reaping is init's job and not something we control.
    drain_group(pid, ZOMBIE_DRAIN);
    Ok(Stopped::Kill)
}

/// How long to let a killed group's zombies clear before giving up on tidiness.
pub const ZOMBIE_DRAIN: Duration = Duration::from_secs(2);

/// Poll until the group has no table entry left, or `grace` runs out. Returns whether it cleared.
pub fn drain_group(pid: u32, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if !group_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !group_alive(pid)
}

/// Send `sig` to the whole process group led by `pid`.
///
/// Falls back to signalling the process alone if the group has already gone (ESRCH), which
/// happens when the leader exited while its children were still being reaped.
fn signal_group(pid: u32, sig: i32) {
    // Safety: killpg and kill take a pid and a signal number and touch no memory we own. A
    // failure is reported in the return value, and every failure here is benign — the only
    // ways this call fails are "no such group" and "not permitted", and in both cases the
    // ladder's next step or the final wait handles it.
    unsafe {
        if libc::killpg(pid as libc::pid_t, sig) == -1 {
            libc::kill(pid as libc::pid_t, sig);
        }
    }
}

/// Poll for exit until `grace` runs out. Polling rather than blocking, because the whole point
/// is to give up after a bounded wait.
fn wait_for_exit(session: &PtySession, grace: Duration) -> Result<bool> {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if session.try_wait()?.is_some() {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(session.try_wait()?.is_some())
}

/// Whether the process group led by `pid` still has any entry in the process table.
///
/// `killpg` with signal 0 performs the permission and existence checks and sends nothing, which
/// is the standard way to ask. A test asserting "no orphans" needs this; so does the restore
/// path, which must not adopt a group that is already gone.
///
/// Note what this does *not* distinguish: a zombie counts as present. A killed grandchild whose
/// parent has already died is reparented to init and sits in the table until init reaps it, so
/// this can briefly report `true` for a group in which nothing is running. [`drain_group`] is
/// the bounded wait for that to settle.
pub fn group_alive(pid: u32) -> bool {
    // Safety: signal 0 delivers nothing. See above.
    unsafe { libc::killpg(pid as libc::pid_t, 0) == 0 }
}
