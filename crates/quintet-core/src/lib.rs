//! Quintet core.
//!
//! Everything that is not Tauri glue lives here so it can be built and tested on
//! any platform: the agent registry, the `claude -p` runner and stream parser,
//! prompt assembly, and the SQLite state. See `CLAUDE.md` §2 and
//! `docs/decisions/0003-core-crate-split.md`.

pub mod error;

pub use error::CoreError;

/// Crate version, surfaced in Settings and `quintet-mcp doctor`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
