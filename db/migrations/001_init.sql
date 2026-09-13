-- Grimoire, migration 001. The schema in CLAUDE.md §9, verbatim in shape.
-- Timestamps are unix epoch seconds (INTEGER), as §9 specifies.
-- Forward-only: never edit an applied migration, add 002.

CREATE TABLE familiars (
  id            TEXT PRIMARY KEY,          -- slug of name
  name          TEXT NOT NULL,
  order_name    TEXT NOT NULL,
  binding_path  TEXT NOT NULL,
  binding_hash  TEXT NOT NULL,             -- detect edits
  first_seen    INTEGER NOT NULL,
  last_summoned INTEGER
);

CREATE TABLE summonings (
  id            TEXT PRIMARY KEY,
  familiar_id   TEXT NOT NULL REFERENCES familiars(id),
  engine        TEXT NOT NULL,
  model         TEXT NOT NULL,
  cwd           TEXT NOT NULL,
  isolation     TEXT NOT NULL,
  worktree_path TEXT,
  pid           INTEGER,
  started       INTEGER NOT NULL,
  ended         INTEGER,
  exit_reason   TEXT                       -- quit | banished | crashed | restored
);
CREATE INDEX idx_summonings_familiar ON summonings(familiar_id, started DESC);
CREATE INDEX idx_summonings_live ON summonings(ended) WHERE ended IS NULL;

CREATE TABLE wards (
  id          TEXT PRIMARY KEY,
  familiar_id TEXT NOT NULL REFERENCES familiars(id),
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  intake_json TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    INTEGER,
  last_result TEXT
);

CREATE TABLE commissions (
  id            TEXT PRIMARY KEY,
  familiar_id   TEXT NOT NULL REFERENCES familiars(id),
  summoning_id  TEXT REFERENCES summonings(id),
  prompt        TEXT NOT NULL,
  intake_json   TEXT NOT NULL,
  status        TEXT NOT NULL,             -- queued|running|awaiting_seal|done|banished|misfired
  ward_id       TEXT REFERENCES wards(id),
  created       INTEGER NOT NULL,
  ended         INTEGER,
  tokens_in     INTEGER DEFAULT 0,
  tokens_out    INTEGER DEFAULT 0,
  turns         INTEGER DEFAULT 0,
  est_cost_usd  REAL DEFAULT 0
);
CREATE INDEX idx_commissions_familiar ON commissions(familiar_id, created DESC);
CREATE INDEX idx_commissions_status ON commissions(status);

CREATE TABLE seals (
  id            TEXT PRIMARY KEY,
  commission_id TEXT NOT NULL REFERENCES commissions(id),
  kind          TEXT NOT NULL,             -- write|shell|network|destructive|send|reliquary
  detail_json   TEXT NOT NULL,             -- path, command, diff, proposal
  raised        INTEGER NOT NULL,
  resolved      INTEGER,
  resolution    TEXT                       -- sealed|sealed_always|refused|timed_out
);
CREATE INDEX idx_seals_open ON seals(resolved) WHERE resolved IS NULL;

CREATE TABLE ledger_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  commission_id TEXT,
  familiar_id   TEXT,
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);
CREATE INDEX idx_ledger_at ON ledger_events(at DESC);
CREATE INDEX idx_ledger_familiar ON ledger_events(familiar_id, at DESC);

-- Workbench settings: engine binary paths, spend ceiling, transcript retention.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
