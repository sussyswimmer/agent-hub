//! Agent registry: parses `~/Quintet/agents/*/agent.md`, validates, caches, and watches for edits.

pub mod frontmatter;
pub mod validate;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::db::{self, Db};
use crate::error::{CoreError, Result};
use crate::paths::QuintetPaths;
use crate::types::{AgentDef, AgentDetail, AgentRunState, AgentSummary};

#[derive(Debug, Clone)]
pub struct LoadedAgent {
    pub id: String,
    pub path: PathBuf,
    pub def: Option<AgentDef>,
    pub body: String,
    pub hash: String,
    pub error: Option<String>,
}

impl LoadedAgent {
    pub fn summary(&self) -> AgentSummary {
        match &self.def {
            Some(d) => AgentSummary {
                id: d.id.clone(),
                name: d.name.clone(),
                icon: d.icon.clone(),
                color: d.color.clone(),
                version: d.version,
                mission: d.mission.clone(),
                error: self.error.clone(),
                hash: self.hash.clone(),
                run_state: AgentRunState::Idle,
                badge: 0,
            },
            None => AgentSummary {
                id: self.id.clone(),
                name: self.id.clone(),
                icon: "exclamationmark.triangle".to_string(),
                color: "gray".to_string(),
                version: 0,
                mission: String::new(),
                error: self.error.clone().or_else(|| Some("invalid agent.md".to_string())),
                hash: self.hash.clone(),
                run_state: AgentRunState::Error,
                badge: 0,
            },
        }
    }
}

/// Parse one `agent.md` text. Never fails: errors are captured in `LoadedAgent::error`.
pub fn parse_agent_md(text: &str, folder_id: &str, path: &Path) -> LoadedAgent {
    let hash = Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let mut out = LoadedAgent { id: folder_id.to_string(), path: path.to_path_buf(), def: None, body: String::new(), hash, error: None };
    let (yaml, body) = match frontmatter::split_frontmatter(text) {
        Ok(v) => v,
        Err(e) => { out.error = Some(e); return out; }
    };
    out.body = body;
    let doc: serde_json::Value = match serde_yaml_ng::from_str(&yaml) {
        Ok(v) => v,
        Err(e) => { out.error = Some(format!("YAML: {e}")); return out; }
    };
    let schema_errs = validate::schema_errors(&doc);
    if !schema_errs.is_empty() {
        out.error = Some(schema_errs.join("\n"));
        return out;
    }
    let def: AgentDef = match serde_json::from_value(doc) {
        Ok(d) => d,
        Err(e) => { out.error = Some(format!("frontmatter: {e}")); return out; }
    };
    let sem = validate::semantic_errors(&def, folder_id);
    if !sem.is_empty() {
        out.error = Some(sem.join("\n"));
        // Keep the def so the UI can still show name/icon next to the error badge.
    }
    out.def = Some(def);
    out
}

pub struct Registry {
    paths: QuintetPaths,
    db: Option<Db>,
    agents: RwLock<BTreeMap<String, LoadedAgent>>,
}

impl Registry {
    pub fn new(paths: QuintetPaths, db: Option<Db>) -> Self {
        Self { paths, db, agents: RwLock::new(BTreeMap::new()) }
    }

    pub fn paths(&self) -> &QuintetPaths { &self.paths }

    /// Scan every `agents/<id>/agent.md`. Returns the sidebar summaries.
    pub fn load_all(&self) -> Result<Vec<AgentSummary>> {
        let dir = self.paths.agents();
        let mut map = BTreeMap::new();
        if dir.is_dir() {
            let entries = std::fs::read_dir(&dir).map_err(|e| CoreError::io(&dir, e))?;
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                let md = p.join("agent.md");
                if !p.is_dir() || !md.is_file() { continue; }
                let Some(id) = p.file_name().and_then(|s| s.to_str()).map(str::to_owned) else { continue };
                let loaded = self.load_one(&id, &md);
                map.insert(id, loaded);
            }
        }
        let ids: Vec<String> = map.keys().cloned().collect();
        if let Some(db) = &self.db {
            for a in map.values() { self.cache(db, a)?; }
            db::agents::remove_missing(db, &ids)?;
        }
        let mut guard = self.agents.write().map_err(|_| CoreError::other("registry lock poisoned"))?;
        *guard = map;
        Ok(guard.values().map(LoadedAgent::summary).collect())
    }

    fn load_one(&self, id: &str, md: &Path) -> LoadedAgent {
        match std::fs::read_to_string(md) {
            Ok(text) => {
                let a = parse_agent_md(&text, id, md);
                match &a.error {
                    Some(e) => tracing::warn!(agent = id, "invalid agent.md: {e}"),
                    None => tracing::debug!(agent = id, hash = %a.hash, "loaded agent"),
                }
                a
            }
            Err(e) => LoadedAgent { id: id.to_string(), path: md.to_path_buf(), def: None, body: String::new(), hash: String::new(), error: Some(format!("cannot read agent.md: {e}")) },
        }
    }

    fn cache(&self, db: &Db, a: &LoadedAgent) -> Result<()> {
        let json = match &a.def { Some(d) => Some(serde_json::to_string(d)?), None => None };
        db::agents::upsert(db, &a.id, json.as_deref(), &a.hash, a.error.as_deref(), &a.path.to_string_lossy())
    }

    /// Re-read one agent folder (or drop it if the folder vanished). Returns whether anything changed.
    pub fn reload(&self, id: &str) -> Result<bool> {
        let md = self.paths.agent_md(id);
        let mut guard = self.agents.write().map_err(|_| CoreError::other("registry lock poisoned"))?;
        if !md.is_file() {
            let removed = guard.remove(id).is_some();
            if removed { if let Some(db) = &self.db { let ids: Vec<String> = guard.keys().cloned().collect(); db::agents::remove_missing(db, &ids)?; } }
            return Ok(removed);
        }
        let loaded = self.load_one(id, &md);
        let changed = guard.get(id).map(|old| old.hash != loaded.hash || old.error != loaded.error).unwrap_or(true);
        if changed { if let Some(db) = &self.db { self.cache(db, &loaded)?; } }
        guard.insert(id.to_string(), loaded);
        Ok(changed)
    }

    pub fn get(&self, id: &str) -> Result<Option<LoadedAgent>> {
        let guard = self.agents.read().map_err(|_| CoreError::other("registry lock poisoned"))?;
        Ok(guard.get(id).cloned())
    }

    /// A valid definition or `AgentInvalid` / `AgentNotFound`.
    pub fn require(&self, id: &str) -> Result<(AgentDef, LoadedAgent)> {
        let a = self.get(id)?.ok_or_else(|| CoreError::AgentNotFound(id.to_string()))?;
        match (&a.def, &a.error) {
            (Some(d), None) => Ok((d.clone(), a)),
            (_, Some(e)) => Err(CoreError::AgentInvalid(id.to_string(), e.clone())),
            (None, None) => Err(CoreError::AgentInvalid(id.to_string(), "no definition".to_string())),
        }
    }

    pub fn summaries(&self) -> Result<Vec<AgentSummary>> {
        let guard = self.agents.read().map_err(|_| CoreError::other("registry lock poisoned"))?;
        Ok(guard.values().map(LoadedAgent::summary).collect())
    }

    pub fn detail(&self, id: &str) -> Result<Option<AgentDetail>> {
        let Some(a) = self.get(id)? else { return Ok(None) };
        let memory = std::fs::read_to_string(self.paths.memory_md(id)).unwrap_or_default();
        Ok(Some(AgentDetail { summary: a.summary(), def: a.def.clone(), body: a.body.clone(), memory, path: a.path.to_string_lossy().into_owned() }))
    }

    /// Watch `agents/` recursively. Edits are debounced (250 ms) and only the touched folders are
    /// re-parsed; `on_change` receives the full summary list. Drop the handle to stop watching.
    pub fn watch(self: &Arc<Self>, on_change: impl Fn(Vec<AgentSummary>) + Send + 'static) -> Result<WatchHandle> {
        use notify::{RecursiveMode, Watcher};
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(move |res| { let _ = tx.send(res); })
            .map_err(|e| CoreError::other(format!("watcher: {e}")))?;
        let dir = self.paths.agents();
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        watcher.watch(&dir, RecursiveMode::Recursive).map_err(|e| CoreError::other(format!("watch {}: {e}", dir.display())))?;

        let reg = Arc::clone(self);
        let agents_dir = dir.clone();
        let thread = std::thread::Builder::new().name("quintet-registry-watch".into()).spawn(move || {
            let debounce = Duration::from_millis(250);
            let mut pending: std::collections::BTreeSet<String> = Default::default();
            let mut deadline: Option<std::time::Instant> = None;
            loop {
                let timeout = deadline.map(|d| d.saturating_duration_since(std::time::Instant::now())).unwrap_or(Duration::from_secs(3600));
                match rx.recv_timeout(timeout) {
                    Ok(Ok(ev)) => {
                        for p in ev.paths {
                            if let Some(id) = agent_id_for(&agents_dir, &p) { pending.insert(id); }
                        }
                        if !pending.is_empty() { deadline = Some(std::time::Instant::now() + debounce); }
                    }
                    Ok(Err(e)) => tracing::warn!("watch error: {e}"),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if deadline.is_some() {
                            deadline = None;
                            let ids: Vec<String> = std::mem::take(&mut pending).into_iter().collect();
                            let mut any = false;
                            for id in ids { match reg.reload(&id) { Ok(c) => any |= c, Err(e) => tracing::warn!(agent = %id, "reload failed: {e}") } }
                            if any { if let Ok(s) = reg.summaries() { on_change(s); } }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        }).map_err(|e| CoreError::other(format!("spawn watcher thread: {e}")))?;
        Ok(WatchHandle { _watcher: Box::new(watcher), _thread: thread })
    }
}

fn agent_id_for(agents_dir: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(agents_dir).ok()?;
    let first = rel.components().next()?;
    let id = first.as_os_str().to_str()?;
    // Ignore edits inside workspace/ (run scratch) — only agent.md / memory.md / folder events matter.
    let second = rel.components().nth(1).and_then(|c| c.as_os_str().to_str().map(str::to_owned));
    if second.as_deref() == Some("workspace") { return None; }
    Some(id.to_string())
}

pub struct WatchHandle {
    _watcher: Box<dyn notify::Watcher + Send>,
    _thread: std::thread::JoinHandle<()>,
}
