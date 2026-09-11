# Quintet

Personal macOS desktop app that runs a bench of specialist Claude agents through
Claude Code headless (`claude -p`). The full product spec is in [CLAUDE.md](./CLAUDE.md).

## Layout

| Path | What |
|---|---|
| `crates/quintet-core` | All app logic (registry, stream parser, prompt assembly, run manager, SQLite). No Tauri dependency, fully testable on Linux. |
| `src-tauri` | Thin Tauri 2 shell: commands, events, tray, notifications, vibrancy. |
| `src` | React 19 + Tailwind v4 UI. |
| `mcp` | `quintet-mcp`: Bun MCP server + CLI (`serve`, `doctor`, later `auth`, `exec`, `sync`). |
| `db/migrations` | Numbered SQL migrations, applied by Rust at startup. |
| `agents-default` | Shipped agent folders, copied to `~/Quintet/agents` on first launch. |
| `docs` | `claude-cli-notes.md` (Phase 0 findings) and `decisions/` (ADRs). |

## Develop

```bash
bun install                      # UI + mcp workspace
cargo test -p quintet-core       # Rust unit + integration tests (fake claude binary)
bun test                         # mcp + UI unit tests
bun run test:e2e                 # Playwright against `vite dev` with the IPC mock
bun run tauri dev                # the real app (needs Tauri system libs; macOS for vibrancy/tray)
```

Live tests against the real CLI (spends subscription usage, haiku, budget-capped):

```bash
QUINTET_LIVE=1 cargo test -p quintet-core --test live_claude -- --ignored
```

## Verify on a Mac

Some acceptance checks cannot run in the Linux build container. On macOS, confirm:

- Sidebar vibrancy and the overlay title bar.
- Notification click routing (questions, approvals).
- "Reveal in Finder" / "Open in…" from the Outputs tab.
- Isolation from `~/.claude` skills and CLAUDE.md with the real 50+ skill setup (see `docs/decisions/0001-*`).
- `bun run tauri build` with ad-hoc signing.
