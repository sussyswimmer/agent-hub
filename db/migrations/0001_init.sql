-- Quintet initial schema. Every table: id TEXT PRIMARY KEY (ULID), created_at / updated_at (RFC 3339 UTC).
-- Applied by crates/quintet-core/src/db/migrations.rs inside one transaction. See CLAUDE.md §8.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ── Core ─────────────────────────────────────────────────────────────────────

CREATE TABLE agents (
  id         TEXT PRIMARY KEY,           -- agent id == folder name
  json       TEXT,                       -- parsed frontmatter (NULL when broken)
  hash       TEXT NOT NULL,              -- sha256 of agent.md
  error      TEXT,                       -- validation error (NULL when ok)
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  trigger         TEXT NOT NULL,         -- 'manual' | 'scheduled:<name>'
  status          TEXT NOT NULL,         -- queued|running|waiting_user|awaiting_approval|done|failed|stale
  session_id      TEXT,                  -- pre-assigned UUID passed as --session-id
  integrity_level INTEGER,
  intake_json     TEXT,
  task_title      TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT,
  cost_usd        REAL,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  turns           INTEGER,
  error           TEXT,
  summary         TEXT,                  -- final assistant text
  pid             INTEGER,
  log_path        TEXT,
  output_dir      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_runs_agent_status ON runs(agent_id, status);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created ON runs(created_at);

CREATE TABLE run_events (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,              -- stream event type (system/init, assistant, user, result, ...)
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX idx_run_events_run ON run_events(run_id);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL,              -- open|running|done|failed
  due_at     TEXT,
  run_id     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE questions (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL,
  json          TEXT NOT NULL,           -- [{id, prompt, type, options?}]
  answered_json TEXT,
  status        TEXT NOT NULL,           -- pending|answered|stale
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_questions_run_status ON questions(run_id, status);
CREATE INDEX idx_questions_status ON questions(status);

CREATE TABLE actions (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  type         TEXT NOT NULL,            -- calendar.create_events | ... (CLAUDE.md §6.2)
  payload_json TEXT NOT NULL,
  preview_md   TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL,            -- pending|approved|rejected|executed|failed
  result_json  TEXT,
  executed_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_run ON actions(run_id);

CREATE TABLE outputs (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- md|csv|png|docx|feedback
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_outputs_run ON outputs(run_id);
CREATE INDEX idx_outputs_agent ON outputs(agent_id);

CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(agent_id, name)
);

CREATE TABLE quintet_events (
  id              TEXT PRIMARY KEY,
  google_event_id TEXT NOT NULL,
  action_id       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE settings (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Research ─────────────────────────────────────────────────────────────────

CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  run_id       TEXT,
  url          TEXT NOT NULL,
  title        TEXT,
  author       TEXT,
  published_at TEXT,
  grade        TEXT,                     -- A|B|C
  project      TEXT,
  relevance    TEXT,
  quotes_json  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_sources_project ON sources(project);

-- ── College ──────────────────────────────────────────────────────────────────

CREATE TABLE colleges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  round       TEXT,                      -- ED|EA|REA|RD|UCAS
  deadline_at TEXT,
  status      TEXT,
  fit         TEXT,                      -- reach|target|likely
  notes       TEXT,
  source_url  TEXT,
  verified_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE requirements (
  id          TEXT PRIMARY KEY,
  college_id  TEXT NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  detail      TEXT,
  word_limit  INTEGER,
  due_at      TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  source_url  TEXT,
  verified_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE essays (
  id          TEXT PRIMARY KEY,
  college_id  TEXT REFERENCES colleges(id) ON DELETE SET NULL,
  prompt      TEXT NOT NULL,
  stage       TEXT NOT NULL,             -- brainstorm|outline|draft|feedback|final
  word_count  INTEGER,
  file_path   TEXT,
  feedback_md TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE activities (
  id               TEXT PRIMARY KEY,
  position         TEXT NOT NULL,
  org              TEXT NOT NULL,
  description      TEXT NOT NULL,
  hours            REAL,
  weeks            REAL,
  grades           TEXT,
  rank             INTEGER,
  char_counts_json TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE honors (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  level      TEXT,
  grades     TEXT,
  rank       INTEGER,
  char_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Scout ────────────────────────────────────────────────────────────────────

CREATE TABLE opportunities (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  org              TEXT,
  category         TEXT NOT NULL,        -- competition|summer_program|internship_research|grant_scholarship
  url              TEXT NOT NULL UNIQUE,
  deadline_at      TEXT,
  deadline_tz      TEXT,
  rolling          INTEGER NOT NULL DEFAULT 0,
  eligibility      TEXT,
  eligibility_flag TEXT,
  cost             TEXT,
  format           TEXT,
  location         TEXT,
  fit              INTEGER,
  fit_reason       TEXT,
  status           TEXT NOT NULL DEFAULT 'new',   -- new|interested|preparing|applied|result|skipped
  starred          INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_opportunities_deadline ON opportunities(deadline_at);

-- ── School ───────────────────────────────────────────────────────────────────

CREATE TABLE school_items (
  id               TEXT PRIMARY KEY,
  uid              TEXT UNIQUE,          -- iCal UID (NULL for manual items)
  course           TEXT,
  title            TEXT NOT NULL,
  description      TEXT,
  due_at           TEXT,
  url              TEXT,
  source           TEXT NOT NULL,        -- ical|manual
  est_minutes      INTEGER,
  actual_minutes   INTEGER,
  status           TEXT NOT NULL DEFAULT 'open',  -- open|in_progress|done|late
  due_history_json TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_school_items_due ON school_items(due_at);

CREATE TABLE school_subtasks (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES school_items(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_at     TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE course_policies (
  id              TEXT PRIMARY KEY,
  course          TEXT NOT NULL UNIQUE,
  integrity_level INTEGER NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ── Tutor ────────────────────────────────────────────────────────────────────

CREATE TABLE cards (
  id         TEXT PRIMARY KEY,
  deck       TEXT NOT NULL,
  course     TEXT,
  topic      TEXT,
  type       TEXT NOT NULL,              -- basic|cloze|explain
  front      TEXT NOT NULL,
  back       TEXT NOT NULL,
  source_ref TEXT,
  status     TEXT NOT NULL DEFAULT 'draft',  -- draft|active|suspended
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cards_deck_status ON cards(deck, status);

CREATE TABLE card_state (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
  due            TEXT NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  state          INTEGER NOT NULL,       -- FSRS state enum
  last_review    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_card_state_due ON card_state(due);

CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL,          -- 1 again | 2 hard | 3 good | 4 easy
  reviewed_at TEXT NOT NULL,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE weak_spots (
  id         TEXT PRIMARY KEY,
  course     TEXT,
  topic      TEXT NOT NULL,
  concept    TEXT NOT NULL,
  error_type TEXT NOT NULL,              -- recall|misconception|application
  count      INTEGER NOT NULL DEFAULT 1,
  last_seen  TEXT NOT NULL,
  mastery    REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_weak_spots_topic ON weak_spots(topic);
