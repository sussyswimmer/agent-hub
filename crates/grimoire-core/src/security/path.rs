//! Deciding whether a path is inside a folder (§11).
//!
//! §11: "Path checks canonicalise first (resolve `..`, symlinks, `~`) and compare against the
//! allow-list after. Test the symlink escape case explicitly."
//!
//! The order is the whole point. Comparing the string first and resolving afterwards lets
//! `~/work/essays/../../.ssh/id_rsa` through a check for `~/work/essays`, and lets a symlink
//! inside the workspace point anywhere on the disk. Both are one line of a familiar's own
//! making, and neither is exotic.

use std::path::{Component, Path, PathBuf};

/// Resolve a path the way the kernel would, component by component.
///
/// `std::fs::canonicalize` refuses a path that does not exist yet, which is most of them — a
/// familiar writing a new file is the ordinary case. So this walks the path from the root,
/// following each symlink as it meets one and applying `..` to what has been resolved *so far*.
///
/// **The order within the walk is the security property.** Folding `..` out textually first is
/// the tempting shortcut and it is wrong: with `work/link/../secret` where `link` is a symlink,
/// the text says `work/secret` and the kernel says something else entirely. So each `..` pops
/// the path after the symlinks before it have been followed, exactly as a real lookup does.
pub fn resolve(raw: &str, home: Option<&Path>) -> PathBuf {
    let expanded = expand_tilde(raw, home);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")).join(expanded)
    };

    let mut out = PathBuf::from("/");
    // Bounded so a symlink pointing at itself cannot spin here for ever.
    let mut hops = 0u32;

    for component in absolute.components() {
        match component {
            Component::Prefix(p) => out = PathBuf::from(p.as_os_str()),
            Component::RootDir => out = PathBuf::from("/"),
            Component::CurDir => {}
            // Applied to what is already resolved, which is the whole point.
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(name) => {
                out.push(name);
                // Follow a symlink here and now, so a later `..` pops from where it really is.
                while hops < 40 {
                    match std::fs::read_link(&out) {
                        Ok(target) => {
                            hops += 1;
                            out = if target.is_absolute() {
                                target
                            } else {
                                let mut base = out.clone();
                                base.pop();
                                // The target may itself contain `..`; resolve it the same way.
                                resolve_relative(&base, &target)
                            };
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    }
    out
}

/// Fold `.` and `..` out of a path textually.
///
/// Only ever used on paths that have already been through [`resolve`], where there is nothing
/// left to fold — belt and braces for a caller that passes a literal.
fn normalise(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Join a relative symlink target onto its directory, applying `..` as it goes.
fn resolve_relative(base: &Path, target: &Path) -> PathBuf {
    let mut out = base.to_path_buf();
    for c in target.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir => out = PathBuf::from("/"),
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn expand_tilde(raw: &str, home: Option<&Path>) -> PathBuf {
    let raw = raw.trim();
    let home = home.map(Path::to_path_buf).or_else(std::env::home_dir);
    match (raw.strip_prefix("~/"), raw == "~", home) {
        (Some(rest), _, Some(h)) => h.join(rest),
        (_, true, Some(h)) => h,
        _ => PathBuf::from(raw),
    }
}

/// Whether `path` is `folder` itself or somewhere beneath it, both resolved first.
///
/// The comparison is on components rather than on the string, so `/work/essays-private` is not
/// treated as being inside `/work/essays`. A prefix match on the text would say it is.
pub fn contains(folder: &Path, path: &Path) -> bool {
    let folder = normalise(folder);
    let path = normalise(path);
    path == folder || path.starts_with(&folder)
}

/// Whether a resolved path lies inside a resolved folder, taking both as written by a person.
pub fn inside(folder_raw: &str, path_raw: &str, home: Option<&Path>) -> bool {
    contains(&resolve(folder_raw, home), &resolve(path_raw, home))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A workspace with a file in it, plus somewhere secret outside it.
    fn study() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().expect("tmp");
        // The temporary directory itself may be reached through a symlink (/tmp → /private/tmp
        // on macOS), so the expected values are canonicalised too.
        let root = std::fs::canonicalize(tmp.path()).expect("canonical");
        let workspace = root.join("work");
        let secrets = root.join("secrets");
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::create_dir_all(&secrets).expect("secrets");
        std::fs::write(secrets.join("id_rsa"), "very private").expect("key");
        (tmp, workspace, secrets)
    }

    #[test]
    fn an_ordinary_path_inside_the_workspace_is_inside_it() {
        let (_t, workspace, _s) = study();
        let target = workspace.join("essay.md");
        assert!(contains(&workspace, &resolve(target.to_str().unwrap(), None)));
    }

    #[test]
    fn dot_dot_cannot_climb_out_of_the_workspace() {
        // The simplest escape, and the one a string comparison lets straight through.
        let (_t, workspace, secrets) = study();
        let escape = format!("{}/../secrets/id_rsa", workspace.display());

        let resolved = resolve(&escape, None);
        assert_eq!(resolved, secrets.join("id_rsa"));
        assert!(!contains(&workspace, &resolved), "`..` climbed out of the workspace");
    }

    #[test]
    fn a_symlink_inside_the_workspace_cannot_point_out_of_it() {
        // §11 asks for this case by name. A familiar may create the link itself, so the check
        // has to resolve it rather than trust where it appears to be.
        let (_t, workspace, secrets) = study();
        let link = workspace.join("shortcut");
        std::os::unix::fs::symlink(&secrets, &link).expect("symlink");

        let through_link = link.join("id_rsa");
        let resolved = resolve(through_link.to_str().unwrap(), None);

        assert_eq!(resolved, secrets.join("id_rsa"), "the link was not followed");
        assert!(
            !contains(&workspace, &resolved),
            "a symlink inside the workspace reached {} outside it",
            resolved.display()
        );
    }

    #[test]
    fn a_symlinked_workspace_still_contains_its_own_files() {
        // The mirror image: if the workspace itself is reached through a link, its real files
        // must still count as inside. Resolving only one side would call them foreign.
        let (_t, workspace, _s) = study();
        let tmp2 = tempfile::tempdir().expect("tmp2");
        let link = std::fs::canonicalize(tmp2.path()).expect("canon").join("via-link");
        std::os::unix::fs::symlink(&workspace, &link).expect("symlink");

        let target = link.join("essay.md");
        assert!(
            contains(&resolve(link.to_str().unwrap(), None), &resolve(target.to_str().unwrap(), None)),
            "a workspace reached through a link did not contain its own file"
        );
    }

    #[test]
    fn a_file_that_does_not_exist_yet_still_resolves() {
        // The ordinary case: a familiar writing a new file. `fs::canonicalize` alone refuses
        // this, which would leave every new write unjudgeable.
        let (_t, workspace, _s) = study();
        let target = workspace.join("not-yet/deeper/new.md");
        let resolved = resolve(target.to_str().unwrap(), None);
        assert_eq!(resolved, workspace.join("not-yet/deeper/new.md"));
        assert!(contains(&workspace, &resolved));
    }

    #[test]
    fn dot_dot_in_a_path_that_does_not_exist_yet_is_still_folded() {
        let (_t, workspace, secrets) = study();
        let escape = workspace.join("new/../../secrets/planned.txt");
        let resolved = resolve(escape.to_str().unwrap(), None);
        assert_eq!(resolved, secrets.join("planned.txt"));
        assert!(!contains(&workspace, &resolved));
    }

    #[test]
    fn a_sibling_with_a_longer_name_is_not_inside() {
        // `/work/essays-private` starts with `/work/essays` as text but is a different folder.
        let (_t, workspace, _s) = study();
        let sibling = workspace.with_file_name("work-private");
        std::fs::create_dir_all(&sibling).expect("sibling");
        assert!(
            !contains(&workspace, &resolve(sibling.join("x.md").to_str().unwrap(), None)),
            "a string prefix was mistaken for containment"
        );
    }

    #[test]
    fn tilde_expands_before_anything_is_compared() {
        let home = PathBuf::from("/home/someone");
        assert_eq!(resolve("~/work/essay.md", Some(&home)), PathBuf::from("/home/someone/work/essay.md"));
        assert_eq!(resolve("~", Some(&home)), home);
        // And a tilde that is not a home reference is left alone.
        assert_eq!(resolve("/tmp/~notahome", Some(&home)), PathBuf::from("/tmp/~notahome"));
    }

    #[test]
    fn both_sides_are_resolved_by_inside() {
        let home = PathBuf::from("/home/someone");
        assert!(inside("~/work", "~/work/essays/a.md", Some(&home)));
        assert!(!inside("~/work", "~/work/../.ssh/id_rsa", Some(&home)));
    }
}
