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

Phase 2 of twelve. Familiars are files: drop a `.binding.md` in `~/.grimoire/bindings` and one
appears, edit it and the change arrives without a restart, break it and it says what is wrong
rather than vanishing. Each one can be summoned — the terminal tab spawns a real agent CLI in a
pseudo-terminal, streams it to xterm.js, takes typed input, and stops cleanly on quit with
nothing orphaned. Five bindings ship and are placed on first run.

Commissions do not yet run, and **the seal does not yet exist**: a familiar's `bounds` are
advisory until Phase 4 puts enforcement in Rust.

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
