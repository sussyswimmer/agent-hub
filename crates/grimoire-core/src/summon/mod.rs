//! Summoning: finding the engine, running it in a pseudo-terminal, and stopping it cleanly
//! (§6.1).
//!
//! The seal is *not* here, and cannot be. A familiar in a pty performs its own writes; there is
//! no byte on the wire to intercept. It is enforced through the engine's own pre-execution
//! hook — see DECISIONS.md 0004 for the mechanism, the evidence, and the two ways it can fail
//! open if it is built carelessly. Phase 4 hangs off `hook_settings` below.

pub mod binary;
pub mod handover;
pub mod lifecycle;
pub mod pty;
pub mod usage;

pub use binary::{Resolved, Unavailable, resolve};
pub use handover::{PasteMode, initial_prompt, keystrokes};
pub use lifecycle::{Stopped, group_alive, stop, stop_with};
pub use portable_pty::PtySize;
pub use pty::{PtySession, Sink, Spawn, scrubbed_env};
pub use usage::Usage;

/// Where Phase 4 writes the per-summoning settings file that installs the seal's `PreToolUse`
/// hook, passed to the engine with `--settings`. Named here so the shape of the spawn does not
/// have to change when the seal arrives.
pub fn hook_settings_path(run_dir: &std::path::Path) -> std::path::PathBuf {
    run_dir.join("seal-hook.json")
}
