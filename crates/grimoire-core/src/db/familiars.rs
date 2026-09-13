//! The `familiars` table (§9): a record that this familiar exists, so the rows that reference it
//! have something to point at.
//!
//! The binding file is the source of truth for *behaviour*; this table exists so a commission
//! from six months ago still names a familiar even after its binding has been rewritten or
//! deleted. `binding_hash` is what makes an edit visible after the fact.

use sha2::{Digest, Sha256};

use crate::db::{Db, now};
use crate::error::Result;

/// Note that a familiar exists, or that its binding changed.
///
/// `first_seen` is set once and never moved: it is when this familiar entered the study, and a
/// later edit to its writ does not make it new.
pub fn upsert(db: &Db, id: &str, name: &str, order: &str, binding_path: &str, writ: &str) -> Result<()> {
    db.conn()?.execute(
        "INSERT INTO familiars(id, name, order_name, binding_path, binding_hash, first_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            order_name = excluded.order_name,
            binding_path = excluded.binding_path,
            binding_hash = excluded.binding_hash",
        rusqlite::params![id, name, order, binding_path, hash(writ), now()],
    )?;
    Ok(())
}

/// Record that a familiar was summoned just now.
pub fn touch_summoned(db: &Db, id: &str) -> Result<()> {
    db.conn()?.execute("UPDATE familiars SET last_summoned = ?2 WHERE id = ?1", rusqlite::params![id, now()])?;
    Ok(())
}

pub fn exists(db: &Db, id: &str) -> Result<bool> {
    Ok(db.conn()?.query_row("SELECT EXISTS(SELECT 1 FROM familiars WHERE id = ?1)", [id], |r| r.get(0))?)
}

fn hash(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    // sha2 0.11 hands back a byte array rather than something with a LowerHex impl.
    h.finalize().iter().fold(String::with_capacity(64), |mut acc, b| {
        use std::fmt::Write;
        let _ = write!(acc, "{b:02x}");
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upserting_twice_updates_rather_than_duplicating() {
        let db = Db::memory().expect("db");
        upsert(&db, "vellum", "Vellum", "quill", "/b/vellum.binding.md", "first writ").expect("first");
        upsert(&db, "vellum", "Vellum the second", "quill", "/b/vellum.binding.md", "second writ").expect("second");

        let conn = db.conn().expect("conn");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM familiars", [], |r| r.get(0)).expect("count");
        assert_eq!(count, 1);
        let name: String = conn.query_row("SELECT name FROM familiars WHERE id='vellum'", [], |r| r.get(0)).expect("name");
        assert_eq!(name, "Vellum the second");
    }

    #[test]
    fn an_edited_writ_changes_the_hash_so_the_change_is_visible_later() {
        let db = Db::memory().expect("db");
        upsert(&db, "v", "V", "quill", "/b/v.binding.md", "first").expect("first");
        let before: String = db
            .conn()
            .expect("conn")
            .query_row("SELECT binding_hash FROM familiars WHERE id='v'", [], |r| r.get(0))
            .expect("hash");

        upsert(&db, "v", "V", "quill", "/b/v.binding.md", "second").expect("second");
        let after: String = db
            .conn()
            .expect("conn")
            .query_row("SELECT binding_hash FROM familiars WHERE id='v'", [], |r| r.get(0))
            .expect("hash");

        assert_ne!(before, after);
    }

    #[test]
    fn first_seen_does_not_move_when_the_binding_is_edited() {
        // It is when the familiar entered the study. Rewriting its writ does not make it new,
        // and a first_seen that crept forward would quietly rewrite the study's history.
        let db = Db::memory().expect("db");
        upsert(&db, "v", "V", "quill", "/b/v.binding.md", "first").expect("first");
        let first: i64 = db
            .conn()
            .expect("conn")
            .query_row("SELECT first_seen FROM familiars WHERE id='v'", [], |r| r.get(0))
            .expect("seen");

        std::thread::sleep(std::time::Duration::from_millis(1100));
        upsert(&db, "v", "V", "quill", "/b/v.binding.md", "second").expect("second");
        let again: i64 = db
            .conn()
            .expect("conn")
            .query_row("SELECT first_seen FROM familiars WHERE id='v'", [], |r| r.get(0))
            .expect("seen");

        assert_eq!(first, again);
    }
}
