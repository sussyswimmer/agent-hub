# Decisions

One entry per non-obvious choice, newest last. CLAUDE.md §0: *"If a spec decision turns out
wrong, stop and say so rather than silently substituting."* Every entry below is either a
divergence the owner approved, or a finding that constrains a later phase.

Format: **context** (what forced the choice), **decision**, **consequence** (what it costs and
what it buys), and, where the decision rests on how a tool behaves, **evidence** — the command
that was run and what it printed. A claim with no evidence line is research, not verification,
and says so.

---

## 0001 — The core lives in its own crate, not under `src-tauri/src/`

**Status:** accepted · **Diverges from:** §5

**Context.** §5 lays out `summon/ breaker/ ward/ ledger/ codex/ db/ security/` under
`src-tauri/src/`. Those seven modules are the code most worth testing: the PTY lifecycle, the
breaker's arithmetic, the path canonicalisation that stands between a familiar and
`~/.ssh`. Under `src-tauri` every `cargo test` links a webview, which is slow and drags in a
system GTK/WebKit toolchain that has nothing to do with any of them.

**Decision.** Keep the seven module names exactly as §5 writes them, but put them in
`crates/grimoire-core/`. `src-tauri/` becomes thin glue: commands, events, window setup.

**Consequence.** `cargo test -p grimoire-core` runs in seconds and needs no display. The cost is
one extra crate boundary: anything the UI calls has to be re-exported through `src-tauri`, and
types shared with TypeScript are declared once in `grimoire-core/src/types.rs` and generated out
with `ts-rs`. Worth it. The same split carried 78 passing tests through the previous build.

---

## 0002 — `rusqlite`, not `tauri-plugin-sql`

**Status:** accepted · **Diverges from:** §5

**Context.** §5 names `tauri-plugin-sql` (sqlx). Grimoire's database work is almost entirely
synchronous and single-writer: migrations at startup, a ledger append per event, a handful of
reads to paint the roster. sqlx buys an async driver and compile-time query checking against a
live database; neither pays for itself here, and `tauri-plugin-sql` additionally exposes SQL
execution to the front-end, which is the wrong shape when the whole point of §6.4 is that the
Rust layer is the only thing allowed to decide what happens.

**Decision.** `rusqlite` 0.40 with the bundled SQLite, WAL, `busy_timeout`, and embedded
numbered forward-only migrations run from Rust at startup. The front-end gets typed commands,
never SQL.

**Consequence.** Blocking calls have to be moved off the async runtime with
`spawn_blocking` where they are on a hot path. In exchange the database has exactly one entry
point and the migration set is a directory of numbered `.sql` files that a test can run against
a fresh file. Approved by the owner before Phase 0 began.

---

## 0003 — Junicode could not be vendored; EB Garamond carries the display sizes

**Status:** accepted, revisit off this machine · **Concerns:** §7.3

**Context.** §7.3 asks for Junicode at display sizes. Junicode is OFL-1.1 and would be a
legitimate vendor, but it is not published on npm, and it ships webfonts only inside GitHub
release archives. From this sandbox `github.com/…/releases`, `api.github.com` and `jsdelivr` all
return 403; only `raw.githubusercontent.com` answers, and the repository does not carry built
woff2 in its tree. Converting the TTF locally is also out: `fonttools` and `brotli` are absent.

**Decision.** `scripts/fonts.ts` tries three candidate URLs for Junicode and, when all three
fail, carries on and prints why. `--font-display` lists `"Junicode"` first with
`"EB Garamond"` immediately behind it. **No unrelated face is substituted** — §1 forbids it and
a near-miss serif would be worse than the honest fallback.

**Consequence.** Display type is currently EB Garamond, one face rather than two. On a machine
that can reach GitHub, run `bun run fonts` and the difference appears by itself.

**Amended, and the original was wrong.** This entry said the file appearing in
`src/theme/fonts/` would be enough and the display sizes would "pick it up with no code change."
They would not have. `fonts.css` deliberately declared no `@font-face` for Junicode — a `url()`
to a file that is not there is a Vite build error — so the fetch and the rule were two separate
things and only one of them was automated. The owner would have run `bun run fonts` on their own
machine, read `junicode  1 files`, and gone on reading EB Garamond with nothing to tell them why.

The fix is to make the file and the rule one event. `src/theme/fonts/vendored.css` is generated
and committed; `bun run fonts` rewrites it on every run, carrying the Junicode `@font-face` when
the woff2 was placed and only a comment when it was not, and `fonts.css` `@import`s it
unconditionally. `src/lib/__tests__/fonts.test.ts` asserts both halves: that every `url()` in
the theme resolves to a file that exists, and that a Junicode woff2 on disk implies a rule
declaring it. The second one fails if you drop the file in by hand and skip the script.

---

## 0004 — The seal is enforced by a Claude Code `PreToolUse` hook, and only `claude` has one

**Status:** accepted · **Concerns:** §6.4, §11, §4 (`engine`) · **Implemented in:** Phase 4

**Context.** §6.4 and §11 say bounds are enforced "in Rust, before the action happens", and that
"the prompt is advisory; the Rust layer is the law". Taken literally that is not achievable for
an *interactive* CLI in a PTY. The familiar is a separate process that opens its own file
descriptors and runs its own subprocesses; Rust on the other side of the pseudo-terminal sees
terminal bytes and nothing else. There is no point at which it can interpose. Scraping the
transcript for "about to write X" would be a guess, and a guess is not a seal.

**Decision.** Enforce the seal at the only place that actually sits between the model and the
action: Claude Code's `PreToolUse` hook. Grimoire writes a settings file per summoning and
passes `--settings <file>`. The hook is a small Grimoire binary; it receives the pending call on
stdin, hands it to the app over a local socket, blocks until the owner clicks Seal or Refuse,
and answers `allow` or `deny`. Because the hook is configuration outside the conversation, a
writ that tells a familiar to ignore the seal cannot reach it.

**Evidence.** Run against `claude` 2.1.270 on 2026-09-13, in a scratch directory:

```
claude -p "Create a file called proof.txt containing the word hello. Use the Write tool."   --restricted --tools Write Read --settings ../settings.json --setting-sources ''   --permission-mode acceptEdits --output-format json
```

with a hook returning
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny", …}}`.

- The hook fired. Its stdin payload carried `session_id`, `cwd`, `permission_mode`,
  `hook_event_name`, `tool_name`, `tool_input` and `tool_use_id` — for `Write`, `tool_input`
  held the absolute `file_path` and the full `content`, which is everything the seal needs to
  render a preview and to run the §6.4 path checks.
- The tool was blocked. `proof.txt` was **not** created, and the result JSON listed the call
  under `permission_denials`.
- It blocked **despite `--permission-mode acceptEdits`**, which by itself auto-approves writes.
  The hook outranks the permission mode. That is the property the seal depends on.

**Evidence — the timeout fails open.** The same probe with a hook that sleeps 25 s against a
configured `timeout: 5`:

- `proof.txt` **was** created. `permission_denials` was empty. The result read
  "Created proof.txt containing hello."

So a hook that misses its deadline is treated as consent. The seal must therefore never rely on
Claude Code's timeout to stop anything:

1. Configure a generous timeout on the Claude side (an hour), so the owner is never rushed by
   a clock they cannot see.
2. The hook binary enforces Grimoire's own deadline, well inside that, and prints `deny` when it
   expires.
3. The hook prints `deny` if it cannot reach the app at all — no socket, refused connection,
   malformed reply. Unreachable is a refusal, not an allowance.

Fail-closed has to be a property of the hook's own code. It is not a property of the platform.

**Evidence — isolation.** `--restricted` with `--setting-sources ''` ignores user, project and
local settings while still honouring `--settings`, and confines the file tools to the working
directories. That is the isolation §11 asks for, and unlike `--bare` it keeps hooks and
subscription auth. `--bare` is unusable twice over: its own help text says it skips hooks, and
it forces `ANTHROPIC_API_KEY` because "OAuth and keychain are never read".

**Not yet verified: interactive mode.** Everything above was measured in print mode (`-p`).
Grimoire runs `claude` *interactively* in a PTY, and the probe could not be repeated there from
this container: piping into `script -qec` does not reach an interactive reader, because the
process reads the terminal directly rather than its stdin. Two things follow, and both are
Phase 1 work rather than assumptions to carry:

- The hook firing in interactive mode is **assumed, not measured**. It is the first thing to
  check once `summon/pty.rs` can write to a real PTY master, and the seal's design rests on it.
- An interactive `claude` in a fresh environment opens a theme picker and further first-run
  screens before it will take a turn. A summoning that does not get past those looks hung on
  first use. Logged in TASKS.md against Phase 1.

**Consequence.** No comparable pre-execution hook was found for `codex`, `gemini` or `qwen`. A
familiar on one of those engines cannot be sealed, and an unsealed familiar is exactly what §11
exists to prevent. So `engine` parses to all four values and all four appear in the roster, but
**Summon is disabled for anything but `claude` in v1**, with the reason on hover rather than a
gate that pretends to be something else. Approved by the owner. Revisit per engine when one of
them grows a pre-execution hook.

---

## 0005 — Application icons are drawn in code and never committed

**Status:** superseded by 0020 · **Concerns:** §1

**Context.** §1: *"Do not vendor art assets from anywhere."* A Tauri bundle nonetheless needs
`.png`, `.ico` and `.icns` files on disk before it can build.

**Decision.** `scripts/icons.ts` draws the mark — the same ring, radial strokes and interior
figure the roster renders, seeded from `sigilGeometry("Grimoire")` — with a few signed-distance
functions and 3×3 supersampling, then writes PNG, ICO and ICNS with a small encoder in the same
file. Output goes to `src-tauri/icons/`, which is **gitignored**. `bun run icons` before
`bun run dist`.

**Consequence.** `git status` never shows an image file, which is the check §1 deserves, and the
icon cannot drift from the sigil system because it is generated from it. The cost is ~200 lines
of encoder and one more step before a release build.

---

## 0006 — Rotating SVG groups use `transform-box: fill-box`, pinned by an invisible rect

**Status:** accepted · **Concerns:** §7.4, §10

**Context.** The turning ring in §7.4 is a CSS rotation on an SVG `<g>`. It was written with
`transform-box: view-box`, which is the correct modern value: the viewBox is `-50 -50 100 100`,
so `transform-origin: center` is exactly the user-space origin the mark is drawn around.

Chromium honours that. **WebKitGTK does not**, and there is no error — it falls back to
resolving `center` against the border box in CSS pixels. At an 18px sigil that puts the origin
about nine pixels down and right of where the geometry expects it, and the ring swings out of
its row and lands on the status line below it. The Playwright suite, which runs Chromium, was
sixteen tests green while this was happening. It was found by building the binary, running it
under `Xvfb`, and looking at the window.

**Decision.** Use `transform-box: fill-box`, which WebKit has supported for far longer, and pin
the group's bounding box to the viewBox with an invisible `<rect x="-50" y="-50" width="100"
height="100" fill="none" stroke="none">`. A rect counts towards `getBBox()` whether or not it is
painted, so the fill-box is exactly the viewBox and its centre is exactly the origin — in both
engines, by construction rather than by luck.

**Consequence.** One invisible element per sigil. In exchange the rotation is engine-independent
and no longer depends on a CSS value one of the two target engines quietly ignores.

The guard is `tests/e2e/shell.spec.ts`, "a turning ring rotates about its own centre and stays
inside its row". It asserts the computed `transform-box` *and* that the group stays concentric
with its `<svg>` and inside its row, so the fix is held in place from both directions.

**The general lesson, which matters more than the bug.** Tauri ships WebKit, the test runner
drives Chromium, and they disagree. A green Playwright run says the markup and the logic are
right; it says nothing about how WebKit will paint it. Run the real binary and look at it before
calling any phase done — §0 already asks for exactly this, and this is what it is for.

---

## 0007 — Stay on Tauri. `portable-pty` was not the problem

**Status:** accepted · **Concerns:** §5's Electron decision point · **Settles:** Phase 1

**Context.** §5 says: *"If PTY handling in Rust costs more than one full working session of
thrash in Phase 1, stop and say so — switching to Electron at the end of Phase 1 is cheap, and
at the end of Phase 4 it is not."* This is that report.

**Decision.** Stay on Tauri with `portable-pty`. Switching would buy nothing.

**What `portable-pty` actually cost.** Close to nothing. `openpty`, `spawn_command`,
`try_clone_reader`, `take_writer`, `resize` behaved exactly as documented, on the first try,
against both `bash` and a real `claude`. Two things had to be learned rather than read:

- The parent must drop its copy of the slave, or the master never reports end-of-file and the
  reader thread lives for the life of the application. One line, and a test now covers it.
- `MasterPty` is `Send` but not `Sync`, so the session cannot go into shared application state
  until the master sits behind a mutex. One line.

**What did cost time, and none of it was the crate.** Every real problem in Phase 1 was mine:

| What broke | Where it actually was |
| --- | --- |
| A waiting engine displayed nothing | My reader held bytes while blocked on the next read |
| A trailing word never appeared | My redaction carry had no expiry |
| Banish did nothing, silently | My watcher thread held the child lock the stop ladder needed |
| Quit ran no stop ladder | I hung it off a window event that does not fire on `SIGTERM` |
| A real engine sat on its login screen | My environment allow-list was too narrow to let it reach the network |

Every one of those would have arrived unchanged with `node-pty` under Electron, because none of
them is about how a pty is opened. They are about what you do with the bytes afterwards, whose
thread holds which lock, and which of the process's several possible deaths you listened for.

**What Electron would have cost.** A second runtime in the bundle, tens of megabytes against
§5's ~15 MB target, a rewrite of the core crate's thirty-seven tests into a stack with no
`cargo test`, and the loss of the split in DECISIONS.md 0001 that lets the interesting code be
tested in two seconds without linking a webview.

**One genuine friction worth naming.** Tauri ships WebKit, the Playwright suite drives Chromium,
and they disagree — see DECISIONS.md 0006, where sixteen green tests coexisted with a sigil
drawn on top of its own status line. That is a real tax, and Electron would not charge it, since
it is Chromium everywhere. It is still much smaller than the cost of the switch, and the answer
is cheap: build the binary and look at it at the end of every phase. Doing that is what found
four of the five bugs in the table above.

---

## 0008 — Token counts come from the engine's transcript, not from the terminal

**Status:** accepted · **Concerns:** §6.5, §6.9 · **Settles:** Phase 3's metering

**Context.** §6.5 asks for tokens "parsed from the CLI's own reporting where it emits it,
wall-clock otherwise". For an interactive engine the obvious reading is the terminal, since that
is where the engine prints its own counts. It is the wrong place. Those numbers are drawn with
cursor-positioning escapes rather than written as text, reflowed on every resize, and rewritten
in place as a turn progresses. Anything recovered from them would be a guess dressed up as a
measurement, and §6.9 puts those numbers in a ledger.

**Decision.** Read the transcript the engine writes for itself. `claude` keeps one JSONL file per
session with a `usage` object on every assistant message — `input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens` — and the model that produced it.
Grimoire names the session with `--session-id` when it spawns, so it knows exactly which file is
its own instead of guessing from timestamps among all the sessions on the machine. The file is
located by that name across the project directories rather than by deriving the directory from
the working directory: the slug rule is the engine's business and may change, while the file is
always `<session-id>.jsonl`.

**Evidence.** Run against `claude` 2.1.270, with a session id chosen by the test:

```
turns: 1, tokens: Tokens { input: 2, output: 5, cache_read: 4479, cache_write: 1657 }
estimated cost: $0.007638
```

`crates/grimoire-core/tests/engine.rs` does this end to end — spawn, find, total, price — with
nothing stubbed. It is `#[ignore]`d, because it needs an engine and spends a little.

**Consequence.** Cache reads are counted separately, which matters: a long session is mostly
cache, and pricing those at the input rate would overstate a run several times over and make the
meter useless for the one thing it is for. When the transcript is not there — a different engine,
an older CLI, a session that produced no turn — nothing is reported. An absent figure is honest;
a zero that looks like a measurement is not.

The cost built from those tokens is an estimate at list prices and never becomes anything else.
It exists to answer "was that run expensive?", not "what do I owe?" — the owner is on a
subscription, where no money changes hands per token at all.

---

## 0009 — A summoning's rules are fixed when it starts, not read per tool call

**Date.** 2026-09-13. **Replaces.** Nothing; this is the first statement of it.

A familiar's autonomy and bounds are copied into the seal's session table at summon time and
read from there for every tool call, rather than re-read from the binding each time.

Found by trying to test it the other way round: Tally's binding was edited from `propose` to
`free` while it was running, the watcher hot-reloaded the file, and the running summoning went
on asking for a seal on everything. That is the right answer, and it is worth saying why rather
than treating it as a rough edge.

A binding is a file. Files are edited by whatever can write to them — the owner, an editor, a
script, and in a harness like this one, conceivably a familiar with write access to the bindings
folder. If the leash were re-read per call, widening it would be a matter of writing one line to
one file mid-run. Fixing it at summon time means a change of rules takes a banish and a fresh
summon: a deliberate act, with the old process gone.

**Consequence.** Editing a binding does not affect a familiar already summoned. The roster picks
the change up immediately, as §4 requires, and the next summoning uses it.

---

## 0010 — Output goes to a slot the backend can swap, not to the channel that asked

**Date.** 2026-09-13. **Replaces.** The channel captured at spawn in `summonings.rs`.

A summoning's output is written to `Arc<Mutex<Option<Channel>>>` and a terminal attaches to that
slot, rather than the spawn closure owning the one channel it was handed.

**Why.** A summoning outlives the pane showing it. React unmounts the terminal whenever another
familiar is selected, so the channel captured at spawn belongs to something that no longer
exists, and the pane that comes back starts from nothing and assumes dormant. The result was a
familiar that could be neither banished nor re-summoned: the button offered to summon it, the
backend refused because it was already summoned, and the engine ran on with no way to reach it.
Found by clicking away from a live Tally and back, with the real `claude` still on the process
table — no test had a reason to leave and return.

**Nothing is buffered while nobody is attached.** A pty is a stream, not a log. Holding every
byte for a pane that may never be reopened would mean an unbounded buffer per familiar, for
output nobody asked to keep. So a re-attached terminal starts empty and says so, in one dim
line, rather than presenting a near-empty buffer as though it were the whole story.

The real record of a run is the transcript and the ledger, which is where it belongs. The
terminal is a window onto a live process, not its history.

---

## 0011 — The floor is baked in world space, not screen space

**Date.** 2026-09-13. **Replaces.** Nothing; this is the first statement of it.

§8.6 asks for the static layer — walls, hatching, furniture, labels — to be drawn once into a
`RenderTexture` and blitted. The texture covers the room's own 1000 × 1000 world, and the sprite
holding it lives inside the container that pans and zooms, rather than covering the viewport.

**Why.** A texture the size of the viewport has to be redrawn every time the view moves, which
is every frame of a pan and every notch of a wheel — precisely the moments the frame budget is
tightest. Baking in world space means panning and zooming are a transform on one sprite and cost
nothing at all. The texture is re-made only when the window resizes, where a larger viewport
wants more texels, and when the zoom crosses 0.9×, where the station labels come and go.

**Consequence.** The texture is `1000 × 1000 × resolution`, where resolution is how many device
pixels a world unit is about to occupy, capped at 3. At a 1600-pixel-tall window that is a
4.8k-square texture — about 90 MB — which is the cost of the decision and is paid once.

**Amended 2026-09-30 (0022).** The resolution is now what the *largest* zoom needs, not the
current one, and the stage — not the bake — decides which side of 0.9× the floor is on.

---

## 0012 — Pixi's `arc()` does not lift the pen

**Date.** 2026-09-13. **Replaces.** Every direct `arc()` call in `floor/`.

All arcs go through `bake.ts`'s `arcAt()`, which issues a `moveTo` to the arc's first point
before the arc itself.

**Why.** `arc()` mirrors the canvas call it is named after, including the part nobody remembers:
it draws a line from wherever the path currently is to where the arc begins. An arc issued after
any other drawing therefore arrives with a chord attached.

**Evidence.** The baked floor drew a 26-unit-wide band clean across the room, from the end of
the lectern's book line to the start of the hearth's recess, because those two calls are
consecutive and the hearth is a thick stroke. The wall's hairlines picked up smaller ones at the
door, and the keyboard focus ring — four brass arcs — came out as a brass cat's cradle.

**Consequence.** None of this was visible in the Playwright suite, which does not look at
pixels, and none of it was visible in the unit tests, which check geometry rather than drawing.
It was visible the instant the real binary was run and looked at, which is the second time that
rule has paid for itself (see 0006).

---

## 0013 — The roster answers with what a familiar is doing, not only with what it is

**Date.** 2026-09-13. **Replaces.** `list_familiars` returning the binding's row verbatim.

`list_familiars` overlays three live sources onto each row: whether the familiar has a process,
what its current commission's status is, and whether anything of its is waiting on a seal.

**Why.** A binding is a file and says who a familiar is. It cannot say what it is doing, and the
row was reporting `dormant` for every familiar for ever. That made §7.4's six sigil states and
the whole of §8.3's floor decorative — the room drew a state table that nothing in the
application could move. Found by summoning a familiar in the running binary and watching it sit
at the hearth.

**A seal outranks everything else.** §8.4 makes "is anything waiting on me?" the one question the
floor has to answer at a glance, so a familiar with a pending request reads as `awaiting-seal`
whatever else is true of it.

**Why it is polled.** Most of these transitions are invisible to the filesystem: a summoning
starting, an engine taking a turn, a commission ending. There is no event to subscribe to for
"the engine is working now", so the window asks every 2.5 seconds and stores the answer only
when it differs. A seal being raised or answered also refreshes it immediately, because that one
does have an event.

---

## 0014 — The runaway guard has no way of knowing what `on_exceed` says

**Date.** 2026-09-14. **Replaces.** Nothing; this is the first statement of it.

`breaker::guard::check` takes tool calls, tokens, a model and a cap. It does not take
`on_exceed`, and there is no path by which it could read one.

**Why.** §6.5 says the guard fires "regardless of `on_exceed`", and a rule stated that way is
one somebody will eventually soften — a plausible-looking `if on_exceed == Steer` is two lines
and reads like a kindness. The surest way to keep it true is for the function to have no way of
asking. A test says so in as many words, so that adding the parameter breaks something with a
comment explaining why.

The separation is not arbitrary. A budget is the owner's judgement about how much a piece of
work is worth, and `on_exceed` is their judgement about what to do when it runs out. The guard
is neither: it is the answer to "something has gone wrong and nobody is watching", and a binding
saying `steer` is an instruction about *budgets*, not permission to spin for ever.

**Consequence.** A fresh install has a spend cap, because the run nobody is watching is exactly
the one that happens before anybody has opened the workbench. A cap of zero turns that half off;
nothing turns the tool-call half off.

---

## 0015 — Extending a commission's aether moves the line

**Date.** 2026-09-14. **Replaces.** Unbinding on its own.

Sealing the request §6.5's `bind` raises records an extension against that commission, and the
heartbeat judges it against a budget grown by one more of whatever the binding set.

**Why.** The first version simply unbound the familiar and forgot what the breaker had done.
That bought about four seconds. The next tick read the same overspend — nothing about the
reading had changed — bound it again, and put a second identical request in the queue. Found in
the running application, with both rows in the `seals` table and a familiar that was refused a
read immediately after its owner had said yes.

"Extend" has to mean the budget is larger, or the word is a lie and the button is a snooze that
does not snooze.

**Consequence.** Each yes is worth one more budget: a familiar bound at thirty minutes and
extended once runs to sixty. The warning at 80% is re-armed with it, so the familiar is warned
on the way to the new line rather than walking into it in silence.

---

## 0016 — The Zod enums are checked against the generated types

**Date.** 2026-09-14. **Replaces.** Hand-maintained lists in `src/lib/schemas.ts`.

Every enum at the IPC boundary is declared as a `const` array with `satisfies readonly T[]`,
where `T` is the ts-rs-generated union.

**Why.** §5 wants both sides to validate, so the shapes are written twice — once as a Rust type
generated into TypeScript, once as a Zod schema. A Zod enum is a list of strings with no
relationship to the type it mirrors, so the two drift the moment a variant is added in Rust.

**And they drift silently**, which is the part that matters. The failure is a parse error inside
a `catch`, so nothing is logged and nothing looks broken. Phase 6 added two seal kinds; the rail
went on reading "none waiting" beside a familiar whose own row said it was waiting on a seal,
because `sealsPending()` was throwing on a `kind` Zod had never heard of. Two parts of the same
rail disagreeing on screen, with no error anywhere.

**Consequence.** Adding a variant in Rust, regenerating, and forgetting `schemas.ts` now fails
`bun run typecheck`. It caught the missing `Seals.tsx` labels in the same pass.

**Amended 2026-09-14: `satisfies` alone was only half of it.** It checks that every string in
the list *is* a valid variant, and says nothing about whether every variant is in the list —
which is the direction that actually happens. Phase 7 added `ward_fired` in Rust, regenerated,
and typechecked cleanly with Zod still unable to parse it: the same bug as the one this entry is
about, under the guard that was supposed to prevent it. A `Covers<T, U>` type now asserts the
other direction and names what is missing, and every guarded enum carries both.

---

## 0017 — Wards are scheduled on the heartbeat, not on `tokio-cron-scheduler`

**Date.** 2026-09-14. **Replaces.** §5's named crate for this job.

§6.7's standing wards are driven from the heartbeat thread built in Phase 6, using the `cron`
crate to parse and evaluate the expressions. §5 names `tokio-cron-scheduler`.

**Why.** That crate wants a tokio runtime, and nothing long-running in this application is async:
the heartbeat, the seal's listener and the pty pump are all plain threads. Adding a runtime for
one feature would mean two concurrency models in a codebase that currently has one, and a second
scheduler to start, stop and reason about beside a thread that already ticks, already holds the
database, the roster and the summonings, and already runs with the window closed.

A ward's resolution is minutes. A five-second tick is more than the job needs.

**Consequence.** `ward::due` is a pure function of `(schedule, last came round, now)`, so every
rule about wards is testable without waiting for a clock — missed windows, weekly schedules, a
clock adjusted backwards. The whole of §6.7's timing behaviour is checked in microseconds.

---

## 0018 — A skipped turn is a turn

**Date.** 2026-09-14. **Replaces.** `last_run` moving only when a ward fires.

When a ward comes round and its familiar is busy, the occurrence is spent: `last_run` moves, and
the ward is asked again at its next scheduled time.

**Why.** The first version reasoned that a skipped ward had not run, so the clock should not
move and it should be asked again shortly. It had not run — but it had *come round*, and being
due again immediately meant due on every heartbeat. A busy familiar in the running application
produced **thirty-three skips in two and a half minutes**, one per tick, each a database write.

Nothing queued, which is the rule §6.7 states outright and the one that matters. But "a daily
ward that has skipped 30 times" means thirty days, not thirty seconds, and the reading that
produces the former is "skips that run" — that occurrence, spent.

**Consequence.** `last_run` means "when it last came round", and `last_result` is what says
whether that turn became a commission. A daily ward busy at nine is skipped and tries again
tomorrow, which is what a person setting one up would expect.

---

## 0019 — A summon begun while the pane is still asking is not a re-attach

**Status:** accepted · **Concerns:** §6.1, §12 · **Found in:** the Phase 7 verification pass

**Context.** `Terminal.tsx` asks the backend on mount whether this familiar is already running,
because the pane is unmounted whenever you look at another familiar and a summoning outlives it
(DECISIONS 0010). That question is in flight for as long as a dynamic import and an IPC round
trip take. Press Summon inside that window and the answer comes back `true` — not because
anything was already running, but because the summon that has just started is what it found.

The pane then wrote "— reattached; what came before is not shown —" over a terminal that had
just started, and installed a second `onData` handler on the same xterm. Both handlers call
`sendInput`, so **every keystroke reached the engine twice**: typing `abc` sent `aabbcc`.

**Decision.** A `summoning` ref, set synchronously at the top of `summon()` before anything is
awaited and cleared when the effect mounts, and checked alongside `found` and `abandoned`. The
guard has to be a ref rather than the `status` state: `setStatus` is not synchronous, and the
race is decided in the microtask between the click and the first `await`.

**How it was found, and why it needed a new test.** Two Playwright tests failed in a full-suite
run and passed on every rerun of that file alone, including twenty-four repeats at double the
workers. A window a few milliseconds wide is not something a test hits by trying. `ipc.mock.ts`
now reads `grimoire.mock.attachDelay` from `localStorage` and holds `attachSummoning` open for
that long, which turns the race into a certainty; the test seeds it with `addInitScript`. The
knob costs nothing when unset and exists only in the mock backend, which is test-only already.

Calling this a flake and rerunning would have shipped doubled keystrokes to the owner's engine.

---

## 0020 — Art generated on the owner's Higgsfield account is the owner's art

**Status:** accepted · **Concerns:** §1, §7.4, §8.1, §10 Phase 9 · **Replaces:** 0005, and the
rule that `git status` never shows an image file · **Decided by:** the owner, 2026-09-30 —
"use higgsfield for the rest of the generations"

**Context.** §1 allows three kinds of visual: drawn in code, an open-licence typeface, or "made
by the owner". The owner had already committed two Higgsfield images (the observatory and a
sheet of five familiars, 7814cfe) without an entry here, and has now said that the rest of the
generations go through Higgsfield too. §8.1 and Phase 9 ask for a floor and an app icon drawn
in code; that is the part this changes.

**Decision.** An image generated on the owner's own Higgsfield account, at the owner's direction,
for this project, is "made by the owner" under §1 and may be committed. Four rules keep §1's
purpose, which was never about pixels versus code but about owing nothing to anyone:

1. **Every generated file has a row in `src/assets/higgsfield/PROVENANCE.md`**: its job id, model,
   prompt, references, and what was done to it afterwards. A file without one does not ship.
2. **References are this repository's own images only**: earlier generations, code-drawn marks,
   diagrams drawn from `plan.ts`. No prompt names another work, artist, studio, game or franchise.
3. **The canon in §3 still binds.** Generated figures are the orders' familiars, with no names
   written into the pixels. Captions baked into the first sheet were the reason it was replaced.
4. **The code keeps the meaning.** State is still drawn in code, where it is exact: the sigil in
   the rail, the state ring, the aether arc, the brass dot, the thread of ink, the lit ward
   circle, the lamp rings. A generated image may set the scene; it may not be the only place a
   state is shown. And everything generated has a drawn fallback (0021).

**What is generated now.** The floor, as a top-down painting registered to `plan.ts` rather than
the perspective view it replaced, which could line up with nothing. The five familiars, one
transparent figure per order. The app mark, the Grimoire sigil as a brass medallion;
`scripts/icons.ts` still draws the tile, its light and its shadow on Apple's 1024 grid, and
still derives every size from one composition.

**What this costs.** 4.2 MB of images in the repository and the bundle, where §1 as written
allowed none: 2.1 MB added in this change, beside the owner's 2.2 MB observatory. The old sheet
(4.7 MB) went out in the same change, so the bundle is lighter than 1.0.2's. A reader can no longer check §1 by running
`git status`; they check it by reading `PROVENANCE.md` against `git ls-files '*.png' '*.jpg'`.

**CLAUDE.md §1 says this now.** Amended 2026-09-30 at the owner's request: the four rules above
are its five (the first, "Higgsfield only, on the owner's account", was implicit here and is
stated there), with a line saying how to read the later sections that still say "drawn in code".

---

## 0021 — The floor's art is loaded before anything uses it, and a floor that fails fails alone

**Status:** accepted · **Concerns:** §6.1, §8.6, §8.7, §11, §12 · **Found in:** the Phase 9 pass

**Context.** The floor is the default view, and it had never drawn in a packaged build. Two
different things were wrong depending on where it ran, and four more were waiting behind them.
Every one of them passed the browser suite, because the browser has neither the CSP nor the
`tauri://` scheme; the ones marked *binary* were found by running `tauri build` under `Xvfb`.

1. **Packaged builds (1.0.1, 1.0.2, every platform): Pixi refused to start.** Pixi v8 builds its
   shader glue with `new Function`. The CSP in `tauri.conf.json` forbids eval, so `app.init`
   threw "Current environment does not allow unsafe-eval", and the owner's first-light scene
   caught it: "The tower lost its lens", with a button offering to restore five familiars who
   were already in the rail. The scene never said why. *Binary.*
2. **`tauri dev` and the browser: an empty window.** With no CSP, Pixi started, and `actors.ts`
   built its familiars from `Texture.from()` of an image nobody had loaded. In Pixi v8 that is a
   cache lookup, not a load: it returned nothing, the first draw threw, nothing caught it, and
   React unmounted the root — rail, seal count and Roster toggle with it. Every test in
   `floor.spec.ts` waits on `data-ready`, and they had all been timing out since that commit.
3. **The tick reset the sprite's scale to 1** every frame, to bob it. With the texture actually
   loaded, each familiar would have been drawn at its native 454×700, across half the room.
4. **The observatory was a CSS background behind the canvas**, blended with `screen`. It did not
   pan or zoom with the plan drawn over it, and as a perspective view it could not line up with
   an orthographic plan in any case: the painted ward circle was a hundred units from the one
   you click.
5. **Pixi decodes images in Web Workers built from `blob:` URLs**, after asking another such
   worker whether `ImageBitmap` works. The CSP has no `worker-src`, the worker never starts, and
   Pixi listens only for its reply: the load neither resolves nor rejects. *Binary* — with
   workers left on, the floor sat without its familiars until the limit below gave up on them.
6. **Pixi mangles rooted URLs on a custom scheme.** It resolves Vite's `/assets/name.png`
   against the page's root, and only knows what a root is for `http:`. Under `tauri://localhost`
   (macOS and Linux) every image was requested from `tauri://assets/name.png`, with no host.
   Windows (`http://tauri.localhost`) would have been spared. *Binary.*

**Decision.**

- **`import "pixi.js/unsafe-eval"`** in `stage.ts`, before anything is initialised. It is Pixi's
  own module for this, and it leaves the CSP exactly as strict as it is. Adding `'unsafe-eval'`
  to the CSP would have been the one-word fix and the wrong one (§11).
- **`art.ts` loads everything through `Assets.load` before any actor exists**, on the main thread
  (`loadTextures.config.preferWorkers = false`), with each URL resolved against the page first
  (`assetUrl.ts`), and eight seconds per file. It never rejects. A portrait that does not arrive
  is the familiar drawn in code; a painting that does not arrive is the whole vector plan, as it
  was drawn before any art existed. Either way a line in the corner of the floor says what did
  not load and why (§3), not only a console nobody opens.
- **What bobs is a container, not the sprite**, so nothing that animates can undo the sprite's fit.
- **The painting is a sprite inside the world**, under the baked layer, registered to the plan
  (0020, and `PROVENANCE.md` for the arithmetic). With it present the bake draws only what the
  painting cannot know: the order-coloured lamp rings and the labels. The lamps moved to where the
  painting lit them (`LAMPS` in `plan.ts`), and the lit ward circle gained a band of light,
  because a brass line on a painted brass ring changes nothing anyone can see (§8.4).
- **`FloorBoundary` wraps the floor.** A throw anywhere in it replaces the floor with a sentence
  and a Show the roster button; the rail is untouched. §8.7 says the floor is never the only
  route to anything, and until now one exception in it was the route to everything.
- **The first-light scene says why the renderer failed**, and when it failed, offers the roster
  rather than a restore of bindings that are already there. Its figures are positioned
  absolutely: WebKitGTK does not resolve a percentage height on a grid item's image, and they
  had spilled across the heading.

**Tests.** `floor.spec.ts`: the floor opens painted, with five portraits and no page errors (run
against the unfixed code, it fails, as does every older test in the file); with every image
refused it opens drawn in code, every familiar still on it, and says what did not load; with
WebGL taken away it says why and its button puts the floor away. `assetUrl.test.ts` pins the
URL the loader is given under `tauri://`. The CSP faults (1, 5) and the scheme fault (6) cannot
be seen by a browser test here; each was seen, and seen fixed, in the binary.

---

## 0022 — The bake is sized for the largest zoom, and asked the same question it answers

**Status:** accepted · **Concerns:** §8.3, §8.6 · **Found in:** the Phase 9 pass, at 1×

**Context.** `stage.ts` decided whether the baked room was stale from the reader's zoom
(`view.zoom >= 0.9`). `bake.ts` recorded whether it had drawn the labels from zoom × fit × device
pixels. On a 1× display where the room fits below 0.9 — 1280×800 fits at about 0.76 — the two
answers never agreed, so every `setView` re-baked the whole plan: every pointer move of a drag
and every wheel notch. The test below counted 13 and 15 extra bakes for one drag and six
notches. On Retina the device pixels pushed the bake's answer over 0.9 and the two happened to
agree, which is why it was never seen. The same mismatch meant a 1× display never showed the
station labels at the default zoom, which §8.3 asks for at 0.9× and above.

Fixing only the question would have uncovered what the bug was hiding. The texture's resolution
was taken from the zoom at the moment of baking; once a zoom inside its band stops re-baking,
zooming in magnifies a texture made for a smaller view. On Retina that was already happening.

**Decision.** `rebake` decides the label band once, from `view.zoom` against `PLATE_ZOOM`, and
hands it to `bake`, which no longer works it out. The texture is sized for `MAX_ZOOM`: `fit ×
MAX_ZOOM × devicePixelRatio`, capped at 3 as before. The room is drawn once per resize or band
crossing, and is sharp at every zoom in between.

**Consequence.** At 1280×800 the texture is about 1520² at 1× (9 MB) and 3000² at 2× (36 MB),
inside the budget 0011 accepted. Station labels now appear at the default zoom on a 1× display.

**Test.** `floor.spec.ts`, "panning and zooming inside a band does not redraw the room": a drag
and a zoom in and out that stays above 0.9× leave `data-bakes` where it was, and crossing 0.9×
adds exactly one. Against the old stage it failed, 4 bakes becoming 17 and 19. The count is
`stage.stats.bakes`, written to the floor's readout beside the frame counter.

