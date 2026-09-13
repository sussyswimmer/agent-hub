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
`"EB Garamond"` immediately behind it, so the moment the file appears in `src/theme/fonts/` the
display sizes pick it up with no code change. **No unrelated face is substituted** — §1 forbids
it and a near-miss serif would be worse than the honest fallback.

**Consequence.** Display type is currently EB Garamond, one face rather than two. On a machine
that can reach GitHub, run `bun run fonts` and the difference appears by itself.

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

**Status:** accepted · **Concerns:** §1

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
