//! Types crossing the IPC boundary. Defined once here, exported to TypeScript by ts-rs
//! (`bun run bindings`) so the two sides cannot drift. §3's nouns are the identifiers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// §3: the five orders. Each sets a sigil colour and a default writ preamble.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Order {
    Quill,
    Lantern,
    Crucible,
    Compass,
    Ledger,
}

/// §7.4. Drives both the rail and, from Phase 5, the floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum SigilState {
    Dormant,
    Idle,
    Working,
    AwaitingSeal,
    Bound,
    Stalled,
    Banished,
    Misfired,
}

/// §4. `custom` covers a binary the workbench points at directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Engine {
    Claude,
    Codex,
    Gemini,
    Qwen,
    Custom,
}

impl Engine {
    /// The binary looked up on PATH.
    pub fn binary(self) -> &'static str {
        match self {
            Engine::Claude => "claude",
            Engine::Codex => "codex",
            Engine::Gemini => "gemini",
            Engine::Qwen => "qwen",
            Engine::Custom => "",
        }
    }

    /// Whether the seal can actually be enforced for this engine (DECISIONS.md 0004).
    /// Only `claude` exposes a pre-execution hook, so only `claude` can be summoned in v1.
    pub fn sealable(self) -> bool {
        matches!(self, Engine::Claude)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Isolation {
    #[default]
    None,
    Worktree,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Autonomy {
    /// The default, and deliberately the most cautious rung (§6.4). A binding that forgets to
    /// say gets the one that asks before acting, never the one that acts freely.
    #[default]
    Propose,
    Bounded,
    Free,
}

/// What the roster rail draws for one familiar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FamiliarSummary {
    pub id: String,
    pub name: String,
    pub order: Order,
    pub engine: Engine,
    pub state: SigilState,
    /// One line under the name in the rail.
    pub status: String,
    /// The familiar's cwd, shown in the pane header. `~` is kept unexpanded for display.
    pub workspace: String,
    /// Set when the binding failed to validate; shown inline in oxblood (§4).
    pub error: Option<String>,
    /// Non-fatal complaints, such as unknown frontmatter keys (§4).
    pub warnings: Vec<String>,
    /// `None` when the familiar can be summoned; otherwise why the button is disabled (§6.1).
    pub cannot_summon: Option<String>,
    pub binding_path: String,
    /// The workspace is not a folder on this machine, so a summon would fail. The pane offers
    /// to choose one (DECISIONS 0028).
    pub workspace_missing: bool,
}

/// The three aether meters (§6.5). `max` is `None` when the binding sets no budget.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Aether {
    #[ts(type = "number")]
    pub tokens: i64,
    #[ts(type = "number | null")]
    pub tokens_max: Option<i64>,
    #[ts(type = "number")]
    pub turns: i64,
    #[ts(type = "number | null")]
    pub turns_max: Option<i64>,
    #[ts(type = "number")]
    pub seconds: i64,
    #[ts(type = "number | null")]
    pub seconds_max: Option<i64>,
}
