//! Where Quintet keeps user data. Mirrors `CLAUDE.md` §2.3.
//!
//! `QUINTET_HOME` overrides `~/Quintet` so tests and the Linux build can run in a temp dir.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuintetPaths {
    pub home: PathBuf,
}

impl QuintetPaths {
    /// `$QUINTET_HOME` if set (and non-empty), else `~/Quintet`.
    pub fn resolve() -> Result<Self> {
        if let Some(v) = std::env::var_os("QUINTET_HOME") {
            if !v.is_empty() {
                return Ok(Self { home: PathBuf::from(v) });
            }
        }
        let home_dir = std::env::home_dir()
            .ok_or_else(|| CoreError::other("cannot determine the home directory"))?;
        Ok(Self { home: home_dir.join("Quintet") })
    }

    pub fn at(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn agents(&self) -> PathBuf { self.home.join("agents") }
    pub fn agent_dir(&self, id: &str) -> PathBuf { self.agents().join(id) }
    pub fn agent_md(&self, id: &str) -> PathBuf { self.agent_dir(id).join("agent.md") }
    pub fn memory_md(&self, id: &str) -> PathBuf { self.agent_dir(id).join("memory.md") }
    pub fn workspace(&self, id: &str) -> PathBuf { self.agent_dir(id).join("workspace") }
    pub fn outputs(&self) -> PathBuf { self.home.join("outputs") }
    pub fn shared(&self) -> PathBuf { self.home.join("shared") }
    pub fn profile_md(&self) -> PathBuf { self.shared().join("profile.md") }
    pub fn data(&self) -> PathBuf { self.home.join("data") }
    pub fn db_file(&self) -> PathBuf { self.data().join("quintet.db") }
    pub fn logs_runs(&self) -> PathBuf { self.home.join("logs").join("runs") }
    pub fn backups(&self) -> PathBuf { self.home.join("backups") }

    /// Create every top-level directory. Idempotent.
    pub fn ensure_dirs(&self) -> Result<()> {
        for d in [
            self.agents(),
            self.outputs(),
            self.shared(),
            self.data(),
            self.logs_runs(),
            self.backups(),
        ] {
            std::fs::create_dir_all(&d).map_err(|e| CoreError::io(&d, e))?;
        }
        Ok(())
    }
}

/// Path of `agents/<id>/memory.md` as the absolute form Claude Code's `Edit(//…)` rule needs.
pub fn absolute(p: &Path) -> Result<PathBuf> {
    if p.is_absolute() {
        Ok(p.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(p))
            .map_err(|e| CoreError::io(p, e))
    }
}
