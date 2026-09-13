//! Path allow-lists and bounds enforcement (§6.4, §11). Arrives in Phase 4.
//!
//! The seal is enforced through the engine's own pre-execution hook, not by intercepting the
//! PTY — a CLI in a pseudo-terminal performs its own writes and there is no byte on the wire to
//! catch. See DECISIONS.md 0004 for the mechanism and its two failure modes.
