//! The shape of a `.binding.md` frontmatter (§4).
//!
//! One rule shapes the whole file: **an unknown key is a warning, not an error** (§4). So there
//! is no blanket `deny_unknown_fields` anywhere here. Instead the frontmatter is parsed twice —
//! once into these types, once into a generic map — and the difference is reported as warnings.
//! A binding with a typo in it still loads and still works; it just says so.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::types::{Autonomy, Engine, Isolation, Order};

/// What a familiar may read from the shared reliquary (§6.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Reliquary {
    #[default]
    None,
    Read,
    Write,
}

/// Whether to reattach to the engine's prior session on summon (§4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Resume {
    #[default]
    None,
    Session,
}

/// What to do when a budget runs out (§6.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum OnExceed {
    Steer,
    #[default]
    Bind,
    Banish,
}

/// What a familiar may touch, read only when `autonomy: bounded` (§6.4).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bounds {
    #[serde(default)]
    pub write: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub shell: Vec<String>,
}

/// Per-commission budgets (§6.5). Absent means unmetered, which is why each is an `Option`
/// rather than a zero — a zero budget and no budget are opposite instructions.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AetherBudget {
    #[ts(type = "number | null")]
    #[serde(default)]
    pub tokens: Option<i64>,
    #[ts(type = "number | null")]
    #[serde(default)]
    pub turns: Option<i64>,
    #[ts(type = "number | null")]
    #[serde(default)]
    pub minutes: Option<i64>,
    #[serde(default)]
    pub on_exceed: OnExceed,
}

/// One intake question (§6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum IntakeKind {
    #[default]
    Text,
    Select,
    Multiline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IntakeField {
    pub id: String,
    pub ask: String,
    #[serde(rename = "type", default)]
    pub kind: IntakeKind,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub required: bool,
}

/// The frontmatter of a binding, before any path expansion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BindingFrontmatter {
    pub name: String,
    pub order: Order,
    #[serde(default)]
    pub sigil: Option<String>,
    pub engine: Engine,
    #[serde(default)]
    pub model: Option<String>,
    pub workspace: String,
    #[serde(default)]
    pub isolation: Isolation,
    #[serde(default)]
    pub resume: Resume,
    #[serde(default)]
    pub autonomy: Autonomy,
    #[serde(default)]
    pub bounds: Bounds,
    #[serde(default)]
    pub aether: AetherBudget,
    #[serde(default)]
    pub codex: Option<String>,
    #[serde(default)]
    pub reliquary: Reliquary,
    #[serde(default)]
    pub intake: Vec<IntakeField>,
    /// The one coordinating familiar (§6.8). It may propose, never dispatch.
    #[serde(default)]
    pub archivist: bool,
}

/// Every key this schema knows. Used to tell an unknown key from a known one, because serde's
/// own unknown-field error is fatal and §4 wants a warning.
pub const KNOWN_KEYS: &[&str] = &[
    "name", "order", "sigil", "engine", "model", "workspace", "isolation", "resume", "autonomy",
    "bounds", "aether", "codex", "reliquary", "intake", "archivist",
];

pub const KNOWN_BOUNDS_KEYS: &[&str] = &["write", "deny", "network", "shell"];
pub const KNOWN_AETHER_KEYS: &[&str] = &["tokens", "turns", "minutes", "on_exceed"];
pub const KNOWN_INTAKE_KEYS: &[&str] = &["id", "ask", "type", "options", "required"];
