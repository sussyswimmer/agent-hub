//! The hardcoded roster Phase 0 draws the shell with. Deleted in Phase 2, when the bindings
//! folder becomes the source of truth. Names are the five seeds from §4.

use grimoire_core::types::{Engine, FamiliarSummary, Order, SigilState};

fn f(id: &str, name: &str, order: Order, engine: Engine, state: SigilState, status: &str, workspace: &str) -> FamiliarSummary {
    FamiliarSummary {
        id: id.into(),
        name: name.into(),
        order,
        engine,
        state,
        status: status.into(),
        workspace: workspace.into(),
        error: None,
        warnings: vec![],
        cannot_summon: (!engine.sealable())
            .then(|| format!("Only the claude engine can be sealed. {name} is bound to {}.", engine.binary())),
        binding_path: format!("~/.grimoire/bindings/{id}.binding.md"),
    }
}

pub fn placeholder() -> Vec<FamiliarSummary> {
    vec![
        f("vellum", "Vellum", Order::Quill, Engine::Claude, SigilState::Idle, "idle", "~/work/essays"),
        f("sconce", "Sconce", Order::Lantern, Engine::Claude, SigilState::Working, "reading · 6 sources", "~/work/research"),
        f("astrolabe", "Astrolabe", Order::Compass, Engine::Claude, SigilState::AwaitingSeal, "waiting on your seal", "~/work/planning"),
        f("anvil", "Anvil", Order::Crucible, Engine::Claude, SigilState::Dormant, "dormant", "~/src/grimoire"),
        f("tally", "Tally", Order::Ledger, Engine::Claude, SigilState::Dormant, "dormant", "~/work/numbers"),
    ]
}
