//! The codex: one markdown file per familiar, which the familiar itself may append to (§6.6).
//!
//! Grimoire reads and writes this file, but so does the familiar — it is handed the path and
//! told it may add to it. So nothing here assumes it owns the file: it reads what is there now,
//! appends without rewriting, and takes a backup before it ever replaces the whole thing.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// §6.6: past this many words, a condense is due.
pub const CONDENSE_AT_WORDS: usize = 8_000;

/// What is in a familiar's codex right now.
#[derive(Debug, Clone, PartialEq)]
pub struct Codex {
    pub path: PathBuf,
    pub text: String,
    pub words: usize,
}

impl Codex {
    /// Whether §6.6's condense threshold has been passed.
    pub fn needs_condense(&self) -> bool {
        self.words > CONDENSE_AT_WORDS
    }
}

/// Read a codex. A file that does not exist yet is an empty one, not an error — a familiar that
/// has never written anything is the ordinary first case.
pub fn read(path: &Path) -> Result<Codex> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(Error::io(path, e)),
    };
    let words = count_words(&text);
    Ok(Codex { path: path.to_path_buf(), text, words })
}

/// Add to the end of a codex, creating it if needed.
///
/// Appends rather than rewrites, deliberately: the familiar may have written to this file since
/// it was last read, and a read-modify-write would silently drop whatever it added.
pub fn append(path: &Path, entry: &str) -> Result<()> {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let existing = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| Error::io(path, e))?;

    // Keep entries apart without piling up blank lines on an empty file.
    let prefix = if existing > 0 { "\n" } else { "" };
    let body = entry.trim_end();
    writeln!(file, "{prefix}{body}").map_err(|e| Error::io(path, e))?;
    Ok(())
}

/// Where a backup of `path` goes: `<name>.<unix seconds>.bak`, beside the original.
pub fn backup_path(path: &Path, at: i64) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("codex.md");
    path.with_file_name(format!("{name}.{at}.bak"))
}

/// Replace a codex with a condensed version, keeping the old one.
///
/// §6.6: "Write the result to `<codex>.md` and the previous version to `<codex>.<timestamp>.bak`.
/// Never condense without keeping the backup." So the backup is written **first**, and a failure
/// to write it stops the whole operation — a condense that loses the original is worse than one
/// that does not happen, because the thing lost is everything the familiar ever learned.
pub fn condense(path: &Path, condensed: &str) -> Result<PathBuf> {
    let current = read(path)?;
    if current.text.is_empty() {
        return Err(Error::other("there is nothing in this codex to condense"));
    }

    let backup = backup_path(path, crate::db::now());
    std::fs::write(&backup, &current.text).map_err(|e| Error::io(&backup, e))?;

    // Only now, with the original safely beside it.
    std::fs::write(path, condensed.trim_end().to_string() + "\n").map_err(|e| Error::io(path, e))?;
    tracing::info!(codex = %path.display(), backup = %backup.display(), "codex condensed");
    Ok(backup)
}

/// Words, for the condense threshold. Whitespace-separated is close enough: the number decides
/// when to ask a model to shorten a file, not anything that has to be exact.
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_codex_that_does_not_exist_yet_reads_as_empty() {
        let tmp = tempfile::tempdir().expect("tmp");
        let c = read(&tmp.path().join("nobody.md")).expect("read");
        assert_eq!(c.text, "");
        assert_eq!(c.words, 0);
        assert!(!c.needs_condense());
    }

    #[test]
    fn appending_keeps_what_was_already_there() {
        // The familiar writes to this file too. A read-modify-write would drop whatever it
        // added between our read and our write, which is the whole reason this appends.
        let tmp = tempfile::tempdir().expect("tmp");
        let path = tmp.path().join("vellum.md");

        append(&path, "First thing learned.").expect("first");
        std::fs::write(
            &path,
            std::fs::read_to_string(&path).unwrap() + "\nSomething the familiar wrote itself.\n",
        )
        .unwrap();
        append(&path, "Second thing learned.").expect("second");

        let text = read(&path).expect("read").text;
        assert!(text.contains("First thing learned."));
        assert!(text.contains("Something the familiar wrote itself."), "lost the familiar's own line");
        assert!(text.contains("Second thing learned."));
    }

    #[test]
    fn the_first_entry_does_not_start_with_a_blank_line() {
        let tmp = tempfile::tempdir().expect("tmp");
        let path = tmp.path().join("c.md");
        append(&path, "Only line.").expect("append");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Only line.\n");
    }

    #[test]
    fn the_condense_threshold_is_the_one_in_the_spec() {
        let tmp = tempfile::tempdir().expect("tmp");
        let path = tmp.path().join("big.md");
        std::fs::write(&path, "word ".repeat(CONDENSE_AT_WORDS)).unwrap();
        assert!(!read(&path).expect("read").needs_condense(), "exactly at the threshold is not past it");

        std::fs::write(&path, "word ".repeat(CONDENSE_AT_WORDS + 1)).unwrap();
        assert!(read(&path).expect("read").needs_condense());
    }

    #[test]
    fn condensing_keeps_the_original_beside_the_new_one() {
        let tmp = tempfile::tempdir().expect("tmp");
        let path = tmp.path().join("vellum.md");
        let original = "A long history of everything this familiar ever learned.\n";
        std::fs::write(&path, original).unwrap();

        let backup = condense(&path, "The short version.").expect("condense");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "The short version.\n");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        assert!(
            backup.to_string_lossy().ends_with(".bak"),
            "the backup should be obvious from its name: {}",
            backup.display()
        );
    }

    #[test]
    fn an_empty_codex_is_not_condensed_at_all() {
        // Condensing nothing would write a backup of nothing and then overwrite the file with a
        // model's idea of a summary of nothing.
        let tmp = tempfile::tempdir().expect("tmp");
        let path = tmp.path().join("empty.md");
        assert!(condense(&path, "anything").is_err());
    }
}
