# Grimoire

A study for working with several coding agents at once.

Grimoire wraps interactive CLI agents — `claude` today, others when they can be sealed — in real
pseudo-terminals, and gives each one a name, a brief, a budget and a workspace. An agent here is
a **familiar**: a markdown file with YAML frontmatter, its instructions the **writ**, its
long-term notes the **codex**. Nothing a familiar does that reaches outside its workspace
happens without the **seal**, an approval you give by hand.

It is a local application for one person. There are no accounts, no telemetry, no update check,
and no network calls of its own — only what the agent CLIs make for themselves.

The specification is `CLAUDE.md`. It is the source of truth: where it and the code disagree, the
code is wrong. Deviations are argued in `DECISIONS.md` rather than made quietly.

## Using it

1. Pick a familiar in the rail, or click one on the floor.
2. On its **commission** tab, say what you want done in plain words, and answer any questions it
   asks.
3. Press **Summon and start**. It opens in its terminal and starts on the task. If it is already
   working, the same button puts the task in its queue.
4. Watch it on the **terminal** tab, or leave it. Anything that needs your say waits in **Seals**.
5. When the work is finished, press **Mark done**. It stays summoned and takes the next task in
   its queue. **Banish**, at the top, stops it.

A short tour opens on first launch, and **How it works** in the rail explains every word the
interface uses and replays it.

## State

Phases 0 to 8 of §10 are built, and Phase 9, the packaged build, is under way: releases are cut
for macOS and Windows, and a week of real use on the owner's Mac is what remains. Familiars are files:
press **New familiar** in the rail and fill in a form — a name, what it is for, the folder it works
in, its instructions, how much it may do without asking — or drop a `.binding.md` in
`~/.grimoire/bindings` yourself; either way one appears. Change one on its settings tab or in the
file and the change arrives without a restart; break it and it says what is wrong rather than
vanishing. While one works, the box on its commission tab tells it something mid-task. Give one a
commission and press Summon and start: a real agent CLI starts in a pseudo-terminal with the
binding's writ as its briefing and the commission as its first message. Mark it done and the
next in its queue is handed to the same session. What it costs is recorded, and what it
stopped halfway through is still there, correctly marked, after a restart. Five bindings ship
and are placed on first run.

**The floor is what it opens on.** A wide tower hall painted from directly above, with every
familiar standing in it at once: dormant ones milling about in front of the hearth, summoned
ones strolling near their own order's desk, working ones at the desk with a thread of ink running
to the lamp, and anything waiting on you standing in the ward circle with the circle lit brass
around it. Summoning walks a familiar in through the door; banishing walks it out. They step as
they walk, turn to face where they are going, and nod over the desk while they work; with
reduced motion none of it moves. Hover a mark for what it is doing and what it has spent, click it
to open its workspace with the floor still in sight above. The painting is registered to the
plan underneath, so what you click is where it is drawn; the states on top of it (rings, arcs, the
thread of ink, the lit circle) are drawn in code, and if the art ever fails to load the plan is
drawn in code too. There is a Roster toggle for when you would rather have the list.

**Some of it happens without you.** A standing ward is a schedule, a prompt and a familiar: a
morning brief, a weekly tidy, a nightly check. It fires with the window closed, because closing
the window does not quit — Grimoire sits in the menu bar and the scheduler goes on ticking. The
prompt it sends next month is byte-for-byte the one you read when you wrote it, and a ward whose
familiar is already busy skips that turn rather than queueing behind it.

**Nothing runs away.** Every commission is metered on tokens, turns and minutes. At 80% of
whichever budget is tightest the familiar is told to prioritise finishing, and the rule under
the meters turns brass. At the line the binding decides: keep going under protest, stop and ask
to be extended, or be stopped. Separately from all of that — and deliberately deaf to what the
binding says about it — a commission past two hundred tool calls or past the spend cap is
stopped regardless. A familiar that has gone quiet for ten minutes is raised for you to look at,
and never killed on your behalf.

**The seal is real.** A familiar stops before every tool call and, when its binding does not
already allow what it is about to do, waits on your answer — genuinely waits, blocked on a local
socket, not asked nicely in a prompt. Deleting outside the workspace, force-pushing, and touching
anything with `.env`, `.ssh`, `credentials` or `.git/config` in its path always ask, at every
autonomy level, because that list is in code and `free` does not reach it. Enforcement is in
Rust: a writ instructing a familiar to ignore the seal has been tried against a live engine and
gets nowhere.

`TASKS.md` has the detail, including the two Phase 1 criteria this development container cannot
check and why.

## Running it

### Download for macOS

[Download Grimoire for Apple Silicon (M1 and later)](https://github.com/sussyswimmer/agent-hub/releases/download/v1.0.5/Grimoire_1.0.5_aarch64.dmg)

[Download Grimoire for Intel Macs](https://github.com/sussyswimmer/agent-hub/releases/download/v1.0.5/Grimoire_1.0.5_x64.dmg)

[Download Grimoire for Windows](https://github.com/sussyswimmer/agent-hub/releases/download/v1.0.5/Grimoire_1.0.5_x64-setup.exe)

**Opening it the first time on a Mac.** Grimoire is not notarized by Apple, so macOS asks you to
allow it once:

1. Open the `.dmg` and drag **Grimoire** into **Applications**, then eject the disk image.
2. Open Grimoire from Applications. macOS says it cannot check it for malware; press **Done**.
3. Open **System Settings → Privacy & Security**, scroll down to **Security**, and press
   **Open Anyway** beside the line about Grimoire. Confirm, and it opens. After that it opens
   normally.

If macOS instead says Grimoire **is damaged and can't be opened** (1.0.3, and 1.0.4 downloaded
before 07:10 UTC on 1 October 2026, which were not signed), drag it to Applications and run this
once in Terminal, then open it:

```
xattr -dr com.apple.quarantine /Applications/Grimoire.app
```

[See all releases](https://github.com/sussyswimmer/agent-hub/releases).

On a Mac, from nothing. You need Rust stable, [Bun](https://bun.sh), and the Xcode command line
tools — Tauri builds against the system webview, and `xcode-select --install` is what puts the
headers there.

```
git clone <this repository> grimoire && cd grimoire
git checkout claude/sharp-euler-l2gy92
bun install
bun run tauri dev
```

The first build takes a few minutes; after that it is seconds. `bun run doctor` says what this
machine is missing and what to do about each thing, and is the first thing to try when something
does not start.

**The first run** creates `~/.grimoire`, places the five seed bindings in
`~/.grimoire/bindings`, and opens on the floor with all five dormant at the hearth. Nothing runs
until you summon it. The seeds point at the owner's own folders, so on any other machine each one
says *needs a folder* in the rail: open it and press **Choose a folder**, or make your own with
**New familiar**.

**Summoning needs `claude` on your `PATH`.** Without it the Summon button is disabled with the
reason on hover rather than failing when pressed — that is the design (§6.1), not a fault. The
engine's own first-run screens, the theme picker and then the login, appear inside the first
summoning's terminal and are answered there, like any other terminal program. Grimoire
deliberately does not pre-answer them; `crates/grimoire-core/tests/engine.rs` says why.

Two things you do not need:

- `bun run fonts` is **optional**. EB Garamond and Iosevka are committed with their licences. It
  is worth running once on a machine that can reach github.com, because that is where Junicode —
  the display face §7.3 actually asks for — lives, and it could not be fetched from the machine
  this was built on. See `DECISIONS.md` 0003.
- `bun run icons` is **automatic**. The icons are composed from `src/assets/higgsfield/app-mark.png`
  into a gitignored folder, and `bun run tauri dev` and `bun run dist` both do it before anything
  compiles.

`VITE_IPC_MOCK=1 bun run dev` serves the interface alone, in a browser, against an in-memory
backend — no Rust build. That is how the Playwright suite runs.

## Checking it

```
cargo test --workspace
cargo clippy --all-targets -- -D warnings
bun run typecheck
bun test src                 # contrast ratios, sigil determinism
bunx playwright test         # layout at 1280×800 and 1024×640
bun run licences             # regenerates THIRD-PARTY.md; should leave no diff
```

Some tests drive a real agent CLI and are ignored by default, so a machine without one still
passes. Run them deliberately:

```
cargo test -p grimoire-core --test engine -- --ignored --nocapture
```

## Building a release

On your own machine, for the platform you are on:

```
bun run dist
```

Which composes the application icons on the way past — see `DECISIONS.md` 0020 for what is
generated and what is drawn.

For a published release with every installer, let GitHub build them:

1. Bump the version in `Cargo.toml`, `package.json` and `src-tauri/tauri.conf.json`, and write
   the notes in `.github/release-notes/v<version>.md`.
2. Push a `v<version>` tag, or run **Actions → Release → Run workflow** with that tag.
3. The Release workflow checks the tag against the version, builds the two macOS disk images
   and the Windows installers, and attaches them to a **draft** release. Read it, then publish.

Every push also runs **CI**: the whole test suite on Linux. Installers are built only by the
Release workflow, because macOS runners cost ten times as much as Linux on a private
repository (`DECISIONS.md` 0023).

## What to distrust

Grimoire is built for macOS and was built on headless Linux. Everything below is written, is
reviewed, and has never been seen working on the platform it is for. `TASKS.md` has the full
table and the reason for each; these are the ones most likely to surprise you in the first hour.

| Likely to bite first | Why it was never seen here |
| --- | --- |
| The menu bar, and closing the window instead of quitting | No session bus in the build container, so the tray never appeared at all |
| Notifications — ward runs, seal requests | Notification Center |
| Native window chrome, traffic lights over the overlay title bar | The macOS window server |
| Dragging the window to resize a live terminal | `Xvfb` has no window manager. The pty resize is tested directly instead |
| A full model turn through the interactive terminal | The container's engine could never log in |
| A commission typed into a running `claude` as a paste | Proven against a stand-in engine only, for the same reason |
| The floor's real frame rate | Measured on a software rasteriser, which is not a measurement |

Nothing in that list is claimed as done anywhere in this repository. If one of them is broken,
it is broken for a reason that is written down.

## Where the art comes from

No art is vendored. The sigils, the state marks and the plan are drawn in code from
`src/ui/sigil-geometry.ts` and `src/scriptorium/floor/`. The painted floor, the five familiars
and the application mark were generated for this project on the owner's Higgsfield account;
each one's job id, prompt and post-processing is in `src/assets/higgsfield/PROVENANCE.md`, and
`DECISIONS.md` 0020 is the ruling that makes them the owner's. The two typefaces are OFL-1.1
and vendored with their licence texts. `THIRD-PARTY.md` lists every runtime dependency.

Grimoire is MIT.
