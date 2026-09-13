//! Everything Grimoire owns lives under `~/.grimoire`. `GRIMOIRE_HOME` overrides it so tests
//! and a second install never touch the real one.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub home: PathBuf,
}

impl Paths {
    pub fn resolve() -> Result<Self> {
        if let Some(v) = std::env::var_os("GRIMOIRE_HOME")
            && !v.is_empty()
        {
            return Ok(Self { home: PathBuf::from(v) });
        }
        let home = std::env::home_dir().ok_or_else(|| Error::other("cannot determine your home directory"))?;
        Ok(Self { home: home.join(".grimoire") })
    }

    pub fn at(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn bindings(&self) -> PathBuf {
        self.home.join("bindings")
    }
    pub fn codex_dir(&self) -> PathBuf {
        self.home.join("codex")
    }
    pub fn reliquary(&self) -> PathBuf {
        self.home.join("reliquary.md")
    }
    pub fn worktrees(&self) -> PathBuf {
        self.home.join("worktrees")
    }
    pub fn transcripts(&self) -> PathBuf {
        self.home.join("transcripts")
    }
    pub fn db_file(&self) -> PathBuf {
        self.home.join("grimoire.db")
    }
    /// Where the seal listens, and where each summoning's hook connects (§6.4).
    pub fn seal_socket(&self) -> PathBuf {
        self.home.join("seal.sock")
    }
    /// Per-summoning settings files, which is how the hook is installed without touching the
    /// owner's own engine configuration.
    pub fn summon_dir(&self) -> PathBuf {
        self.home.join("summonings")
    }

    /// Create every directory Grimoire writes to. Idempotent.
    pub fn ensure(&self) -> Result<()> {
        for d in [self.bindings(), self.codex_dir(), self.worktrees(), self.transcripts(), self.summon_dir()] {
            std::fs::create_dir_all(&d).map_err(|e| Error::io(&d, e))?;
        }
        Ok(())
    }
}

/// Expand a leading `~`, then resolve relatives against `base` (§4: relative paths resolve
/// against the bindings folder). Does not touch the filesystem, so it works for paths that
/// do not exist yet; canonicalisation for security checks is a separate step in `security`.
pub fn expand(raw: &str, base: &Path) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = std::env::home_dir() {
            return home.join(rest);
        }
    } else if trimmed == "~"
        && let Some(home) = std::env::home_dir()
    {
        return home;
    }
    let p = Path::new(trimmed);
    if p.is_absolute() { p.to_path_buf() } else { base.join(p) }
}
