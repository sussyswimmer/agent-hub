//! SQLite, held open behind a mutex. WAL so a second reader never blocks the writer.
//!
//! §5 specifies `tauri-plugin-sql` (sqlx). This uses rusqlite instead — see DECISIONS.md 0002.

pub mod familiars;
pub mod migrations;
pub mod summonings;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{Error, Result};

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Db")
    }
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        }
        Self::init(Connection::open(path)?)
    }

    /// In-memory, fully migrated. Tests only.
    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;
        let db = Self { conn: Arc::new(Mutex::new(conn)) };
        migrations::apply(&db)?;
        Ok(db)
    }

    /// A poisoned mutex is an error, never a panic — §12 forbids leaving the app unusable.
    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| Error::Db("the database lock was poisoned by an earlier panic".into()))
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self.conn()?.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn()?.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }
}

/// A sortable, unique id.
pub fn id() -> String {
    ulid::Ulid::generate().to_string()
}

/// Unix epoch seconds, the timestamp shape §9 uses throughout.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
