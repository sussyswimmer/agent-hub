# Handoff

Written for whoever picks this up next, human or otherwise. `CLAUDE.md` is the specification and
the source of truth — where it and this file disagree, read `CLAUDE.md`. This file is only the
state of play: what is built, what is known broken, what is untested, and what to do first.

Branch: `claude/laughing-lamport-pk21v3`, which carries `claude/sharp-euler-l2gy92` and the owner's
releases on top. Nothing has been merged into a default branch.

---

## 1. Read these first, in this order

| File | What it is | Why you need it |
| --- | --- | --- |
| `CLAUDE.md` | The specification | §1 (originality and licensing) and §11 (security) are binding constraints, not suggestions. §10 is the phase order. |
| `DECISIONS.md` | Twenty-one entries | Every place the code diverges from the spec, and why. Do not re-litigate one without reading it. |
| `TASKS.md` | Session log, per phase | What was verified by hand and what could not be. The "Blocked here — needs the Mac" table at the end is the honest list. |
| `README.md` | For the owner, not for you | "Running it" and "What to distrust". |

Two rules from `CLAUDE.md` §0 that this project has actually been run under, and that the next
session should keep:

- **Build it and run it.** Every phase here ended with the real binary driven by hand under
  `Xvfb`, not with "the tests pass". Every phase that did so found something no test suite had.
  That is the single most valuable habit in this repo's history — see §6 below for the tally.
- **Never report a phase complete on the strength of the code compiling.**

---

## 2. Where the work stands

Phases 0 through 8 of §10 are done and committed. Phase 9 is under way: CI cuts macOS and
Windows installers, the app icon is composed from generated art (DECISIONS 0020), and the week of
real use on a Mac is what remains.

| Phase | What it is | State |
| --- | --- | --- |
| 0 | Scaffold, tokens, fonts, sigils, SQLite, shell | Done |
| 1 | One real familiar in a PTY | Done. `portable-pty` stayed; DECISIONS 0007 |
| 2 | Bindings as files, five seeds, four tabs, intake | Done |
| 3 | Commissions, queue, persistence, codex, ledger | Done |
| 4 | The seal: autonomy, bounds, never-exempt list | Done, and proved against a live engine |
| 5 | The floor | Done |
| 6 | Aether and the breaker | Done |
| 7 | Standing wards and the menu bar | Done, except the tray itself (no session bus here) |
| 8 | The archivist | Done. It proposes; it cannot dispatch |
| 9 | Ship | **Under way.** Installers build in CI; the week of use on a Mac is not started |

Commit history on the branch, newest first:

```
4e41a60  chore: make a clean clone build, and say what has never run on a Mac
e1c4744  docs: phase 7 report, and two rules the running application taught
c3c2307  feat(ui): the wards panel, the menu bar, and closing is not quitting
962f87c  feat(ward): standing wards, and the rules about when one runs
```

---

## 3. The shape of the code

```
crates/grimoire-core/src/     ← everything with a decision in it. Tested in isolation.
  binding/     YAML + serde parse of *.binding.md, validation errors kept rather than dropped
  breaker/     decide(reading, budget, done) -> Act. guard.rs is the runaway guard.
  codex/       read / condense / write, with the .bak that condensing must never skip
  commission/  lifecycle, the one-at-a-time queue
  db/          rusqlite, WAL, embedded forward-only migrations (DECISIONS 0002)
  ledger/      append-only events
  paths.rs     everything under ~/.grimoire; GRIMOIRE_HOME overrides it (use this in tests)
  seal/        server.rs is the unix-socket seal. THE most important file in the repo.
  security/    canonicalising path checks, bounds, the never-exempt list
  summon/      binary resolution, the engine's argv, the settings file that installs the hook
  ward/        due(cron, last_run, now) is pure; store.rs is the table
  types.rs     the ts-rs source of truth for the TypeScript types

src-tauri/src/                ← thin glue. Put logic in the crate, not here.
  commands.rs   every #[tauri::command]. state_of() decides what the roster reports.
  summonings.rs PTY lifecycle, the swappable output slot (DECISIONS 0010)
  heartbeat.rs  the 5s tick: wards, runaway guard, budgets, stall detection — in that order
  roster.rs     the bindings-folder watcher

src/                          ← React. IPC goes through src/lib/ipc.ts and nowhere else.
  lib/schemas.ts      Zod at the boundary, with the Covers<> exhaustiveness guard (DECISIONS 0016)
  lib/generated/      ts-rs output. Run `bun run bindings` after changing types.rs.
  lib/ipc.mock.ts     the in-memory backend behind VITE_IPC_MOCK=1; Playwright runs on it
  scriptorium/floor/  PixiJS. plan.ts is data; adding an order should mean editing one array.
  familiar/           the five tabs
  seal/Seals.tsx      the queue
  workbench/          engine paths, provider sign-in, spend cap, transcripts, restore seeds
```

---

## 4. How to run and check it

```
bun install
bun run doctor               # what this machine is missing, and what to do about each
bun run tauri dev            # draws the icons on the way past

cargo test --workspace
cargo clippy --all-targets -- -D warnings
bun run typecheck
bun test src
bunx playwright test
bun run licences             # must leave no diff
bun run bindings:check       # must leave no diff
```

Driving the real application headless, which is how every phase here was verified:

```
Xvfb :77 -screen 0 1280x800x24 -fbdir /path/to/fb &
DISPLAY=:77 GRIMOIRE_HOME=/path/to/a/scratch/home bun run tauri dev
```

`-fbdir` writes the framebuffer to a file you can convert and look at. Synthetic clicks and
typing go through XTest via ctypes on `libX11`/`libXtst`. **Do not use `pkill -f` or `pgrep -f`
here** — the pattern matches your own wrapper shell and kills it (exit 144). Use
`ps -eo pid,args | awk '$2 ~ /name$/'` instead.

---

## 5. What is missing, in the order it matters

1. **Phase 9 — the week of use.** Install the `.dmg` to `/Applications`, use it for a week without
   the dev server, and log in `TASKS.md` which parts of the floor were looked at and which never
   were. Blocked on the owner's Mac. Everything in §8 of this file is the list of what to watch.
2. **New art goes through Higgsfield** (the owner's instruction, DECISIONS 0020). Give it only this
   repository's images as references, write its row in `src/assets/higgsfield/PROVENANCE.md`
   before committing it, and keep a drawn fallback: `floor/art.ts` is the pattern.
3. **The ward panel is per-familiar**, with no global list. §6.7 does not ask for one; with five
   familiars there is nowhere to see every schedule at once.

---

## 6. What running the real thing has found, and why you should keep doing it

Every one of these passed every test suite in the repo at the time:

| Phase | What the tests said | What the running application did |
| --- | --- | --- |
| 0 | Green in Chromium | WebKit drew a sigil across its own status line |
| 1 | Green | Pressing Banish deadlocked |
| 5 | Green | The baked floor drew a band clean across the room; the focus ring was a cat's cradle (DECISIONS 0012) |
| 5 | Green | Every familiar reported `dormant` for ever (DECISIONS 0013) |
| 6 | Green | "Extend" bought four seconds — unbinding without moving the budget re-bound on the next tick (DECISIONS 0015) |
| 7 | Green | A skipped ward wrote to the database twelve times a minute (DECISIONS 0018) |
| — | Green | A fresh clone would not compile at all: no `icons` script existed |
| — | Two intermittent failures, green on every rerun | Pressing Summon inside the pane's own mount question doubled every keystroke to the engine (DECISIONS 0019) |

The pattern is consistent enough to plan around: the test suites protect against regressions in
things you already understood, and find nothing about things you did not.

---

## 7. Things that will bite you

- **The seal is the reason this project exists.** Enforcement is in Rust, in
  `crates/grimoire-core/src/security/` and `seal/server.rs`, before the action happens. The prompt
  is advisory. A hook that misses the engine's timeout **fails open**, so the hook keeps its own
  shorter deadline — see DECISIONS 0004. An adversarial writ instructing a familiar to ignore the
  seal has been run against a live engine under `--permission-mode acceptEdits` and got nowhere;
  keep that test working.
- **The never-exempt list is in code, not config**, and `free` does not reach it (§6.4). Anything
  that makes it configurable is a bug, whatever it looks like.
- **§1 is absolute.** No copied source, no vendored art, no names from published fiction anywhere —
  UI, comments, seed data, or "placeholders". The one kind of image allowed in is art generated on
  the owner's Higgsfield account, and only with its row in `src/assets/higgsfield/PROVENANCE.md`
  (DECISIONS 0020). An image file without one means something went wrong.
- **The browser suite cannot see the CSP or the `tauri://` scheme.** Three floor faults lived
  there, and the floor had never drawn in a packaged build (DECISIONS 0021). Keep
  `import "pixi.js/unsafe-eval"` in `stage.ts`; load textures with `Assets.load`, never
  `Texture.from(url)`, on the main thread, and through `assetUrl.ts`. Check the floor with
  `bun run tauri build --debug --no-bundle` under `Xvfb`, not only with `tauri dev`, which
  applies no CSP either.
- **`~/.grimoire` is the owner's real data.** Always set `GRIMOIRE_HOME` when testing.
- **Never log the writ, prompts, file contents or agent output** anywhere but the local transcript
  the owner can see and delete (§6.1). Redact key patterns from PTY output (§11).
- **After editing `crates/grimoire-core/src/types.rs`**, run `bun run bindings` and add the new
  variant to the matching Zod enum in `src/lib/schemas.ts`. The `Covers<>` guard will fail the
  typecheck if you forget — it exists because `satisfies` alone catches invalid entries but not
  missing ones (DECISIONS 0016, and its amendment).
- **Playwright**: the floor is opt-in per project via `storageState` (`grimoire.floor = "0"`).
  Mounting a software-rendered WebGL context in every test took the suite from 3 minutes to 12.
- Two Playwright specs in `shell.spec.ts` were failing on a `locator("main")` strict-mode
  violation at one point; `FamiliarPane` became a `<section>` to fix it. If you see it again, it
  is a second `<main>` creeping back in.
- **A Playwright test that fails only in a full run is not a flake until you have proved it is
  one.** The two that did exactly that turned out to be a real race that sent every keystroke to
  the engine twice. `src/lib/ipc.mock.ts` has a `held()` helper reading delay knobs from
  `localStorage` for precisely this: widen the window until the race is a certainty, then write
  the test against it. DECISIONS 0019.

---

## 8. Never run on a Mac

This was all built on headless Linux. `TASKS.md`'s last table is the full list with reasons. The
short version: the menu bar and notifications (no session bus, no Notification Center), native
window chrome and the overlay title bar, dragging the window to resize a live terminal, a full
model turn through the interactive terminal (the container's engine could never log in), the
floor's real frame rate (measured on a software rasteriser, which is not a measurement), and
whether the `.app` builds at all.

None of it is claimed as done anywhere in the repository. Do not start claiming it.

---

## 9. If you are starting a session right now

Ask which of these the owner wants, rather than guessing — they are not in a fixed order:

1. **The workbench** (§5.1 above) — the biggest functional gap, and the one that makes existing
   features reachable.
2. **Phase 8, the archivist** — the next phase in §10's order.
3. **First-run repair** — whatever the owner hit when they actually ran it on their Mac. This
   takes priority over both of the above the moment there is a report.

Whatever you pick: read `CLAUDE.md` in full first, build in phase order, write the test before
claiming the behaviour, run the real binary before reporting anything done, and append a session
log to `TASKS.md` at the end.
