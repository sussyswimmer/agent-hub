# ADR-0002: Turn and budget limits

**Status:** accepted (Phase 0, 2026-09-11).

## Context

`CLAUDE.md` §3.2 relies on `--max-turns <agent.max_turns>`. In 2.1.268 the flag is absent from
`claude --help`, which raised the question of whether it still exists.

Observed: `--max-turns 2` is accepted. When the limit is hit the run ends with
`result.subtype == "error_max_turns"`, `is_error: true`, exit code 1, and `num_turns` one above the
limit. The session remains resumable. `--max-budget-usd` is also accepted and documented.

## Decision

- Pass `--max-turns <agent.max_turns>` on every run. Map `error_max_turns` to run status `failed` with
  reason `max turns (N) reached`; the row keeps `session_id` so a manual "continue" can `--resume`.
- Pass `--max-budget-usd <settings.run_budget_usd>` (default 2.00, informational under a subscription)
  as a second guard.
- The app also counts `assistant` turns from the stream for the live UI meter, but does not enforce
  on that count. If a future CLI drops `--max-turns`, enforcement moves to this counter (SIGINT at N).
