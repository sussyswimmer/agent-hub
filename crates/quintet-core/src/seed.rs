//! First-launch seeding of `~/Quintet/` from the shipped defaults. Never overwrites user files.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::paths::QuintetPaths;

/// Where the shipped defaults live. In the repo: `agents-default/` and `shared-default/profile.md`.
/// In the bundled app: the Tauri resource dir (Tauri maps `../agents-default` to `_up_/agents-default`).
#[derive(Debug, Clone)]
pub struct SeedSource {
    pub agents_dir: PathBuf,
    pub profile_md: PathBuf,
}

impl SeedSource {
    /// Defaults relative to a root that contains `agents-default/` and `shared-default/`.
    pub fn from_root(root: impl AsRef<Path>) -> Self {
        let root = root.as_ref();
        Self {
            agents_dir: root.join("agents-default"),
            profile_md: root.join("shared-default").join("profile.md"),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SeedReport {
    pub agents_created: Vec<String>,
    pub profile_created: bool,
}

/// Copy each default agent folder that does not exist yet, ensure `workspace/`, seed `shared/profile.md`.
pub fn seed(src: &SeedSource, paths: &QuintetPaths) -> Result<SeedReport> {
    paths.ensure_dirs()?;
    let mut report = SeedReport::default();

    let entries = std::fs::read_dir(&src.agents_dir).map_err(|e| CoreError::io(&src.agents_dir, e))?;
    let mut ids: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir() && e.path().join("agent.md").is_file())
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .collect();
    ids.sort();

    for id in ids {
        let dest = paths.agent_dir(&id);
        if !dest.exists() {
            std::fs::create_dir_all(&dest).map_err(|e| CoreError::io(&dest, e))?;
            for name in ["agent.md", "memory.md"] {
                let from = src.agents_dir.join(&id).join(name);
                if from.is_file() {
                    let to = dest.join(name);
                    std::fs::copy(&from, &to).map_err(|e| CoreError::io(&to, e))?;
                }
            }
            report.agents_created.push(id.clone());
        }
        // Always make sure the memory file and workspace exist, even for user-created agents.
        let mem = paths.memory_md(&id);
        if !mem.exists() {
            std::fs::write(&mem, DEFAULT_MEMORY).map_err(|e| CoreError::io(&mem, e))?;
        }
        let ws = paths.workspace(&id);
        std::fs::create_dir_all(&ws).map_err(|e| CoreError::io(&ws, e))?;
    }

    let profile = paths.profile_md();
    if !profile.exists() && src.profile_md.is_file() {
        std::fs::copy(&src.profile_md, &profile).map_err(|e| CoreError::io(&profile, e))?;
        report.profile_created = true;
    }
    Ok(report)
}

pub const DEFAULT_MEMORY: &str = "---\n---\n# Memory\n\nDurable preferences and learnings only. Keep this file under 200 lines.\n";
