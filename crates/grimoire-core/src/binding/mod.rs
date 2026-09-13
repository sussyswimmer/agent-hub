//! Bindings: familiars are files (§4).
//!
//! A familiar is a markdown file with YAML frontmatter in `~/.grimoire/bindings/`. There is no
//! in-app editor and there is not meant to be one — the file is the source of truth, the folder
//! is watched, and an edit reaches the rail without a restart.

pub mod parse;
pub mod schema;
pub mod seed;
pub mod watch;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub use parse::{Binding, id_for, is_binding_file, load, parse};
pub use schema::BindingFrontmatter;
pub use watch::{WatchHandle, watch};

use crate::paths::expand;
use crate::types::{Engine, FamiliarSummary, SigilState};

/// Every binding in a folder, keyed by id so the rail keeps a stable order.
///
/// A folder that does not exist yet is not an error — it is the state on first launch, before
/// anything has been written into it, and an empty roster is what the interface should show.
pub fn load_folder(folder: &Path) -> BTreeMap<String, Binding> {
    let mut out = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(folder) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_binding_file(&path) {
            let b = load(&path);
            out.insert(b.id.clone(), b);
        }
    }
    out
}

/// Turn a binding into the row the rail draws (§7.5).
///
/// A broken binding still produces a row. §4 is explicit that it appears in oxblood with the
/// error inline, never dropped — a familiar vanishing from the rail because of a typo is a much
/// worse failure than one sitting there saying what is wrong with it.
pub fn summarise(binding: &Binding) -> FamiliarSummary {
    let Some(front) = &binding.front else {
        return FamiliarSummary {
            id: binding.id.clone(),
            name: binding.display_name(),
            // A binding too broken to name an order still needs one to draw with.
            order: crate::types::Order::Ledger,
            engine: Engine::Custom,
            state: SigilState::Misfired,
            status: "this binding could not be read".into(),
            workspace: String::new(),
            error: binding.error.clone(),
            warnings: binding.warnings.clone(),
            cannot_summon: Some("Fix the binding before summoning this familiar.".into()),
            binding_path: binding.path.display().to_string(),
        };
    };

    // DECISIONS.md 0004: only `claude` exposes a pre-execution hook, so only `claude` can be
    // held to the seal. The others parse and list, with the reason on hover rather than a
    // button that pretends to work.
    let cannot_summon = (!front.engine.sealable()).then(|| {
        format!(
            "Only the claude engine can be sealed, so {} cannot be summoned yet. \
             See DECISIONS.md 0004.",
            binding.display_name()
        )
    });

    FamiliarSummary {
        id: binding.id.clone(),
        name: front.name.clone(),
        order: front.order,
        engine: front.engine,
        state: SigilState::Dormant,
        status: "dormant".into(),
        // Kept as written rather than expanded: `~/work/essays` is what the author typed and
        // what they will recognise in the header.
        workspace: front.workspace.clone(),
        error: None,
        warnings: binding.warnings.clone(),
        cannot_summon,
        binding_path: binding.path.display().to_string(),
    }
}

/// The familiar's working directory, with `~` expanded and relatives resolved against the
/// bindings folder (§4).
pub fn workspace_path(front: &BindingFrontmatter, bindings_dir: &Path) -> PathBuf {
    expand(&front.workspace, bindings_dir)
}
