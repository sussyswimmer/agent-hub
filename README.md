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

## State

Phase 4 of twelve. Familiars are files: drop a `.binding.md` in `~/.grimoire/bindings` and one
appears, edit it and the change arrives without a restart, break it and it says what is wrong
rather than vanishing. Give one a commission and it queues; summon it and the oldest starts,
running a real agent CLI in a pseudo-terminal with the binding's writ as its briefing. What it
costs is recorded, and what it stopped halfway through is still there, correctly marked, after a
restart. Five bindings ship and are placed on first run.

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

Requires Rust stable, [Bun](https://bun.sh), and the Tauri v2 system dependencies.

```
bun install
bun run fonts        # vendor the woff2 faces into src/theme/fonts
bun run dev          # the interface alone, in a browser
bun run tauri dev    # the application
```

`VITE_IPC_MOCK=1 bun run dev` serves the interface against an in-memory backend, which is how
the Playwright suite runs without building the Rust side.

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

```
bun run icons        # draws the application mark; see DECISIONS.md 0005
bun run dist
```

## Everything you can see is drawn in code

No art is vendored. Every mark in the interface — the familiars' sigils, the application icon —
is generated from `src/ui/sigil-geometry.ts`, so `git status` should never show an image file.
The two typefaces are OFL-1.1 and vendored with their licence texts. `THIRD-PARTY.md` lists
every runtime dependency.

Grimoire is MIT.
