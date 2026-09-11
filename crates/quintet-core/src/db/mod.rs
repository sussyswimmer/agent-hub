//! SQLite access. One connection behind a mutex (WAL lets `quintet-mcp` write concurrently).

pub mod actions;
pub mod agents;
pub mod migrations;
pub mod outputs;
pub mod questions;
pub mod runs;
pub mod settings;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{CoreError, Result};

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
    /// Open (or create) the database file, set pragmas, apply pending migrations.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    /// In-memory database with the full schema. Tests only.
    pub fn open_in_memory() -> Result<Self> {
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

    /// Lock the connection. Poisoned mutex → error instead of panic (no `unwrap` outside tests).
    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| CoreError::other("database mutex poisoned"))
    }

    /// Run `f` inside a transaction.
    pub fn tx<T>(&self, f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut guard = self.conn()?;
        let tx = guard.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }
}

/// New ULID as a string. Monotonic within a millisecond is not required.
pub fn ulid() -> String {
    ulid::Ulid::generate().to_string()
}

/// Current UTC time as RFC 3339 with millisecond precision.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl From<rusqlite::Error> for CoreError {
    fn from(e: rusqlite::Error) -> Self {
        CoreError::Db(e.to_string())
    }
}
