use std::path::PathBuf;

/// Every error the core can surface to the app or to tests.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("database error: {0}")]
    Db(String),

    #[error("agent `{0}` is not valid: {1}")]
    AgentInvalid(String, String),

    #[error("agent `{0}` not found")]
    AgentNotFound(String),

    #[error("run `{0}` not found")]
    RunNotFound(String),

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("{0}")]
    Other(String),
}

impl CoreError {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io { path: path.into(), source }
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
