# ADR-0004: File permission rules for integrity levels (Edit rules, no symlink)

**Status:** accepted (Phase 0, 2026-09-11). Supersedes the mechanism sketched in `CLAUDE.md` §4 and §7.

## Context

§7 says that at integrity level ≤ 1 tool permissions narrow `Write`/`Edit` to `./memory.md` "e.g.
`Write(./memory.md)`", and §4 says the app symlinks `agents/<id>/memory.md` into the workspace.

Observed (`docs/claude-cli-notes.md` §6):

1. `Write(path)` rules are accepted but never consulted; `Edit(path)` rules govern Write, Edit and Bash
   redirections.
2. Path rules are matched after symlink resolution, so `Edit(./memory.md)` fails when `./memory.md` is a
   symlink to `../memory.md`.
3. `Edit(//<absolute>/agents/<id>/memory.md)` works with cwd = `agents/<id>/workspace`, without a
   symlink and without `--add-dir`.
4. `Bash(echo *)` being allowed does not let `echo x > file` bypass the Edit rules.

## Decision

- **No symlink.** `memory.md` stays at `agents/<id>/memory.md`; the workspace is the cwd; the protocol
  prompt tells the agent its memory is `../memory.md`.
- Level ≤ 1: `--permission-mode default --permission-prompts none` and an allowlist that contains
  `Edit(//<abs>/agents/<id>/memory.md)`, `Read`, the agent's non-file tools and `mcp__quintet__*`, but no
  bare `Write` or `Edit`. Deliverables at these levels go through `save_output(kind: "feedback", content)`.
- Level ≥ 2 (or agents without integrity): `--permission-mode acceptEdits` with the agent's own
  `allowed_tools`.
- `NotebookEdit` is always in the denylist.

## Consequences

- `agent.md` frontmatter keeps listing `Write`/`Edit`; `cmd.rs` strips them at level ≤ 1.
- The `Edit(//abs)` rule has to be built per run with the resolved absolute path (no `~`).
- `--permission-prompts none` means every unexpected tool use is denied loudly
  (`system/permission_denied`) rather than hanging; the UI shows these as "Blocked" rows.
