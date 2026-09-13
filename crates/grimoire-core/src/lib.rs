//! Grimoire core.
//!
//! Everything that is not Tauri glue lives here: the PTY lifecycle, the breaker, the seal's
//! path checks, wards, the ledger. Keeping it out of `src-tauri` means `cargo test` runs the
//! interesting code in seconds without linking a webview. Module names follow §5.
//! See DECISIONS.md 0001.

pub mod binding;
pub mod breaker;
pub mod codex;
pub mod commission;
pub mod db;
pub mod error;
pub mod ledger;
pub mod paths;
pub mod seal;
pub mod security;
pub mod summon;
pub mod types;
pub mod ward;

pub use db::Db;
pub use error::{Error, Result};
pub use paths::Paths;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
