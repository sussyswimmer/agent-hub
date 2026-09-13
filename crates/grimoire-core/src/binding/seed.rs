//! Putting the shipped bindings in place on first run (§4).
//!
//! The five seeds are compiled into the binary rather than read from a resource folder, so a
//! packaged application has no directory to lose and a development build and a `.dmg` behave
//! identically.
//!
//! **Nothing is ever overwritten.** A binding is the user's file the moment it exists; if
//! Grimoire replaced one on launch, a whole afternoon of editing a writ would vanish on the next
//! restart with no warning and no way back. A seed is copied only where no file of that name is
//! there at all.

use std::path::Path;

use crate::error::{Error, Result};

/// The shipped bindings, as (file name, contents).
pub const SEEDS: &[(&str, &str)] = &[
    ("vellum.binding.md", include_str!("../../../../seeds/vellum.binding.md")),
    ("sconce.binding.md", include_str!("../../../../seeds/sconce.binding.md")),
    ("astrolabe.binding.md", include_str!("../../../../seeds/astrolabe.binding.md")),
    ("anvil.binding.md", include_str!("../../../../seeds/anvil.binding.md")),
    ("tally.binding.md", include_str!("../../../../seeds/tally.binding.md")),
];

/// Copy any seed that is not already in `folder`. Returns the names actually written.
pub fn place(folder: &Path) -> Result<Vec<String>> {
    std::fs::create_dir_all(folder).map_err(|e| Error::io(folder, e))?;

    let mut written = Vec::new();
    for (name, contents) in SEEDS {
        let path = folder.join(name);
        if path.exists() {
            continue;
        }
        std::fs::write(&path, contents).map_err(|e| Error::io(&path, e))?;
        written.push((*name).to_string());
    }
    Ok(written)
}

/// Whether the folder has no bindings at all — the first-run case, and the only time placing
/// seeds is obviously the right thing to do.
pub fn is_empty(folder: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(folder) else { return true };
    !entries.flatten().any(|e| super::is_binding_file(&e.path()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_are_placed_on_an_empty_folder() {
        let tmp = tempfile::tempdir().expect("tmp");
        let folder = tmp.path().join("bindings");
        assert!(is_empty(&folder));

        let written = place(&folder).expect("place");
        assert_eq!(written.len(), 5);
        assert!(!is_empty(&folder));
        assert_eq!(super::super::load_folder(&folder).len(), 5);
    }

    #[test]
    fn an_edited_binding_is_never_overwritten() {
        // The failure this guards against loses work silently: edit a writ, restart, and find
        // the shipped version back. There is no undo for that.
        let tmp = tempfile::tempdir().expect("tmp");
        let folder = tmp.path().join("bindings");
        place(&folder).expect("first");

        let mine = folder.join("vellum.binding.md");
        let edited = "---\nname: Vellum\norder: quill\nengine: claude\nworkspace: ~/mine\n---\nMy own writ.\n";
        std::fs::write(&mine, edited).expect("write");

        let written = place(&folder).expect("second");
        assert!(written.is_empty(), "placing again wrote something: {written:?}");
        assert_eq!(std::fs::read_to_string(&mine).expect("read"), edited);
    }

    #[test]
    fn a_deleted_seed_comes_back_only_if_the_user_asks() {
        // Deleting a seed is a decision. `place` will restore it — that is what makes it
        // repairable — but nothing calls `place` on its own after the first run.
        let tmp = tempfile::tempdir().expect("tmp");
        let folder = tmp.path().join("bindings");
        place(&folder).expect("first");
        std::fs::remove_file(folder.join("tally.binding.md")).expect("remove");

        assert!(!is_empty(&folder), "four bindings is not an empty folder");
        let written = place(&folder).expect("second");
        assert_eq!(written, vec!["tally.binding.md"], "only the missing one comes back");
    }

    #[test]
    fn every_compiled_seed_is_a_binding_that_parses() {
        // The seeds are `include_str!`d, so a broken one is a compile-time file that fails at
        // runtime. Catch it here rather than in front of a new user.
        for (name, contents) in SEEDS {
            let id = name.strip_suffix(".binding.md").expect("name");
            let b = super::super::parse(id, Path::new(name), contents);
            assert_eq!(b.error, None, "compiled seed `{name}` does not parse");
        }
    }
}
