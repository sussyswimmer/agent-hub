//! Finding the engine's binary, and saying why when it is not there (§6.1).

use std::path::{Path, PathBuf};

use crate::types::Engine;

/// Where a binary came from, so the workbench can show it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    /// An explicit path from the workbench, used as given.
    Workbench(PathBuf),
    /// Found by walking `PATH`.
    OnPath(PathBuf),
}

impl Resolved {
    pub fn path(&self) -> &Path {
        match self {
            Resolved::Workbench(p) | Resolved::OnPath(p) => p,
        }
    }
}

/// Why Summon is disabled. These strings reach the button's hover text, so they are written
/// to be read by a person, not parsed (§3: say what happened and what to do).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unavailable(pub String);

/// Resolve the binary for an engine.
///
/// The workbench path wins when it is set, because the point of setting it is to override the
/// one on `PATH`. A workbench path that does not exist is an error rather than a silent fall
/// back to `PATH` — falling back would run a different binary than the one that was asked for.
pub fn resolve(
    engine: Engine,
    workbench_path: Option<&str>,
    path_var: Option<&str>,
) -> Result<Resolved, Unavailable> {
    if let Some(raw) = workbench_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(raw);
        return if is_executable(&p) {
            Ok(Resolved::Workbench(p))
        } else {
            Err(Unavailable(format!(
                "The workbench points at {raw}, but there is no runnable file there. \
                 Fix the path in the workbench, or clear it to use the one on PATH."
            )))
        };
    }

    let name = engine.binary();
    if name.is_empty() {
        return Err(Unavailable(
            "A custom engine needs its binary set in the workbench.".into(),
        ));
    }

    let path = path_var.unwrap_or_default();
    for dir in path.split(':').filter(|s| !s.is_empty()) {
        let candidate = Path::new(dir).join(name);
        if is_executable(&candidate) {
            return Ok(Resolved::OnPath(candidate));
        }
    }

    Err(Unavailable(format!(
        "`{name}` is not on your PATH. Install it, or point the workbench at it directly."
    )))
}

/// A regular file the current user may execute. Checked rather than assumed, so a directory
/// named `claude` on PATH does not shadow the real one.
fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(p) {
            Ok(m) => m.is_file() && m.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn make_exe(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, "#!/bin/sh\n").expect("write");
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        p
    }

    #[test]
    fn path_lookup_finds_the_first_match_and_skips_directories() {
        let tmp = tempfile::tempdir().expect("tmp");
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        // A *directory* called `claude` in the first slot must not win.
        std::fs::create_dir_all(a.join("claude")).unwrap();
        let real = make_exe(&b, "claude");

        let path = format!("{}:{}", a.display(), b.display());
        assert_eq!(resolve(Engine::Claude, None, Some(&path)), Ok(Resolved::OnPath(real)));
    }

    #[test]
    fn a_file_without_the_execute_bit_is_not_a_binary() {
        let tmp = tempfile::tempdir().expect("tmp");
        std::fs::write(tmp.path().join("claude"), "not runnable").unwrap();
        let path = tmp.path().display().to_string();
        assert!(resolve(Engine::Claude, None, Some(&path)).is_err());
    }

    #[test]
    fn the_workbench_path_wins_and_never_falls_back_to_path() {
        let tmp = tempfile::tempdir().expect("tmp");
        let on_path = make_exe(tmp.path(), "claude");
        let path = tmp.path().display().to_string();

        // Set and good: used as given.
        let chosen = make_exe(tmp.path(), "claude-nightly");
        assert_eq!(
            resolve(Engine::Claude, Some(chosen.to_str().unwrap()), Some(&path)),
            Ok(Resolved::Workbench(chosen))
        );

        // Set and bad: an error naming the path, *not* a quiet fall back to `on_path`. Running
        // a different binary than the one the workbench names would be a nasty surprise.
        let err = resolve(Engine::Claude, Some("/nowhere/claude"), Some(&path)).unwrap_err();
        assert!(err.0.contains("/nowhere/claude"), "{}", err.0);
        assert!(!err.0.contains(on_path.to_str().unwrap()));
    }

    #[test]
    fn a_missing_binary_says_what_to_do() {
        let err = resolve(Engine::Claude, None, Some("/nonexistent")).unwrap_err();
        assert!(err.0.contains("not on your PATH"), "{}", err.0);
        assert!(err.0.contains("workbench"), "{}", err.0);
    }

    #[test]
    fn a_custom_engine_without_a_workbench_path_cannot_resolve() {
        assert!(resolve(Engine::Custom, None, Some("/usr/bin")).is_err());
    }
}
