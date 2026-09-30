# GRIMOIRE — CLAUDE.md

A local, single-user multi-agent harness. It wraps CLI coding agents you already pay for
(`claude`, `codex`, `gemini`, `qwen`, …), gives each one an identity, a workspace, a memory
and an autonomy setting, and lets you watch and steer them from one desk.

Themed as a working wizard's study: the agents are familiars, their instructions are
writs, their memory is a codex, and nothing acts on the world without your seal.

Everything runs on the local machine. There is no server, no account, no billing, no
telemetry, no cloud sync. One user: the person who built it.

---

## 0. How to use this file

You (Claude Code) are the sole implementer. Read this file in full before writing code.

Rules of engagement:

- Build in the phase order given in §10. Do not start a phase until the previous phase's
  acceptance criteria all pass.
- At the end of every phase: **build it and run it**. `npm run tauri dev` must launch, the
  feature must work by hand, and you must report which acceptance criteria passed and which
  failed. Never report a phase complete on the strength of the code compiling.
- Write the test before you claim the behaviour. Any claim like "the breaker stops a
  runaway" needs a test that actually drives it.
- If a spec decision here turns out to be wrong once you're in the code, stop and say so
  rather than silently substituting something else. Propose the change, wait for a yes.
- Keep `DECISIONS.md` in the repo root. One entry per architectural change: date, what
  changed, why, what it replaced.
- Keep `TASKS.md` in the repo root. Append a short session log at the end of every working
  session: what got built, what broke, what's next.

---

## 1. Licensing and originality — read first, this is not optional

This project is inspired by existing open-source agent harnesses. The rules:

- **Do not copy source code** from any other project into this repo. Not files, not classes,
  not "the same function with different variable names." Read other projects for ideas about
  architecture; write this one from scratch.
- **Do not vendor art assets** from anywhere. No purchased or licensed tilesets, no sprite
  packs, no ripped UI, no stock images, nothing downloaded. Every visual in this app is one of:
  drawn in code (SVG, canvas, Pixi `Graphics`); a free open-licence typeface; or made by the
  owner. **Art generated on the owner's own Higgsfield account, at the owner's direction, for
  this project, is made by the owner** (DECISIONS 0020), and new art is generated there.
- **Generated art follows five rules**, and a file that breaks one does not ship:
  1. Higgsfield only, on the owner's account. No other generator, no image from anyone else's.
  2. References are this repository's own images only: earlier generations, code-drawn marks,
     diagrams drawn from the code. No prompt names another work, artist, studio, game, film or
     franchise, and none asks for anyone's style.
  3. Every generated file has its row in `src/assets/higgsfield/PROVENANCE.md` — job id, model,
     prompt, references, and what was done to it afterwards — in the same commit that adds it.
     `git ls-files '*.png' '*.jpg'` read against that file is the audit for this section.
  4. No names, captions or text in the pixels. The canon in the next bullet binds generated
     figures exactly as it binds everything else.
  5. State lives in code. A generated image may set the scene; it is never the only place a
     state, a click target or a warning is shown, and everything generated has a fallback drawn
     in code for when it fails to load.

  If a phase seems to need art we don't have, generate it under these rules, or use the
  code-drawn fallback described in §7 and move on. Where a later section says something is
  "drawn in code" or asks for "no image files" (§7.4, §8.1, §10 Phases 5 and 9), read it with
  this exception: the scene may be a registered Higgsfield image, and what that section protects
  — nothing owed to anyone, every state exact in code — still holds.
- **Every name, character, house, spell, creature and place in this app is original to this
  project.** The naming system in §3 is the canon. Do not substitute names from published
  fiction, films, or games — not in the UI, not in comments, not in seed data, not in agent
  personalities, not as "placeholders we'll change later." If a new noun is needed, invent one
  in the register established in §3 and add it to the glossary.
- Third-party libraries keep their licences. Maintain `THIRD-PARTY.md` listing every runtime
  dependency and its licence. `npm run licences` regenerates it.
- This repo is private and personal. If it is ever made public, §1 gets re-read and a
  proper LICENSE and attribution pass happens first.

---

## 2. What this is, and what it is not

### It is

A desktop app where you can:

- Define a familiar in a markdown file, and have it appear in the app.
- Summon it: spawn a real pseudo-terminal running an agent CLI, with a working directory,
  a model, a writ (system briefing) and a memory file.
- Watch its terminal live, type into it, and steer it mid-run.
- Give it a commission (a task), let it work, and get notified when it needs you.
- Hold it to an autonomy level, from "propose everything" to "act freely inside this folder."
- Cap what it can spend — in tokens, in wall-clock, in turns — and have it stopped
  automatically when it exceeds the cap.
- Schedule recurring commissions that run with the window closed.
- Keep a durable record of everything it did, what it cost, and what it remembered.

### It is not

- Not a hosted service. No auth, no multi-tenant, no sync.
- Not a model provider. It drives CLIs you already have installed and already pay for.
- Not an agent-builder GUI. Familiars are files, edited in your editor. (§4)
- Not an orchestrator in v1. You pick which familiar does what. Routing comes in Phase 6,
  and even then it proposes rather than decides.
- Not a code editor, not a chat app, not a note-taking app.

### Non-goals, explicitly

Team features. Sharing. A marketplace. Mobile. Windows/Linux parity in v1 (macOS first;
keep the code portable but do not spend time on cross-platform polish).

---

## 3. The world — naming, tone, glossary

The theme is a scholar-magician's study: astronomy instruments, marginalia, sealed letters,
ledgers of ink, wards drawn on the floor. Late-medieval manuscript, not high fantasy. No
wands, no chosen ones, no boarding schools. The register is dry, precise and slightly archaic —
a librarian's magic, not a wizard duel.

Every term below is the canonical UI string. The code uses the same words, so there is no
translation layer between what the user reads and what the developer greps for.

| Concept | Name in Grimoire | Code identifier |
|---|---|---|
| The app | Grimoire | — |
| An agent | familiar | `Familiar` |
| An agent's definition file | binding | `*.binding.md` |
| The system prompt / briefing | writ | `writ` |
| A task given to a familiar | commission | `Commission` |
| A running agent process | summoning | `Summoning` |
| The agent's persistent memory | codex | `codex` |
| Shared cross-familiar memory | the reliquary | `reliquary` |
| The approval gate (HITL) | the seal | `Seal` |
| Token/turn/time budget | aether | `aether` |
| Spend record | ledger of ink | `Ledger` |
| Recurring schedule | standing ward | `StandingWard` |
| Circuit breaker states | steer → bind → banish | `Breaker` |
| The main floor view | the scriptorium | `Scriptorium` |
| Optional coordinating familiar | the archivist | `Archivist` |
| An error / failed run | a misfire | `Misfire` |
| Settings | the workbench | `Workbench` |

### Orders

Each familiar belongs to one order, which sets its sigil colour and its default writ
preamble. Orders are a labelling and defaults system — they grant no special powers.

| Order | Domain | Sigil colour |
|---|---|---|
| Quill | writing, drafting, editing | brass `#B08D3F` |
| Lantern | search, scouting, research, reading | verdigris `#4E7A6B` |
| Crucible | building, code, refactors, tests | oxblood `#7A1F2B` |
| Compass | planning, scheduling, triage | slate-blue `#5A6B8C` |
| Ledger | data, numbers, analysis | bone `#C9BFA4` |

### Voice rules for all UI copy

- Sentence case. No ALL-CAPS labels.
- Active voice, and the verb on the button is the verb in the result. "Summon" → "Summoned."
  "Seal" → "Sealed." "Banish" → "Banished."
- Errors state what happened and what to do. They do not apologise and they are never vague.
  Bad: "Something went wrong." Good: "The `claude` binary isn't on your PATH. Set its location
  in the workbench."
- Empty states are invitations: "No familiars bound yet. Drop a `.binding.md` in `~/.grimoire/bindings`."
- The theme lives in the nouns, not in the sentence structure. Don't write faux-archaic
  English. "Summon Vellum" is right; "Wouldst thou summon Vellum?" is not.

---

## 4. Familiars are files

A familiar is a markdown file with YAML frontmatter in `~/.grimoire/bindings/`. The app watches
that folder and hot-reloads. There is no in-app editor for bindings; there is a "Reveal in
Finder" button and a "Reload bindings" button.

`~/.grimoire/bindings/vellum.binding.md`

```markdown
---
name: Vellum
order: quill
sigil: quill-01              # which generated sigil to draw (§7.4)
engine: claude               # claude | codex | gemini | qwen | custom
model: claude-sonnet-4-6     # passed through to the CLI; app never validates model names
workspace: ~/work/essays     # cwd for the spawned process
isolation: worktree          # none | worktree | copy   (§6.3)
resume: session              # none | session  — reattach to the prior CLI session on summon

autonomy: propose            # propose | bounded | free  (§6.4)
bounds:                      # only read when autonomy: bounded
  write: ["~/work/essays/**"]
  deny:  ["**/.env", "**/.git/config", "~/.ssh/**"]
  network: false
  shell: ["git status", "git diff", "npm test"]

aether:
  tokens: 250000             # per commission
  turns: 40
  minutes: 30
  on_exceed: bind            # steer | bind | banish

codex: ~/.grimoire/codex/vellum.md
reliquary: read              # none | read | write

intake:                      # questions asked before every commission (§6.2)
  - id: piece
    ask: "Which piece are we working on?"
    type: text
    required: true
  - id: mode
    ask: "What kind of pass?"
    type: select
    options: [line edit, structural, fact check, cut for length]
    required: true
  - id: audience
    ask: "Who reads it?"
    type: text
    required: false
---

# Writ

You are Vellum, an editor. You work on one piece at a time and you do not rewrite
wholesale — you propose changes and explain the reason for each.

## Process
1. Read the piece in full before commenting on any part of it.
2. Identify the argument. If you can't state it in one sentence, say so and stop.
3. Make the pass the user asked for, and only that pass.
4. Return a diff plus a numbered list of changes with one-line justifications.

## Goal
The piece says what the author meant, in the author's voice, in fewer words.

## Refusals
If asked to write the piece from scratch, decline and say that's a different familiar.
```

### Parsing rules

- Frontmatter is parsed with a real YAML parser, validated with Zod. A binding that fails
  validation is shown in the sidebar in oxblood with the validation error inline — never
  silently dropped, never partially loaded.
- Everything after the frontmatter is the writ, passed verbatim to the CLI as its system
  prompt/append-system-prompt. Do not template it, do not inject anything into it except the
  documented `{{intake.*}}` substitutions.
- Unknown frontmatter keys are a validation warning, not an error.
- `~` expands. Relative paths resolve against the bindings folder.

### Seeded familiars

Ship five bindings in `seeds/` that the workbench can copy in on first run. Write them for the
owner's actual life, not generic demos:

- **Vellum** (quill) — editor. Above.
- **Sconce** (lantern) — research deep-dives. Output is a brief with real citations, or a full
  literature review, or data plus charts. Never an annotated bibliography.
- **Astrolabe** (compass) — calendar and deadline triage. Reads an iCal feed and a calendar,
  proposes a week.
- **Anvil** (crucible) — builder. Runs in a git worktree, always opens a branch, always runs
  the test suite before it claims done.
- **Tally** (ledger) — numbers. Markets, spreadsheets, anything that needs arithmetic shown.

---

## 5. Stack and repo layout

### Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri v2 | Small binary, Rust backend, you already know it |
| UI | React 19 + TypeScript + Vite | Existing stack |
| Styling | Tailwind v4 with the token layer in §7 | Existing stack |
| Terminals | `portable-pty` (Rust) + xterm.js (front) | Real PTYs, no Electron |
| State | Zustand | Small, no ceremony |
| Storage | SQLite via `tauri-plugin-sql` (sqlx) | Durable, local, queryable |
| Scheduling | `tokio-cron-scheduler` in the Rust process | Runs with window closed |
| Validation | Zod (TS) + serde (Rust) | Both sides validate |
| The floor | PixiJS v8 (WebGL) | Draws the tower plan and the familiars on it — §8 |

**On Tauri vs Electron.** Electron + `node-pty` is the better-trodden path for this exact
problem and there is more prior art to read. Tauri + `portable-pty` is leaner, matches the
existing stack, and keeps the binary under ~15 MB. Go Tauri. If PTY handling in Rust costs
more than one full working session of thrash in Phase 1, stop and say so — switching to
Electron at the end of Phase 1 is cheap, and at the end of Phase 4 it is not.

### Layout

```
grimoire/
  src-tauri/
    src/
      main.rs
      summon/          # PTY spawn, lifecycle, resume
      breaker/         # aether accounting, steer/bind/banish
      ward/            # scheduler
      ledger/          # cost + event persistence
      codex/           # memory file read/condense/write
      db/              # migrations + queries
      security/        # path allow-lists, bounds enforcement
    migrations/
  src/
    scriptorium/       # the floor (§8) and the per-familiar pane
    familiar/          # per-familiar workspace: terminal, commissions, outputs
    seal/              # approval queue UI
    workbench/         # settings
    ledger/            # spend + history views
    ui/                # primitives: Sigil, Panel, Pill, Meter, Rule
    theme/             # tokens.css, fonts
  seeds/               # example bindings
  DECISIONS.md
  TASKS.md
  THIRD-PARTY.md
```

---

## 6. Core systems

### 6.1 Summoning

A summoning spawns the engine binary in a PTY with the familiar's cwd, env, model flag and
writ. Requirements:

- Resolve the binary via the workbench's configured path, then `PATH`. If it is not found, the
  familiar's summon button is disabled with the reason shown on hover — not a runtime crash.
- Stream PTY output to the frontend over a Tauri channel, chunked, backpressured. The terminal
  must stay responsive under a `cat` of a 50k-line file.
- Handle resize (`SIGWINCH`) on panel resize.
- On app quit: graceful stop (SIGINT, wait 5s, SIGTERM, wait 3s, SIGKILL) for every summoning,
  and persist the intent to restore.
- On app start: if summonings were live at last quit, show a "Restore the floor" banner. One
  click restores them all. Never auto-restore without asking.
- Never log the writ, prompts, file contents or agent output to any file except the local
  session transcript the user can see and delete.

### 6.2 Commissions and intake

- User picks a familiar and clicks "New commission."
- The intake questions from the binding are rendered as a form. Required fields block submit.
- Answers are substituted into the commission prompt as `{{intake.piece}}` etc.
- The commission is written to SQLite as `queued`, then dispatched.
- Status: `queued → running → awaiting seal → running → done | banished | misfired`.
- A familiar runs one commission at a time. New commissions queue behind it, visibly.

### 6.3 Isolation

- `none` — runs directly in `workspace`.
- `worktree` — on summon, create `git worktree add` in `~/.grimoire/worktrees/<familiar>-<id>`.
  Branch name `grimoire/<familiar>/<id>`. Refuse to summon if `workspace` is not a git repo.
  On commission end, leave the worktree; offer "Merge" / "Discard" in the outputs panel.
- `copy` — rsync the workspace into a scratch dir, honouring `.gitignore`.

### 6.4 Autonomy and the seal

| Level | Meaning |
|---|---|
| `propose` | The familiar may read and think. Any write, shell command, or network call produces a seal request and the summoning pauses. |
| `bounded` | Writes inside `bounds.write` proceed. Anything outside, anything in `bounds.deny`, network if `network: false`, and any shell command not matching `bounds.shell` produce a seal request. |
| `free` | Writes and shell proceed inside `workspace`. Network proceeds. Deletes, force-pushes, and anything outside `workspace` still produce a seal request. |

**Nothing is ever exempt from the seal**: sending a message, sending an email, deleting a file
outside the workspace, `git push --force`, anything that spends money, and any write to a path
containing `.env`, `.ssh`, `credentials`, or `.git/config`. This list is in code, not in config,
and `free` does not override it.

The seal UI: a queue in the left rail with a count badge, plus a macOS notification. Each
request shows the familiar, the exact action, the exact target path or command, and a diff
where one applies. Three buttons: **Seal**, **Seal and don't ask again for this commission**,
**Refuse**. Refuse sends the refusal back into the PTY as a message so the familiar can adapt.

Seal requests time out after 30 minutes into `bind`.

### 6.5 Aether and the breaker

Meter three things per commission: tokens (parsed from the CLI's own reporting where it emits
it, wall-clock otherwise), turns, and minutes. Show all three as thin meters on the familiar's
card.

At 80% of any budget: the card's rule turns brass, and a steer message goes into the PTY
("You are at 80% of your budget for this commission. Prioritise finishing over exploring.").

At 100%, act on `on_exceed`:

- `steer` — inject a hard message, keep running, re-warn every 10%.
- `bind` — stop accepting new tool calls, let the current turn finish, then pause and raise a
  seal request asking whether to extend.
- `banish` — graceful stop, mark the commission `banished`, notify.

A heartbeat in the Rust process ticks every 5s. If a summoning has produced no PTY output
and no token movement for 10 minutes, it is a **stall**: raise it in the seal queue with
"Stalled — steer, or banish?" Never kill a stalled summoning silently.

Runaway guard, separate from budgets: more than 200 tool calls in a commission, or more
than $X of estimated spend (set in the workbench), triggers `banish` regardless of `on_exceed`.

### 6.6 Codex and the reliquary

Each familiar has one markdown codex file. It is passed to the CLI on summon and the familiar
is told, in the engine preamble, that it may append to it.

When a codex passes 8,000 words, run a **condense**: spawn a one-shot agent whose only job is
to rewrite the codex shorter, keeping facts and decisions, dropping narration. Write the
result to `<codex>.md` and the previous version to `<codex>.<timestamp>.bak`. Never condense
without keeping the backup.

The reliquary is one shared `~/.grimoire/reliquary.md`. `read` familiars get it in context.
`write` familiars may append — every append is a seal request. This is deliberate: shared
memory is exactly where one bad familiar poisons the rest.

### 6.7 Standing wards

A ward is `{familiar, cron, commission prompt, intake answers, enabled}`. Stored in SQLite,
scheduled in Rust, so it fires with the window closed.

- The prompt is sent verbatim every run. No drift, no "improve the prompt" logic.
- A ward whose familiar is already busy skips that run and records `skipped: busy`. It does not
  queue up — a daily ward that has skipped 30 times must not stampede.
- Every ward run posts a macOS notification on completion or seal request.

The app lives in the menu bar. Closing the window does not quit. Quit is explicit, from the
menu-bar item, and it warns if summonings are live.

### 6.8 The archivist (Phase 6, optional)

One designated familiar may be marked `archivist: true`. It gets read access to the roster, the
commission queue and the ledger, and it may **propose** — never dispatch — commissions to other
familiars. Every proposal lands in the seal queue as "Astrolabe proposes: send Sconce to …".

The archivist never spawns familiars, never edits bindings, never has `free` autonomy. If this
feels restrictive, it is; a coordinating agent with dispatch rights is the single most expensive
failure mode in this class of app.

### 6.9 The ledger

Append-only table of events: summon, commission start/end, tokens, estimated cost, seal
requests and their resolutions, breaker trips, misfires. The ledger view shows spend by
familiar, by day, by engine, and a per-commission waterfall of how long each phase took.

Estimated cost is **labelled as estimated** everywhere it appears. Never display it as a
settled number, and never sum it into anything that looks like a bill.

---

## 7. Design

The client has seen a hundred agent dashboards. This one must not look like one.

### 7.1 Reference and intent

A working study at night: lamplight, instruments, sealed letters, a ledger. The interface is
the room. Familiars are objects in it, not cards in a grid — you look down on the tower
floor and see where each one is standing and what it is doing. The single loudest thing on
screen is the sigil — a small drawn mark per familiar that changes state as it works.
Everything else is quiet.

Explicitly avoid: the SaaS card kit (identical rounded cards, one radius, grey shadows),
gradient washes, the cream-and-terracotta palette, tracked-out caps eyebrows, `→` glued to
button text, and the "big number with small label" hero.

### 7.2 Tokens — `src/theme/tokens.css`

```css
--ink-void:      #14131A;  /* base */
--ink-panel:     #1E1C27;  /* raised surfaces */
--ink-rule:      #332F40;  /* hairlines, dividers */
--bone:          #C9BFA4;  /* primary text */
--bone-dim:      #8C8474;  /* secondary text */
--brass:         #B08D3F;  /* accent, seals, 80% warnings */
--verdigris:     #4E7A6B;  /* running, healthy */
--oxblood:       #7A1F2B;  /* banished, misfired, destructive */
--slate:         #5A6B8C;  /* compass order, info */
```

Contrast is non-negotiable: `--bone` on `--ink-void` must measure ≥ 7:1, `--bone-dim` ≥ 4.5:1.
Measure it with a real contrast calculation in a test, don't eyeball it. Any state colour
used as text gets a lightened variant that passes 4.5:1; the saturated version is for rules,
fills and sigils only.

### 7.3 Type

- **Junicode** — display: familiar names, panel headings. A genuine manuscript-lineage face.
- **EB Garamond** — body, writs, commission text. Body 16px/1.6, measure ≤ 72ch.
- **Iosevka** — terminals, paths, commands, numbers in the ledger. Nowhere else.

Self-host all three as woff2 in `src/theme/fonts/`. No Google Fonts CDN. Scale is a classic
fourth: 12 / 16 / 21 / 28 / 37 / 50.

### 7.4 Sigils

Each familiar gets a generated mark: a deterministic SVG drawn from a hash of its name —
a ring, 3–7 radial strokes, one interior glyph, in the order's colour. Written in code in
`ui/Sigil.tsx`. No asset files, no licensing question, and every familiar looks distinct on
first sight.

Sigil states, and this is the app's one piece of non-user-triggered motion:

| State | Treatment |
|---|---|
| dormant | 40% opacity, static |
| summoned, idle | full opacity, static |
| working | the ring rotates, one revolution per 8s |
| awaiting seal | ring static, brass dot pulsing at 1s |
| bound | ring static, a brass chord drawn across it |
| banished / misfired | oxblood, ring broken at one point |

Everything else in the UI moves only in response to a click. `prefers-reduced-motion` replaces
rotation with a static brass tick.

### 7.5 Layout

```
┌──────────────┬────────────────────────────────────────────────┐
│  roster      │  the scriptorium                               │
│              │                                                │
│  ◉ Vellum    │   Vellum · quill · ~/work/essays                │
│  ◎ Sconce    │   ─────────────────────────────────────────    │
│  ○ Astrolabe │   commission  ·  terminal  ·  outputs  ·  codex │
│  ○ Anvil     │                                                │
│  ◉ Tally     │   [ the selected tab fills this area ]         │
│              │                                                │
│  ── seals ── │                                                │
│  3 waiting   │   ── aether ──────────────────────────────     │
│              │   tokens ▓▓▓▓▓▓░░░░  turns ▓▓░░░  28 min       │
└──────────────┴────────────────────────────────────────────────┘
```

Left rail is fixed 240px, sigil + name + one-line status. Seals live at the bottom of the rail
with a count. The right pane is one familiar at a time, four tabs. Aether meters pinned to the
bottom of the right pane, always visible while a commission runs.

Panels are separated by 1px `--ink-rule` hairlines and space, not by borders-plus-radius-
plus-shadow. Radius is 2px on interactive controls and 0 everywhere else.

The right pane has a second mode: **the floor**, a top-down plan of the tower with every
familiar visible at once. It is the centrepiece of the app and it has its own section — §8.

---

## 8. The floor

The thing you open the app to look at. A top-down plan of the tower room, with every
familiar drawn on it at once, standing wherever its current state puts it. You see the whole
roster working without clicking anything.

This is not a decorative extra and it is not the last thing built. It is how the app is used.
The roster rail is the fallback for when you want a list; the floor is the default.

### 8.1 The idea, and why it isn't an isometric pixel office

The obvious version of this is an isometric office with little sprite people at desks. Don't
build that. It needs an art pipeline, it needs licensed tilesets, it reads as someone else's
app, and sprite characters fight the manuscript theme.

Build instead what this world would actually produce: **an architect's plan of the tower,
inked on vellum**. Straight orthographic top-down, no perspective. Walls are double hairlines
with hatching between them. Furniture is drawn in plan symbols the way a floor plan draws a
desk or a door swing. Familiars are their sigils (§7.4), moving between stations.

Every mark is a `Graphics` call. No sprite sheets, no tilesets, no image files, no licensing
question. It is also, as a side effect, resolution-independent and about 40 KB of code.

### 8.2 The plan

One circular room, 1000 × 1000 world units, drawn in a viewport that letterboxes to fit.

```
                       the door
                          ╭┈╮
        ┌─────────────────┤ ├─────────────────┐
      ╱   ▭ Quill                    Lantern ▭  ╲
    ╱      desk                          desk     ╲
   │                                               │
   │   ▤                   ╭───╮                ▥  │
   │ ledger               │ ward │           reliquary
   │ lectern               │circle│             cabinet
   │   (W)                  ╰───╯                (E) │
   │                                               │
    ╲     ▭ Crucible                 Compass ▭   ╱
      ╲    desk            ▭           desk    ╱
        └──────────────  Ledger  ─────────────┘
                          desk
                       the hearth
```

**Stations** — every position a familiar can occupy. Each is a node in a waypoint graph
(`paths.ts`) so movement is deterministic and never crosses a wall.

| Station | Where | Meaning |
|---|---|---|
| the hearth | south arc | Dormant familiars rest here, dimmed |
| order desks ×5 | perimeter, 72° apart | Working familiars sit at their own order's desk |
| the ward circle | centre | A familiar waiting on your seal stands in it |
| the reliquary cabinet | east | A familiar writing to shared memory walks here first |
| the ledger lectern | west | Click it to open the ledger view |
| the door | north | Entry on summon, exit on banish |

Two familiars of the same order share a desk by standing on either side of it; three or more
queue behind it in a short line. Never overlap two sigils.

### 8.3 What a familiar looks like on the floor

The sigil from §7.4, at 44 world units, plus:

- A **name plate** below it in Junicode 12, `--bone-dim`, drawn only at zoom ≥ 0.9×.
- A **thread of ink** — a 1px `--brass` line from the sigil to its desk lamp while it works.
  The thread's opacity breathes between 0.3 and 0.7 over 4s. This is the one ambient animation
  on the floor.
- An **aether arc** — a thin arc around the sigil, filling clockwise as the commission's token
  budget is spent. Verdigris to 80%, brass past it, oxblood at 100%.

State, and where the familiar is:

| State | Position | Sigil | Extra |
|---|---|---|---|
| dormant | hearth | 40% opacity, static | — |
| summoning | walking door → desk | fading in | — |
| idle, summoned | its desk | full opacity, static | — |
| working | its desk | ring rotating, 8s/rev | ink thread to lamp, aether arc |
| awaiting seal | walks to the ward circle | brass dot pulsing, 1s | ward circle's ring lights brass |
| bound | its desk | brass chord across the ring | aether arc oxblood |
| stalled | its desk | ring rotation slows to 30s/rev | — |
| banished | walking desk → door, then gone | ring broken, oxblood | — |
| misfired | its desk | ring broken, oxblood | desk lamp goes dark |

The walk is a 1.1s ease-in-out tween along the waypoint path. Sigils don't rotate to face
travel — they're marks on a plan, not characters.

### 8.4 Reading the floor at a glance

The whole point is answering four questions without a click:

1. **Is anything waiting on me?** → anyone standing in the ward circle.
2. **Is anything running away with my money?** → any aether arc past brass.
3. **Is anything stuck?** → a slow ring, or a familiar at a desk with no ink thread.
4. **What's idle?** → everyone at the hearth.

If a design change makes any of those four harder to see, it's the wrong change.

### 8.5 Interaction

- Hover a sigil → a **marginalia card** (DOM, not Pixi) pinned beside it: name, order, current
  commission title, the three aether meters, elapsed time. 120ms delay in, instant out.
- Click a sigil → right pane switches to that familiar's workspace, floor stays visible in
  a 40% height strip above it.
- Click the ward circle → opens the seal queue.
- Click the ledger lectern → opens the ledger view.
- Click the door → the "summon a familiar" picker.
- Scroll → zoom 0.6×–2.0× toward the cursor. Drag → pan. Double-click empty floor
  → reset to fit.
- Keyboard: `Tab` cycles sigils in clockwise order with a visible brass focus ring, `Enter`
  selects, `Esc` returns focus to the roster rail.

### 8.6 Performance

One `Pixi.Application`, WebGL, `antialias: true`, `resolution: devicePixelRatio` capped at 2.

Three layers. `static` (walls, hatching, furniture, labels) is drawn once into a
`RenderTexture` and blitted every frame — it re-bakes only on resize or zoom crossing 0.9×.
`threads` redraws per frame. `actors` holds one container per familiar.

The ticker runs at 60fps focused, throttles to 20fps when the window is unfocused, and
stops entirely when the floor isn't the visible tab. A background floor must cost 0% CPU.

Tweens are plain `requestAnimationFrame` interpolation on the actor containers. No physics,
no pathfinding at runtime — routes between stations are precomputed on load.

Budget: 60fps with 12 familiars, 5 of them working, on integrated graphics. If it misses,
the first thing to cut is the ink threads, then the aether arcs. Never the state colours.

### 8.7 Accessibility

The floor is never the only route to anything. Every click target above has a twin in the
roster rail or a menu item.

- A `Floor` / `Roster` toggle in the pane header, remembered across restarts.
- An offscreen `aria-live="polite"` list mirrors the floor in text: "Vellum, working at the
  quill desk, 62% of budget. Sconce, waiting for your seal." Updates on state change only,
  never on position.
- `prefers-reduced-motion`: no walking (familiars cut to their new station), no ring rotation
  (a static brass tick at the top of the ring instead), no thread breathing (fixed 0.5 opacity).
- Zoom and pan work from the keyboard: `+` `-` `0`, arrow keys.

### 8.8 Files

```
src/scriptorium/floor/
  Floor.tsx          # React wrapper: mounts Pixi, owns resize, tab visibility
  stage.ts           # Application, layers, ticker policy
  plan.ts            # tower geometry — walls, desks, ward circle, door, in world units
  bake.ts            # static layer → RenderTexture
  hatching.ts        # procedural hatch texture, generated once
  paths.ts           # waypoint graph + precomputed station-to-station routes
  actors.ts          # per-familiar container, state machine, tweens
  interaction.ts     # hover, click, zoom, pan, keyboard focus ring
  marginalia.tsx     # hover card, DOM
  a11y.tsx           # the live-region mirror
```

`plan.ts` exports the station table as data. Adding a sixth order later should mean editing one
array, not redrawing the room.

---

## 9. Data model

```sql
CREATE TABLE familiars (
  id TEXT PRIMARY KEY,            -- slug of name
  name TEXT NOT NULL,
  order_name TEXT NOT NULL,
  binding_path TEXT NOT NULL,
  binding_hash TEXT NOT NULL,     -- detect edits
  first_seen INTEGER NOT NULL,
  last_summoned INTEGER
);

CREATE TABLE summonings (
  id TEXT PRIMARY KEY,
  familiar_id TEXT NOT NULL REFERENCES familiars(id),
  engine TEXT NOT NULL,
  model TEXT NOT NULL,
  cwd TEXT NOT NULL,
  isolation TEXT NOT NULL,
  worktree_path TEXT,
  pid INTEGER,
  started INTEGER NOT NULL,
  ended INTEGER,
  exit_reason TEXT               -- quit | banished | crashed | restored
);

CREATE TABLE commissions (
  id TEXT PRIMARY KEY,
  familiar_id TEXT NOT NULL REFERENCES familiars(id),
  summoning_id TEXT REFERENCES summonings(id),
  prompt TEXT NOT NULL,
  intake_json TEXT NOT NULL,
  status TEXT NOT NULL,
  ward_id TEXT REFERENCES wards(id),
  created INTEGER NOT NULL,
  ended INTEGER,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  turns INTEGER DEFAULT 0,
  est_cost_usd REAL DEFAULT 0
);

CREATE TABLE seals (
  id TEXT PRIMARY KEY,
  commission_id TEXT NOT NULL REFERENCES commissions(id),
  kind TEXT NOT NULL,            -- write | shell | network | destructive | send | reliquary
  detail_json TEXT NOT NULL,     -- path, command, diff, proposal
  raised INTEGER NOT NULL,
  resolved INTEGER,
  resolution TEXT                -- sealed | sealed_always | refused | timed_out
);

CREATE TABLE wards (
  id TEXT PRIMARY KEY,
  familiar_id TEXT NOT NULL REFERENCES familiars(id),
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  intake_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run INTEGER,
  last_result TEXT
);

CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  commission_id TEXT,
  familiar_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
```

Migrations are numbered and forward-only. Every migration has a matching test that runs it
against a seeded db.

---

## 10. Phases

Each phase: build, run, verify by hand, report. Do not proceed on a failing criterion.

### Phase 0 — Scaffold

Tauri v2 + React + TS + Tailwind v4. Token file, three self-hosted fonts, `ui/` primitives
(`Sigil`, `Panel`, `Rule`, `Meter`, `Pill`). SQLite plugin wired with migration 001. Empty
scriptorium shell with the §7.5 layout and hardcoded roster data.

**Passes when:** app launches; layout matches the wireframe at 1280×800 and at 1024×640; a
contrast test asserts `--bone` on `--ink-void` ≥ 7:1 and `--bone-dim` ≥ 4.5:1 and passes; four
distinct sigils render from four different names; `DECISIONS.md` and `TASKS.md` exist.

### Phase 1 — One real familiar

Parse one hardcoded binding. Spawn `claude` in a PTY in its workspace. Stream to xterm.js.
Accept typed input. Resize correctly. Stop gracefully on quit.

**Passes when:** you can summon, hold a real conversation in the terminal, resize the window
mid-run without corrupting the buffer, `cat` a 50k-line file without the UI freezing, and quit
the app leaving no orphaned `claude` process (verify with `ps`). Report honestly how much
friction `portable-pty` caused — this is the Electron decision point (§5).

### Phase 2 — Bindings as files

Bindings folder, file watcher, YAML + Zod validation, roster from disk, invalid bindings shown
with their errors. Five seed bindings. Per-familiar workspace with the four tabs. Intake form
generated from the binding.

**Passes when:** adding a `.binding.md` makes a familiar appear within 2s with no restart;
deleting one removes it; a binding with a bad `order` shows the Zod error in the rail in
oxblood and does not crash; all five seeds load; the intake form blocks submit on a missing
required field.

### Phase 3 — Commissions, persistence, ledger

Commission lifecycle and queue. All tables from §9. Codex file read/append. Ledger events.
Ledger view with spend by familiar and by day.

**Passes when:** a commission survives an app restart with correct status; a familiar with a
running commission queues the next one visibly rather than running both; the codex file
contains what the familiar wrote; the ledger shows a non-zero token count for a real run and
labels cost as estimated in every place it appears.

### Phase 4 — The seal

Autonomy levels. Bounds enforcement in Rust, not in the prompt. Seal queue UI and macOS
notifications. Refusals fed back into the PTY. The never-exempt list from §6.4.

**Passes when:** a `propose` familiar asked to write a file raises a seal instead of writing;
a `bounded` familiar writes inside its bounds without asking and raises a seal for a path
outside them; a `free` familiar still raises a seal for `rm` outside its workspace and for any
path matching `.env`; refusing sends a message the familiar visibly reacts to; a seal left
30 minutes transitions to `bind`. Write an adversarial test: a writ that instructs the
familiar to ignore the seal system must not be able to bypass it, because enforcement is in
the Rust layer and the prompt has no say.

### Phase 5 — The floor

All of §8. Tower plan baked to a RenderTexture, waypoint graph, sigil actors wired to real
familiar state, walking, hover marginalia, click-through, zoom and pan, the live-region mirror,
the `Floor` / `Roster` toggle.

The aether arc goes in here as a shape driven by whatever budget data exists; it becomes
meaningful in Phase 6. The stalled and bound states render as specified even though nothing
produces them yet — drive them from a dev-only state override panel.

**Passes when:** five real familiars appear at the correct stations for their real states;
summoning one walks it from the door to its desk; a familiar raising a seal walks to the ward
circle and the circle lights; banishing walks it out the door; the floor holds 60fps with 12
familiars, 5 working, measured with the Pixi ticker's own FPS readout, not by feel; the ticker
reports 0 draw calls when the floor tab is hidden; `prefers-reduced-motion` removes all walking
and rotation; `Tab` reaches every sigil with a visible focus ring; the live region reads the
floor correctly with VoiceOver on.

No image files were added to the repo in this phase. Verify with `git status`.

### Phase 6 — Aether and the breaker

Three meters. 80% steer. `on_exceed` behaviours. Heartbeat and stall detection. Runaway guard.
The floor's aether arcs and stalled state now run on real data.

**Passes when:** a commission with `tokens: 2000` trips at 100% and does what `on_exceed` says;
`banish` leaves no orphaned process; a deliberately stalled agent is surfaced within 10 minutes
and is not killed silently; the runaway guard fires at 200 tool calls even with `on_exceed: steer`;
the aether arc on the floor matches the meters in the right pane to within one frame.

### Phase 7 — Standing wards and the menu bar

Scheduler in Rust. Menu-bar residency, window close ≠ quit. Notifications. Skip-if-busy.

**Passes when:** a ward set for two minutes out fires with the window closed; the prompt sent
is byte-identical to the stored prompt; a ward whose familiar is busy records `skipped: busy`
and does not queue; quitting with live summonings warns first; reopening the window shows the
floor already in the right state, with no summon animation replayed for work that started while
it was closed.

### Phase 8 — The archivist

Roster/queue/ledger read access. Proposals into the seal queue. Hard-coded inability to dispatch.

**Passes when:** the archivist can describe the state of the floor accurately; its proposal
appears as a seal; sealing it dispatches the commission and refusing it does not; no code path
exists by which the archivist dispatches directly — prove it with a test that tries.

### Phase 9 — Ship

App icon, drawn in code from the same sigil system, original. `npm run dist`. Install the `.dmg`
on the real machine and use it for a week without the dev server.

**Passes when:** the packaged app runs from `/Applications` with no dev dependencies;
`THIRD-PARTY.md` is complete; the floor performs the same in the packaged build as in dev; a
week of real use is logged in `TASKS.md`, including which parts of the floor you actually looked
at and which you never once used.

---

## 11. Security

- Bounds and the never-exempt list are enforced in Rust, before the action happens. The
  prompt is advisory; the Rust layer is the law. Any design where a familiar can talk its way
  past a bound is a bug, not a config choice.
- Path checks canonicalise first (resolve `..`, symlinks, `~`) and compare against the allow-list
  after. Test the symlink escape case explicitly.
- API keys live in the macOS keychain via `tauri-plugin-stronghold` or the keychain API — never
  in SQLite, never in a dotfile the app writes, never in a log line, never in an error message.
  Redact anything matching a key pattern from PTY output before it reaches the transcript.
- No network calls from the app itself except what the spawned CLIs make. No telemetry, no
  update check, no crash reporting.
- Transcripts are local, listed in the workbench, and deletable in one click.

---

## 12. Definition of done, for any feature

- It works when you run it by hand, not just when it compiles.
- It has a test for the behaviour that would be embarrassing to get wrong.
- Its failure state says what happened and what to do about it.
- Its copy follows §3's voice rules and uses the canonical nouns.
- Its colours pass contrast and its motion respects `prefers-reduced-motion`.
- It leaves no orphaned process, no unclosed file handle, no unmigrated table.
- `DECISIONS.md` records anything that diverged from this file, and why.
