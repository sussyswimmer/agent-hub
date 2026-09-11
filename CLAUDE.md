# CLAUDE.md — Quintet

> Quintet is a personal macOS desktop app. It runs a bench of specialist AI agents, and each one is very good at a single job.
> v1 ships **5 agents**. The framework is built so the other 10 drop in later as files.
> Owner and only user: Maxwell (SSIS Class of 2028, Ho Chi Minh City, timezone `Asia/Saigon`).

Read this whole file before writing any code. Build in the phases in §12, in order. **Build and run the app at the end of every phase and meet its acceptance criteria before you start the next one.**

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Value |
|---|---|---|
| 1 | Relationship to JARVIS | **Separate standalone app.** It shares nothing with JARVIS. |
| 2 | Audience | **Just Maxwell.** No accounts, no onboarding funnel, no telemetry, no payments. |
| 3 | v1 agents | **Research, College, Scout, School, Tutor** |
| 4 | Backlog agents (post-v1) | Email & outreach, Calendar & planner, Builder/coder, Finance/markets, Content & social, Debate & MUN, Language coach, Network CRM, Files & life admin, Writing editor |
| 5 | Agent definition | **Files, not UI.** One folder per agent: `agent.md` (YAML frontmatter + prose) and `memory.md`. Edited by hand or with Claude Code. No in-app agent builder. |
| 6 | Routing | **Manual only.** Maxwell picks the agent. No router or orchestrator agent, and agents never call each other. |
| 7 | Asking questions | **Set per agent.** Each `agent.md` declares its intake questions and when to skip them. Agents can also ask mid-run through the question protocol (§6.3). |
| 8 | Autonomy | **Draft, then approve.** Anything that leaves the machine or can't be undone is a *proposal* until Maxwell approves it. |
| 9 | Triggers | **Manual** (in-app) and **scheduled**. No event triggers or phone control in v1. |
| 10 | Stack | **Tauri 2 + React 19 + TypeScript + Vite + Tailwind v4.** Rust backend. |
| 11 | AI engine | **Claude Code headless** (`claude -p`) under Maxwell's existing subscription. No Anthropic API key. |
| 12 | Storage | **Local SQLite** for structured data, plus **markdown files** for agent definitions, memory, and outputs. |
| 13 | Integrations (v1) | Google Calendar, Gmail, Google Drive/Docs, web search and browser, and the Schoology **iCal feed** |
| 14 | Academic integrity | **Set per assignment** (levels in §7). College essays have a hard cap (§7). |
| 15 | Layout | **Agent sidebar + per-agent workspace** (Chat · Queue · Board · Outputs), plus a global Approvals inbox |
| 16 | Visual style | **Clean macOS-native.** Translucent sidebar, system font, system accent color, follows light/dark mode. |
| 17 | Background | **Menu-bar resident.** Closing the window hides it and schedules keep running. macOS notifications for approvals and questions. |

---

## 1. Product principles

1. **Specialists, not a generalist.** Every agent has one mission, a fixed process, and a quality bar. If a request is outside an agent's mission, the agent says which agent owns it and stops.
2. **Nothing external without a tap.** Agents read freely and write freely *to Quintet's own data*. Sending, creating, or deleting anything in Google, or anything irreversible, goes through the Approvals inbox.
3. **Coach, don't cheat.** Integrity levels are enforced by the system prompt *and* by tool access, not just by asking nicely.
4. **Verifiable output.** Every factual claim a Research or Scout agent makes links to a source it actually opened in this run.
5. **Files are the source of truth for behavior.** Change an agent by editing its `agent.md`. The app hot-reloads it.
6. **Quiet by default.** Notify only when Maxwell has to act: a question, an approval, a deadline inside 72 hours, or a failed scheduled run.

---

## 2. Architecture

```
┌──────────────────────────── Quintet.app (Tauri 2) ────────────────────────────┐
│  React UI (src/)                                                               │
│   Sidebar · Agent workspace · Approvals · Activity · Settings                  │
│        ▲  Tauri events (run stream)        │ Tauri commands (invoke)           │
│        │                                   ▼                                   │
│  Rust core (src-tauri/)                                                        │
│   ├─ AgentRegistry   loads + watches ~/Quintet/agents/*/agent.md               │
│   ├─ RunManager      spawns `claude -p`, parses stream-json, queue (max 2)     │
│   ├─ Scheduler       cron from agent.md, catch-up on launch                    │
│   ├─ Db              SQLite (WAL), migrations in db/migrations                 │
│   ├─ Tray/Notify     menu-bar icon, macOS notifications, autostart            │
│   └─ ActionRunner    runs approved actions via `quintet-mcp exec`              │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ spawns per run                         │ spawns on approve
                ▼                                        ▼
        claude -p (headless)  ──stdio MCP──▶  quintet-mcp (TS, Bun, sidecar)
          built-in: WebSearch, WebFetch,        serve  → MCP tools (§6)
          Read/Write (cwd only), Bash(python)   auth   → Google OAuth loopback
          optional: Playwright MCP              exec   → execute approved action
                                                sync   → Schoology iCal, Calendar
                                                  │
                                                  ▼
                                   Google APIs · SQLite · macOS Keychain
```

### 2.1 Why this shape
- **Rust stays thin.** It handles processes, scheduling, the tray, and the DB. All integration code (Google, iCal, action execution) lives in **one TypeScript package, `quintet-mcp`**. The agents (through MCP) and the app (through the CLI subcommands) share the same code path.
- **Agents cannot act on the outside world directly.** `quintet-mcp` exposes *read* tools plus `propose_action`. Only `quintet-mcp exec <action_id>` performs writes, and only the Rust `ActionRunner` calls it, after Maxwell approves.
- **Headless runs are stateless processes.** When a run needs Maxwell's input, it ends. The app resumes it later with `claude -p --resume <session_id>`. No process sits blocked waiting on a human.

### 2.2 Repo layout
```
quintet/
  CLAUDE.md                     ← this file
  docs/
    claude-cli-notes.md         ← Phase 0 findings (verified flags + event shapes)
    decisions/                  ← ADRs, one per non-obvious choice
  src-tauri/
    src/
      main.rs  registry.rs  runs.rs  stream.rs  scheduler.rs
      db.rs  tray.rs  notify.rs  actions.rs  prompt.rs  commands.rs
    tauri.conf.json
  src/                          ← React UI
    app/  components/  features/{sidebar,workspace,approvals,activity,settings}
    features/boards/{school,tutor,research,college,scout}
    lib/{ipc.ts, types.ts, fsrs.ts}
  mcp/                          ← quintet-mcp (Bun + @modelcontextprotocol/sdk)
    src/{index.ts, tools/, google/, ical/, exec/, db.ts, auth.ts}
  db/migrations/                ← numbered .sql files, run by Rust at startup
  agents-default/               ← shipped agent folders, copied to ~/Quintet/agents on first run
    research/ college/ scout/ school/ tutor/
  shared-default/profile.md
```

### 2.3 User data layout (created on first launch)
```
~/Quintet/
  agents/<id>/agent.md          ← behavior (user-editable, hot-reloaded)
  agents/<id>/memory.md         ← agent-maintained long-term notes (≤ 200 lines)
  agents/<id>/workspace/        ← cwd for that agent's runs (scratch)
  outputs/<id>/YYYY-MM-DD-<slug>/ ← deliverables (md, csv, png, docx)
  shared/profile.md             ← Maxwell's context; read by every agent
  data/quintet.db               ← SQLite
  logs/runs/<run_id>.jsonl      ← raw stream-json per run
```
Secrets (the Google refresh token, the Schoology iCal URL) go in the **macOS Keychain**, never in files or the DB.

---

## 3. The Claude Code headless runner

### 3.1 Phase 0 spike (mandatory, before any UI)
The CLI changes often. Before writing `runs.rs`, run `claude --help` and small experiments. Record in `docs/claude-cli-notes.md`:
- the exact flags for: print mode, `--output-format stream-json` (and whether `--verbose` is required), `--append-system-prompt` (and any `-file` variant), `--model`, `--max-turns`, `--allowedTools` / `--disallowedTools`, `--permission-mode`, `--mcp-config` (plus any strict-MCP flag), `--resume <session_id>`, and the flag that **isolates the run from user-level settings/skills/CLAUDE.md** (e.g. `--setting-sources`). Maxwell's global `~/.claude` has 50+ skills, and they must not leak into agent runs.
- the JSON shape of each stream event: `system/init` (session_id, tools, mcp_servers), `assistant` (text and tool_use blocks), `user` (tool_result), and `result` (subtype, `session_id`, `total_cost_usd`, `usage`, `num_turns`, `is_error`).
- how to detect "not logged in" and "usage limit reached", so the app can show a clear banner.

Write down what you **observed**, not what you expect. If a flag doesn't exist, pick the closest real mechanism and record it as an ADR.

### 3.2 Command template (adjust to Phase 0 findings)
```bash
claude -p "<user turn>" \
  --output-format stream-json --verbose \
  --model <agent.model> \
  --max-turns <agent.max_turns> \
  --append-system-prompt "<assembled prompt, §3.3>" \
  --mcp-config <generated json: quintet-mcp [+ playwright]> \
  --allowedTools "<from agent.md>" \
  --disallowedTools "<global denylist>" \
  --permission-mode acceptEdits \
  [--resume <session_id>]
# cwd = ~/Quintet/agents/<id>/workspace
```
- **Global denylist**, always applied: any Bash except the patterns an agent explicitly allows; network CLIs (`curl`, `wget`); `git push`; `rm -rf`; any MCP tool whose name starts with `send_`/`delete_`/`create_` from third-party servers.
- **Concurrency:** max 2 runs at once, FIFO queue. Scheduled runs yield to manual runs.
- **Timeouts:** a soft limit from `agent.max_turns`, and a hard wall-clock kill at 20 min (configurable). A killed run → status `failed` with reason.
- **Usage:** store `total_cost_usd`, tokens, and turns from `result` on the run row. Show a weekly usage meter in Settings (it's informational, since he's on a subscription).
- **Preflight at app launch:** `claude --version` and an auth check. If either fails, show a blocking banner with the fix.

### 3.3 Prompt assembly (`prompt.rs`)
The system prompt is appended in this order. Each part is separated by a header so the model can tell them apart:
1. `# Quintet protocol`: the fixed rules from §6.3–6.5: how to ask, how to propose, where to save outputs, and never to claim an external action happened.
2. `# Run context`: current date and time in `Asia/Saigon`, trigger (`manual`/`scheduled:<name>`), integrity level (if applicable), intake answers as YAML, and the task text.
3. `# Maxwell`: contents of `~/Quintet/shared/profile.md`.
4. `# Your role`: the body of `agents/<id>/agent.md` (frontmatter stripped).
5. `# Your memory`: contents of `agents/<id>/memory.md`.
6. `# Relevant state`: a compact snapshot the app queries from SQLite per agent (e.g. School gets the next 14 days of items; Tutor gets its top-10 weak spots). Each agent's frontmatter declares the query (`state_snapshot`).

The first user turn is the task text. On `--resume`, the user turn is Maxwell's answer to the pending question.

### 3.4 Stream parsing (`stream.rs`)
- Read stdout line by line → parse JSON → persist to `run_events` and append to `logs/runs/<id>.jsonl` → emit a Tauri event `run://<run_id>` to the UI.
- Map tool calls to friendly UI rows ("Searching the web: *…*", "Reading Calendar", "Proposed: add 3 study blocks").
- On `result`: update the run status. If the run called `ask_user` → status `waiting_user`. If it called `propose_action` → `awaiting_approval` (it can be both). Otherwise → `done`.
- stderr goes into the run log. A non-zero exit without a `result` event → `failed`.

---

## 4. Agent definition format

Each agent is a folder: `~/Quintet/agents/<id>/agent.md` + `memory.md`. The Registry validates frontmatter with a schema (Rust `serde` + a JSON Schema at `agents-default/agent.schema.json`) and shows errors in the sidebar. A broken agent never crashes the app.

```yaml
---
id: research                    # folder name, kebab-case, unique
name: Research
icon: magnifyingglass           # SF Symbol name (rendered via bundled SVG set)
color: indigo                   # system color token
version: 1
mission: >                      # one sentence — the agent's goal
  Turn a research question into a verified, cited deliverable Maxwell can build on.
owns: [research briefs, literature reviews, datasets and charts]
does_not_own: [writing Maxwell's graded prose, college essays, opportunity hunting]
model: opus                     # opus | sonnet | haiku (alias passed to --model)
max_turns: 60
integrity: when_graded          # false | true | when_graded → level chosen at intake (§7)
allowed_tools:                  # passed to --allowedTools
  - WebSearch
  - WebFetch
  - Read
  - Write
  - "Bash(python3:*)"
  - "Bash(uv run:*)"
  - "mcp__quintet__*"
mcp_extra: [playwright]         # optional extra MCP servers
state_snapshot: research_recent # named query in Rust (§3.3 step 6)
intake:                         # rendered as a native form before the run
  - id: question
    type: text
    prompt: What's the research question?
    required: true
  - id: output
    type: multi
    prompt: What do you want back?
    options: [brief, lit_review, data_charts]
    default: [brief]
  - id: depth
    type: single
    prompt: How deep?
    options: [quick_15min, standard, exhaustive]
    default: standard
  - id: citation_style
    type: single
    options: [APA, Chicago, MLA]
    default: Chicago
    skip_if: "memory.default_citation_style"   # skip when memory already knows it
schedules: []                   # cron entries, see School for an example
outputs_dir: research           # → ~/Quintet/outputs/research/
board: research_library         # which Board tab component to render
---
(Prose body: Role · Process · Quality bar · Output templates · Guardrails)
```

**Intake rules.** Field types: `text`, `single`, `multi`, `date`, `file` (a local path or a Drive picker), `integrity`. `skip_if` is a tiny expression over `memory.*`, `profile.*`, or `task.*`. When every required field is satisfied, the form is skipped and the run starts immediately. Quick tasks typed into Chat skip intake unless a required field can't be inferred. In that case the app shows only the missing fields.

**Memory rules** (in the protocol prompt): the agent may edit only its own `memory.md`, which is in its cwd's parent. The app symlinks it into the workspace as `./memory.md`. The file must stay ≤ 200 lines. The agent stores durable preferences and learnings, not run logs. It condenses instead of appending forever.

---

## 5. The five v1 agents

Each spec below becomes that agent's `agent.md` in `agents-default/`. Write the prose body from these specs in second person ("You are…"). Keep each body under ~250 lines.

### 5.1 Research — "The Analyst"

**Mission:** Turn a research question into a verified, cited deliverable Maxwell can build on.
**Owns:** research briefs, full literature reviews, datasets and charts. Built for his papers (AI credit-scoring transparency, the AFC/Malaysia–IMF paper, the LLM vs FinBERT paper), competitions (IFC, Wharton), and MUN.
**Does not own:** writing his graded prose (it hands over findings, not his paper), college essays, or finding opportunities.
**Model:** `opus` · **max_turns:** 60 · **integrity:** `when_graded` (asked only when the output feeds a graded assignment)

**Triggers:** manual only.

**Intake:** question · output (`brief` | `lit_review` | `data_charts`, multi) · depth (`quick` ≈ 5 sources, `standard` ≈ 10–15, `exhaustive` ≈ 25+) · citation style (skipped once memory has a default) · due date (optional) · seed sources (optional files or links) · integrity level (only if "for a graded assignment" is ticked).

**Process:**
1. **Scope.** Restate the question as one sentence plus 3–6 sub-questions. Define what's in and out of scope. If the question is too broad for the chosen depth, `ask_user` with 2–3 narrower framings.
2. **Plan the search.** List search queries per sub-question, including non-English queries when the topic is local (e.g. Vietnamese terms for Vietnamese lenders). Name the target source types: peer-reviewed, IMF/World Bank/BIS, central bank, regulator, reputable press, primary documents.
3. **Search and triage.** Open every candidate with WebFetch. Grade each source **A** (peer-reviewed, official statistics, primary documents), **B** (think tanks, reputable press), or **C** (blogs, vendors — used only for leads, never cited for facts). Record each in `sources` through `save_source` (url, title, author, date, grade, one-line relevance).
4. **Extract.** For each A/B source, pull exact quotes and figures with page or section anchors.
5. **Synthesize.** Build the output around the sub-questions. Surface disagreements between sources explicitly.
6. **Verify.** Build a claim table (`claim → source_id → quote`). Any claim without a row is deleted or rewritten as an open question. Numbers must match the source exactly, including units and year.
7. **Data + charts** (if requested). Use public APIs first: World Bank, IMF (SDMX/DataMapper), FRED if a key is configured, and Yahoo Finance via `yfinance` for markets. Write `analysis.py` in the workspace, run it with `uv run`, and save `data.csv` + `chart-*.png` (a clean matplotlib style with a labeled source line under each chart). The script stays in the output folder so the chart can be reproduced.
8. **Deliver.** Call `save_output` for each file. Offer a `propose_action: drive.create_doc` to put the brief or review into Google Drive.

**Outputs:**
- `brief.md`: 1–2 pages. TL;DR (3 bullets) · Findings by sub-question · What's contested · Open questions · Sources.
- `lit-review.md`: organized by theme, with a methods comparison table, the state of the debate, **gaps**, and where Maxwell's paper could contribute.
- `data/`: `data.csv`, `chart-*.png`, `analysis.py`, `README.md` (series IDs, retrieval date).
- Every file ends with a bibliography in the chosen style. Every URL was opened in this run.

**Quality bar:** 0 unsourced factual claims · ≥ 60% of citations graded A for `standard`/`exhaustive` · every chart has a title, units, a source, and a date · no quote longer than 40 words.
**Memory keeps:** default citation style, his active papers and their theses, sources he rejected and why, preferred chart look.
**Board tab — "Library":** a searchable table of all saved sources (grade, project tag, date), grouped by project.

---

### 5.2 College — "The Counselor"

**Mission:** Get Maxwell to submission day with a smart school list, every requirement tracked, and essays and activities that sound like him at his best.
**Owns:** essay coaching, the deadline and requirements tracker, activities and honors optimization, school list and fit research.
**Does not own:** writing essays for him, general research papers, or finding summer programs (Scout does that).
**Model:** `opus` · **max_turns:** 40 · **integrity:** true. **Essays are capped at level 2 (§7).**

**Context it must respect:** Class of 2028. It's junior year now, and applications go out in fall 2027. He's an international applicant in Vietnam (it must cover things like financial-aid policies for international students, testing, and recommender logistics). The agent adjusts its advice to the season: planning and list-building now, drafting in summer 2027, submitting in fall 2027.

**Modes (picked at intake):**
1. **Essay coach**
   - Intake: which prompt (school + prompt text, or Common App prompt #), stage (`brainstorm` | `outline` | `feedback on draft` | `line polish`), draft file (if any), integrity level (default 1).
   - Process: *Brainstorm*: runs an interview of 8–12 probing questions through `ask_user` (one batch at a time), then offers 3 story angles, each with the "so what" and which values it shows. *Outline*: helps him build a beat outline from his own notes. *Feedback*: gives a structured critique (hook, arc, specificity, voice, reflection, prompt fit, word count) as margin-comment-style notes with quoted line references, and rewrites nothing. *Polish*: flags wordy or cliché lines and explains why. At level 2 it may show one **labeled example** sentence per issue.
   - Output: `essay-feedback-<school>-<date>.md`, and it stores the version in `essays` (status, word count, feedback summary).
2. **Tracker**
   - Maintains `colleges` and `requirements`: deadlines (ED/EA/REA/RD/UK UCAS), supplements with word limits, testing policy, recommenders, portfolio or interview needs, financial-aid forms for international students (CSS Profile, etc.). Every row stores `source_url` and `verified_at`.
   - Scheduled weekly re-verification of deadlines against the official admissions pages. Flags anything that changed.
3. **Activities optimizer**
   - Checks Common App limits exactly: **position 50 chars, organization 100 chars, description 150 chars; honors 100 chars.** It counts characters in code, not by eye. The UCAS personal statement format is supported as a separate profile.
   - Process: pulls from `profile.md` activities → proposes 2–3 tighter versions per entry (strong verb first, numbers, impact) → he picks or edits → the result is saved in `activities`. Ranks activities by strength and explains the ordering.
4. **School list & fit**
   - Builds a reach/target/likely list from stated preferences (asked through intake: majors like econ/CS, size, location US/UK/other, aid needs, vibe). Researches each school's specific programs, professors, courses, and clubs, and stores **"why us" hooks** with sources. Every stat is cited and dated.

**Quality bar:** character and word counts always computed by tool · every deadline has a source link verified within 30 days · essay feedback quotes his lines, never paraphrases them · never invents experiences or embellishes his activities.
**Memory keeps:** his voice notes (phrases he likes and hates), story bank (anecdotes he has told it), school list rationale, recommender plan.
**Board tab — "Tracker":** a schools table (round, deadline countdown, requirement checklist, status), an essays kanban (Brainstorm → Outline → Draft → Feedback → Final), and an activities list with live character counters.

---

### 5.3 Scout — "The Scout"

**Mission:** Make sure Maxwell never misses an opportunity he's eligible for and would want: competitions, summer programs, internships and research, and grants and scholarships.
**Owns:** discovering, verifying, fit-scoring, and tracking deadlines for opportunities.
**Does not own:** writing the applications (college-related → College agent; the rest are backlog agents), or general research.
**Model:** `sonnet` for scheduled sweeps, `opus` for deep dives · **max_turns:** 50 · **integrity:** false

**Triggers:**
- Scheduled **every Monday 07:00 Asia/Saigon**: a sweep across all four categories.
- Scheduled **daily 07:30**: a deadline watch with no web calls. It reads the DB and notifies if a tracked item's deadline is ≤ 14 days away and its status isn't `applied`/`skipped`.
- Manual: "Find me X" deep dives.

**Eligibility filters (hard):** high school student, Class of 2028, international applicant based in Vietnam, can do remote or travel. Must be free or state the cost clearly, and must be open to non-US citizens (or flagged if unclear).

**Process (weekly sweep):**
1. Read `profile.md` interests (econ/finance, AI/tech, debate/MUN, conservation/nonprofits in HCMC, entrepreneurship) and `memory.md` (what he liked and skipped).
2. Search per category with query templates and a list of known-good sources in memory (e.g. official competition sites, university pre-college pages, foundation grant pages). Include Vietnam- and Asia-specific sources.
3. For each candidate, **open the official page** and extract: name, org, category, deadline(s) (with timezone), eligibility, cost/stipend, format (remote/in-person + location), what's required, and the URL.
4. **Dedupe** against the `opportunities` table (by URL and normalized name). Update changed deadlines instead of inserting duplicates.
5. **Fit score 0–100** with a one-line reason: interest match (40), eligibility certainty (25), prestige/impact (20), effort vs. timeline (15). Anything < 40 is dropped silently. Unclear eligibility → a flag, not a drop.
6. Write a digest: `outputs/scout/YYYY-MM-DD-weekly.md` with **New (top 10 by fit)**, **Deadlines in the next 30 days**, and **Changed**.
7. Offer `propose_action: calendar.create_event` for deadline reminders on items he stars.

**Quality bar:** 0 opportunities without an official-source URL opened this run · deadlines always include the year and timezone · never lists an expired deadline as open · clearly marks "rolling" and "unconfirmed for 2027".
**Memory keeps:** categories and orgs he likes, items he skipped and why (to learn from), known-good sources, application outcomes.
**Board tab — "Opportunities":** a table and a kanban (`New → Interested → Preparing → Applied → Result`), filters by category, fit, and deadline, and a star to track.

---

### 5.4 School — "The Planner"

**Mission:** Keep every assignment on time without cramming. It knows what's due, breaks big work into steps, and puts realistic study blocks on the calendar.
**Owns:** assignment intake, triage, project breakdown, weekly and daily plans, study-block proposals, and integrity-aware homework help.
**Does not own:** flashcards and review (Tutor), research deep dives (Research), college work (College).
**Model:** `sonnet` for plans, `opus` for homework help · **max_turns:** 40 · **integrity:** true (for homework-help tasks)

**Data sources:**
- **Schoology iCal feed** (URL kept in the Keychain, entered in Settings). `quintet-mcp sync schoology` runs every 3 hours and at app launch. It parses VEVENTs into `school_items` (title, course, due_at, description, url, uid). Upsert by `UID` and keep the history of changed due dates.
- **Google Calendar** (read). Class schedule, fixed commitments (swim, Aikido, DevSwarm, MUN), existing events → used to find free time.
- Manual items: pasted text, rubric PDFs, or screenshots attached in Chat.

**Triggers:**
- Scheduled **Sunday 19:00**: weekly plan.
- Scheduled **weekdays 06:45**: daily plan (≤ 10 lines, shown as a notification preview).
- Manual: "break down this project", "help me with this assignment", "replan my week".

**Process (weekly plan):**
1. Load the next 14 days of `school_items` + calendar events.
2. **Triage** each item: estimate effort (it asks once per new item *type* and remembers his real durations in memory), weight (test > project > homework), and risk (due soon + big + not started).
3. **Break down** anything > 2 hours into subtasks with internal milestones (`school_subtasks`) that end ≥ 1 day before the real deadline.
4. **Schedule.** Fill free slots with study blocks (default 45–90 min, no blocks after 23:00, respect sleep and training). Never double-book an existing event.
5. Write `outputs/school/YYYY-Www-plan.md` (day-by-day list plus a "risks this week" section) and **one** `propose_action: calendar.create_events` batch holding all blocks (colored, prefixed `[Q]`), so he approves it all with one tap.
6. On replans, propose moving or deleting only `[Q]`-prefixed events it created earlier.

**Homework-help mode:** requires an integrity level (§7). At levels 0–1 it explains concepts, asks guiding questions, and checks his work. At level 2 it can show worked *examples on a different but similar problem*. It never fills in the actual graded answer below level 3.

**Quality bar:** 0 conflicts with existing calendar events · every due item within 14 days appears in the plan · plans fit real free time (no 30-hour days) · estimates improve over time (it compares planned vs. actual when he marks items done).
**Memory keeps:** real task durations by type and course, his productive hours, teachers' AI policies per course (to pre-fill the integrity level), recurring commitments.
**Board tab — "Planner":** a week view (items + `[Q]` blocks), an "Up next" list, per-item subtasks with checkboxes, and a done/late record.

---

### 5.5 Tutor — "The Tutor"

**Mission:** Make Maxwell actually remember and understand his material. It uses spaced repetition for memory, Socratic questioning for understanding, and a weak-spot tracker so practice goes where it's needed.
**Owns:** flashcard generation, the review schedule, Socratic sessions, and the weak-spot model.
**Does not own:** assignment planning (School) or graded work output.
**Model:** `sonnet` for card generation, `opus` for Socratic sessions · **max_turns:** 40 · **integrity:** true (Socratic sessions on graded material)

**Components:**
1. **Card factory.** Input is a Google Doc, a Drive file, a pasted note, or an uploaded PDF, plus course and topic tags. It produces atomic cards (one fact or idea per card): basic Q/A, cloze, and "explain why" cards. It avoids trivia, lists longer than 3 items, and ambiguous prompts. Each card links back to its source. Cards are saved through `create_cards` as **drafts**, and Maxwell accepts, edits, or deletes them in a review-the-deck screen before they enter the queue.
2. **Scheduler.** Uses **FSRS** via the `ts-fsrs` library, running in the app, not the model. The review UI is native (no chat): show → reveal → rate `Again / Hard / Good / Easy` with keyboard `1–4`, plus a daily new-card limit (default 20).
3. **Socratic session.** Intake: course, topic, goal (`understand`, `prep for test on <date>`), integrity level. Rules: never state the answer first. Ask one question at a time, grow the scaffolding with each wrong attempt (hint → narrower hint → a worked parallel example at level ≥ 2), and end with him explaining the idea back in his own words. The agent grades that explanation against a checklist.
4. **Weak-spot tracker.** Every lapse (`Again`), low self-rating, or Socratic miss writes to `weak_spots` (topic, concept, error type: `recall` | `misconception` | `application`, count, last_seen). The mastery score per topic is derived from FSRS stability + recent misses. Top weak spots feed the next session's `state_snapshot` and trigger targeted new cards.

**Triggers:**
- Scheduled **daily 20:30**: a notification with "N cards due · top weak spot: X" (no model call needed).
- Scheduled **when School has a test within 5 days**: detected in the daily DB check, proposes a focused Socratic session plus a targeted card set. This is a *shared-state read*, not agent-to-agent routing.
- Manual: "make cards from this", "quiz me on X".

**Quality bar:** cards pass an atomicity lint (≤ 1 blank per cloze, answer ≤ 15 words for basic cards) · the review UI responds in < 50 ms · Socratic sessions never give the target answer before his second attempt · weak spots decay when mastered.
**Memory keeps:** courses and their unit order, the explanation styles that worked for him, recurring misconceptions.
**Board tab — "Review":** today's due count, a review session button, a deck browser by course and topic, and a weak-spot heatmap (topic × week).

---

## 6. `quintet-mcp`: tools and protocols

A TypeScript package running on **Bun** and using `@modelcontextprotocol/sdk`. It's compiled with `bun build --compile` into a single binary and shipped as a **Tauri sidecar**. It uses `bun:sqlite` against the same DB (WAL mode, `busy_timeout=5000`). Subcommands: `serve --agent <id> --run <run_id>`, `auth google`, `exec <action_id>`, `sync schoology|calendar`, `doctor`.

The Rust side generates a per-run MCP config that passes `--agent` and `--run`, so every tool call is scoped to its agent and run. **Tools check that the calling agent is allowed to use them** (the allowlist in §6.2).

### 6.1 Tool catalog
| Tool | Kind | Notes |
|---|---|---|
| `ask_user(questions[])` | protocol | Each question: `{id, prompt, type: single|multi|text, options?}`. Writes to `questions`. Returns "Queued. End your turn now with a one-line status." |
| `propose_action(type, payload, preview_md, reason)` | protocol | Writes to `actions` with status `pending`. Returns an action_id. **The agent must never say the action happened.** |
| `save_output(path, kind, title)` | protocol | Registers a file in the run's output folder (`md`, `csv`, `png`, `docx`). |
| `save_source(...)` / `list_sources(project?)` | research | Research only |
| `calendar_list_events(from, to, calendars?)` | read | Google Calendar |
| `calendar_free_slots(from, to, min_minutes)` | read | Computed by code, not the model |
| `gmail_search(query, max)` / `gmail_read(id)` | read | Scout and College (admissions/program mail). Snippets by default, full body on request. |
| `drive_search(query)` / `drive_read(file_id)` | read | Docs exported as markdown, PDFs as text |
| `school_items(from, to)` / `school_subtasks_upsert` | read / internal | School |
| `cards_create(cards[])` / `weak_spots(top_n)` / `weak_spot_log` | internal | Tutor |
| `colleges_upsert` / `requirements_upsert` / `essays_upsert` / `activities_upsert` / `char_count(text, limit)` | internal | College |
| `opportunities_upsert` / `opportunities_query` | internal | Scout |
| `now()` | util | The current time in Asia/Saigon, so the model never guesses dates |

"Internal" = writes to Quintet's own DB. These are allowed without approval because they're undoable inside the app.

### 6.2 Action types (executed only by `quintet-mcp exec` after approval)
| Type | Payload | Proposed by |
|---|---|---|
| `calendar.create_events` | `[{title, start, end, color, description}]` (titles auto-prefixed `[Q]`) | School, Scout, Tutor |
| `calendar.update_events` / `calendar.delete_events` | event ids. **Only for `[Q]` events Quintet created** (tracked in `quintet_events`) | School |
| `gmail.create_draft` | `{to, subject, body_md, thread_id?}`. Creates a **draft**. Quintet never sends email in v1. | College, Scout |
| `drive.create_doc` | `{title, folder, content_md}` → Google Doc in `Quintet/<agent>/` | Research, College |

Approval UI: the preview is rendered in markdown. Buttons are **Approve** (⌘↩), **Edit** (edits the payload JSON through a form), and **Reject** (with an optional reason that goes to the agent's memory as feedback). Batches can be approved partially, checkbox per item. Every executed action logs its result, and delete-type actions store an undo record for 24 hours.

### 6.3 Question protocol
1. The agent calls `ask_user` and ends its turn. Run status → `waiting_user`. A macOS notification appears: "*Research* has 2 questions".
2. Maxwell answers in a native form (chips for options) in the agent's Chat tab or from the Approvals inbox.
3. The app resumes: `claude -p --resume <session_id> "<answers as YAML>"`.
4. Scheduled runs that hit a question wait until he answers. After 48 hours the run is marked `stale` and skipped.

### 6.4 Output protocol
Outputs go to `~/Quintet/outputs/<agent>/<YYYY-MM-DD>-<slug>/`, and each file is registered with `save_output`. The agent's final message must be a **≤ 5-line summary** listing what was produced, which proposals are waiting, and any open questions. The UI shows this as the run's result card.

### 6.5 Protocol prompt (fixed text, injected first)
Keep it short and firm, with rules like these:
- You are one specialist in Quintet. Stay inside your mission. If a request belongs to another agent, name that agent and stop.
- You cannot send, create, or delete anything outside Quintet. Use `propose_action` and say "proposed", never "done".
- Use `now()` for dates. All times are Asia/Saigon unless a source says otherwise. Always state the timezone for deadlines.
- Cite only pages you opened in this run.
- Obey the integrity level in Run context exactly (§7).
- Update `./memory.md` only with durable learnings. Keep it ≤ 200 lines.
- Finish with the ≤ 5-line summary.

---

## 7. Academic integrity levels

Picked **per assignment** at intake by School, Tutor, Research (when graded), and College. It's pre-filled from the course's saved policy in School's memory. A colored pill in the run header shows the current level.

| Level | Name | Agent may | Agent may not |
|---|---|---|---|
| 0 | **No AI** | Plan, schedule, remind | Touch content at all |
| 1 | **Coach only** *(default)* | Explain concepts, ask guiding questions, give feedback on *his* work, check answers he wrote | Write any text or solution he could submit |
| 2 | **Labeled examples** | Everything in L1, plus short examples on a *parallel* problem or sentence, each boxed as `EXAMPLE — rewrite in your own words` | Produce the actual answer or submission text |
| 3 | **AI-assisted (teacher allows)** | Draft sections he'll revise, with a disclosure note added to the output | Pretend the work is unassisted |

**Hard caps (not overridable in the UI):**
- **College essays and application text: max level 2.** Admissions essays have to be the applicant's own work, and Common App treats substantive AI-written content as a policy violation.
- Tests and quizzes in progress: level 0. If a School task looks like a live test, the agent refuses and says why.

Enforcement: at level ≤ 1 the run's tool permissions narrow `Write`/`Edit` to `./memory.md` only (use the path-scoped permission rule syntax verified in Phase 0, e.g. `Write(./memory.md)`), so the agent physically can't produce a prose deliverable file. It can only write feedback through `save_output(kind: "feedback")`.

---

## 8. Data model (SQLite)

Put migrations in `db/migrations/0001_init.sql`, and so on. Every table has `id TEXT PRIMARY KEY` (ULID), `created_at`, and `updated_at`.

- **Core:** `agents` (cache of the parsed frontmatter + hash), `runs` (agent_id, trigger, status, session_id, integrity_level, intake_json, started_at, ended_at, cost_usd, tokens_in, tokens_out, turns, error), `run_events` (run_id, seq, type, json), `tasks` (agent_id, title, body, status, due_at, run_id), `questions` (run_id, json, answered_json, status), `actions` (run_id, agent_id, type, payload_json, preview_md, status, result_json, executed_at), `outputs` (run_id, agent_id, path, kind, title), `schedules` (agent_id, name, cron, last_run_at, next_run_at, enabled), `quintet_events` (google_event_id, action_id), `settings` (key, value).
- **Research:** `sources` (url, title, author, published_at, grade, project, relevance, quotes_json).
- **College:** `colleges` (name, round, deadline_at, status, fit, notes, source_url, verified_at), `requirements` (college_id, kind, detail, word_limit, due_at, done, source_url, verified_at), `essays` (college_id?, prompt, stage, word_count, file_path, feedback_md), `activities` (position, org, description, hours, weeks, grades, rank, char_counts_json), `honors`.
- **Scout:** `opportunities` (name, org, category, url, deadline_at, deadline_tz, rolling, eligibility, eligibility_flag, cost, format, location, fit, fit_reason, status, starred, last_verified_at).
- **School:** `school_items` (uid, course, title, description, due_at, url, source: ical|manual, est_minutes, actual_minutes, status, due_history_json), `school_subtasks` (item_id, title, due_at, done), `course_policies` (course, integrity_level, note).
- **Tutor:** `cards` (deck, course, topic, type, front, back, source_ref, status: draft|active|suspended), `card_state` (card_id, FSRS fields: due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review), `reviews` (card_id, rating, reviewed_at, duration_ms), `weak_spots` (course, topic, concept, error_type, count, last_seen, mastery).

---

## 9. UI spec

### 9.1 Window
- Tauri window with `titleBarStyle: "Overlay"`, hidden title, and native traffic lights. **Sidebar vibrancy** via the `window-vibrancy` crate (`NSVisualEffectMaterial::Sidebar`).
- Font: `-apple-system, "SF Pro Text"`. Mono: `"SF Mono", ui-monospace`. Colors come from CSS variables mapped to macOS system colors (label, secondaryLabel, separator, controlAccentColor). Light and dark follow the system.
- Density and spacing like Mail and Notes: 13px base text, 28px sidebar rows, 8px grid, subtle separators, no heavy shadows. Motion is limited to 150–200 ms ease-out fades and slides. Respect `prefers-reduced-motion`.
- Build components on **Radix primitives + Tailwind v4** with custom tokens. Don't use a web-looking UI kit. Every control should look like it belongs on macOS (segmented controls, popovers, sheets).

### 9.2 Structure
```
┌ Sidebar ─────────┬ Agent workspace ─────────────────────────────────────┐
│ ● Approvals  (3) │  [icon] Research   · idle · next: —      [New task ⌘N]│
│ ◷ Activity       │  ┌ Chat │ Queue │ Library │ Outputs ┐                  │
│ ── Agents ────── │  │                                  │                  │
│ ◉ Research       │  │   streamed run / result cards    │                  │
│ ◉ College    •   │  │                                  │                  │
│ ◉ Scout      2   │  │                                  │                  │
│ ◉ School         │  └──────────────────────────────────┘                  │
│ ◉ Tutor     18↻  │  [ composer — ⌘↩ to run ]                              │
│ ── ───────────── │                                                        │
│ ⚙ Settings       │                                                        │
└──────────────────┴────────────────────────────────────────────────────────┘
```
- Sidebar rows show the agent icon and name, plus a status dot (idle / running / waiting / error) and a badge (pending approvals or questions, or cards due for Tutor).
- **Chat** shows the conversation with this agent. Runs render as collapsible tool-step rows with the final summary card on top. Intake forms appear inline as sheets.
- **Queue** lists tasks and runs (queued, running, waiting, done, failed), with the upcoming schedules for this agent and a "Run now" button for each.
- **Board** is agent-specific (§5): Library / Tracker / Opportunities / Planner / Review.
- **Outputs** is a file list with Quick Look previews (render md, png, and csv tables inline), plus "Reveal in Finder" and "Open in…".
- **Approvals** is a global inbox of pending actions and questions from all agents, grouped by agent, with keyboard triage (J/K to move, ⌘↩ to approve, ⌫ to reject).
- **Activity** is a global timeline of runs with cost, duration, and status, and a link to the raw log.
- **Settings** holds Google connection, Schoology iCal URL, Claude CLI status, schedules on/off per agent, notification preferences, launch at login, default models, the data folder, and the weekly usage meter.

### 9.3 Keyboard
`⌘1–5` switch agents · `⌘0` Approvals · `⌘N` new task for the current agent · `⌘↩` run / approve · `⌘K` quick switcher (navigation only, no routing) · `⌘,` Settings · `Esc` close sheet · Tutor review: `Space` reveal, `1–4` rate.

---

## 10. Scheduler, tray, notifications

- **Scheduler:** `tokio-cron-scheduler` in Rust. Crons come from `agent.md` `schedules[]` entries, each `{name, cron, tz: Asia/Saigon, task, model?, enabled}`. Store `last_run_at` and `next_run_at`. **Catch-up:** at launch and on wake from sleep (listen for `NSWorkspaceDidWakeNotification`), each schedule that missed its slot runs *once*, and only if it's less than 24 hours late. "DB-only" schedules (Scout's deadline watch, Tutor's due count) run in Rust with no model call.
- **Tray:** a menu-bar icon (a monochrome template image). Its menu shows: pending approvals count → open Approvals · running runs · "Pause all schedules for 1h / until tomorrow" · Open Quintet · Quit. Closing the window only hides it (`prevent_close` → hide). **Launch at login** is on by default via `tauri-plugin-autostart`.
- **Notifications** (`tauri-plugin-notification`): questions waiting · approvals waiting · a scheduled run failed · a deadline ≤ 72h (Scout or School) · Tutor daily cards due · School daily plan. Each type can be toggled in Settings. Clicking a notification opens the right screen. There's a quiet-hours window (default 23:00–06:30).

---

## 11. Security and privacy

- Everything stays local except Google API calls and the Claude CLI's own traffic. No analytics.
- The Google OAuth desktop flow (loopback redirect) uses scopes limited to: `calendar.events`, `calendar.readonly`, `gmail.readonly`, `gmail.compose` (drafts only), `drive.readonly`, `drive.file` (only files Quintet creates). Tokens are stored in the Keychain via `keytar` or Bun FFI. Maxwell creates the OAuth client in his own Google Cloud project, and Settings shows step-by-step instructions.
- The Schoology iCal URL is a secret. It goes in the Keychain and is never logged.
- Run logs strip Gmail bodies after 30 days (they keep the metadata only).
- Agents run with `cwd` = their own workspace. Deny file access outside `~/Quintet/` (via the permission settings from Phase 0 notes).
- Backups: a nightly `VACUUM INTO ~/Quintet/backups/quintet-YYYYMMDD.db`, keeping 14.

---

## 12. Build phases (each ends with build + run + acceptance check)

**Phase 0: CLI spike** (no UI)
- Write `docs/claude-cli-notes.md` per §3.1, and a 30-line Rust or TS script that runs `claude -p` with stream-json and prints parsed events.
- ✅ The notes list verified flags. A sample run with a stub MCP server shows `system/init` listing the MCP tool. `--resume` continues a session. Isolation from user-level skills is confirmed (the init event shows no user skills).

**Phase 1: Shell + registry + first run**
- Tauri app with the sidebar, vibrancy, light and dark modes. First-launch creation of `~/Quintet/` from `agents-default/`. The Registry parses and watches `agent.md` files. SQLite with migrations. Chat tab runs a manual task for any agent and streams events live. Result card. Activity tab.
- ✅ Editing `agents/research/agent.md` updates the sidebar within 1 second. A broken YAML file shows an error badge and doesn't crash the app. A Research run on "What is FSRS?" streams tool steps and finishes with a summary. Cost and turns are saved.

**Phase 2: Protocols (intake, questions, approvals, outputs)**
- `quintet-mcp serve` with `ask_user`, `propose_action`, `save_output`, and `now`. Intake forms from frontmatter, including `skip_if`. The Approvals inbox (no executors yet; the "approve" button marks the action approved). Resume flow. Outputs tab with previews. Integrity pill and tool-stripping.
- ✅ A test agent that asks 2 questions → notification → answer → resume → finishes. A proposed action appears in Approvals with its preview. At integrity level 1 the run can't write a non-memory file (verified). Kill-the-app-mid-run → on relaunch the run shows `failed` with its reason.

**Phase 3: Integrations**
- `quintet-mcp auth google`, the Calendar, Gmail, and Drive read tools, `calendar_free_slots`, the executors for all §6.2 actions with `[Q]` tracking, and the Schoology iCal sync.
- ✅ Connects Google from Settings. `school_items` fills from his real iCal URL. Approving a `calendar.create_events` batch of 3 creates exactly 3 `[Q]` events. `gmail.create_draft` creates a draft (nothing is sent). Revoking the Google connection shows a clean re-auth banner.

**Phase 4: Scheduler + tray + notifications**
- Crons, catch-up on launch and wake, tray menu, launch at login, notification types, quiet hours, pause-all.
- ✅ A schedule set 2 minutes out fires with the window closed. Sleeping the Mac through a slot → it runs once on wake. Quiet hours hold notifications until morning.

**Phase 5: School agent (full)**: weekly and daily plans, triage, breakdown, study-block proposals, Planner board, homework-help mode, course policies.
- ✅ Using his real week, the Sunday plan has 0 conflicts and every item within 14 days appears. One-tap approval adds the blocks. A replan only moves `[Q]` events.

**Phase 6: Tutor agent (full)**: card factory with draft review, native FSRS review UI (`ts-fsrs`), Socratic sessions, weak-spot tracker and heatmap, test-in-5-days trigger.
- ✅ 20 cards generated from a Google Doc pass the atomicity lint. A review session works fully from the keyboard. An `Again` rating creates or increments a weak spot. An upcoming test in `school_items` triggers the proposal.

**Phase 7: Research agent (full)**: all three outputs, source grading, claim table verification, `uv`-based charts, Library board, `drive.create_doc`.
- ✅ A `standard` brief on one of his real paper topics has 0 unsourced claims (checked against the claim table). A data run produces a CSV, a PNG, and `analysis.py` that re-runs on its own.

**Phase 8: College agent (full)**: four modes, Tracker board, exact character counters, weekly deadline re-verification, level-2 essay cap.
- ✅ Activities over 150 characters are flagged with the exact count. Every deadline row has `source_url` and `verified_at`. Asking for a "full essay draft" is refused and pointed to the brainstorm or outline modes.

**Phase 9: Scout agent (full)**: weekly sweep, daily deadline watch, dedupe, fit scoring, Opportunities board, digest.
- ✅ Two consecutive sweeps create no duplicates. Every item has an official URL. The digest lists deadlines with the year and timezone. Starring an item → it proposes a calendar reminder.

**Phase 10: Polish**: empty states, error copy, a usage meter, backups, `quintet-mcp doctor`, an app icon, and a signed local build (`tauri build`, ad-hoc signing is fine for personal use).
- ✅ A cold start in under 1.5 seconds. No console errors. Every screen works in both light and dark mode. The WCAG AA contrast ratio is computed (not eyeballed) for text tokens.

---

## 13. Backlog agents (post-v1, same framework)

Each gets its own `agent.md` later. No framework changes should be needed. If one is, write an ADR.

| Agent | One-line mission |
|---|---|
| Email & outreach | Triage the inbox, draft replies and cold outreach in his voice, track follow-ups (drafts only, then approval) |
| Calendar & planner | Own the whole calendar beyond school: protect focus time, balance training, work, and projects |
| Builder / coder | Turn a spec into a phased Claude Code build in a chosen repo folder, with build/test gates |
| Finance / markets | Stock and macro research for Wharton and the IFC: theses, comps, valuation sanity checks, cited |
| Content & social | Posts, scripts, and launch copy for Debate Buddy and his personal brand, with a content calendar |
| Debate & MUN | Cut cards, write cases, run mock cross-ex, write position papers and bloc strategy |
| Language coach | Daily Mandarin (HSK 5 track) and Vietnamese drills, corrections, and conversation practice |
| Network CRM | Contacts, relationship notes, follow-up reminders, and pre-call briefs |
| Files & life admin | Organize Downloads and Drive, rename files, handle forms and receipts (moves proposed, never deleted without approval) |
| Writing editor | Edit his drafts in his voice and remove AI-sounding patterns (integrity-aware) |

---

## 14. Engineering conventions

- **TypeScript strict** everywhere, with `zod` validation at every IPC and MCP boundary. Rust: `thiserror` for errors, `tracing` for logs, no `unwrap()` outside tests.
- IPC types are defined once (`src/lib/types.ts`) and mirrored in Rust with `ts-rs` generation, so they don't drift.
- Tests: Rust unit tests for the stream parser (use fixture `.jsonl` files captured in Phase 0), the scheduler catch-up logic, and prompt assembly. Bun tests for iCal parsing, `char_count`, FSRS wrappers, dedupe, and the action executors (with Google mocked). One Playwright smoke test per phase against `tauri dev`.
- Small commits, one feature each. Conventional commit messages. Write an ADR in `docs/decisions/` for any deviation from this file.
- Never hardcode Maxwell's personal data in code. It lives in `~/Quintet/shared/profile.md`, which is seeded from `shared-default/profile.md` (a template with headings: School & grades · Courses this year · Activities · Interests · College goals · Constraints & schedule · Voice notes).

## 15. Do not

- Add a router, orchestrator, or agent-to-agent calls.
- Let any agent send email, delete non-`[Q]` calendar events, or write to Drive without an approved action.
- Use the Anthropic API directly or ask for an API key. v1 is Claude Code headless only.
- Load Maxwell's global Claude skills or CLAUDE.md into agent runs.
- Guess CLI flags. Verify them in Phase 0 and in `docs/claude-cli-notes.md`.
- Generate college essay text, or answer live tests.
- Start a phase before the previous phase's ✅ checks pass.
