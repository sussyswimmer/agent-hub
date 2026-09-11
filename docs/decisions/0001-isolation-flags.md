# ADR-0001: Isolating agent runs from user-level Claude Code settings

**Status:** accepted (Phase 0, 2026-09-11). Re-verify on macOS with Maxwell's real `~/.claude`.

## Context

`CLAUDE.md` §3.1 requires that Maxwell's global `~/.claude` (50+ skills, plugins, hooks, CLAUDE.md)
never leaks into agent runs, and names `--setting-sources` as a candidate. Two other candidates exist
in 2.1.268: `--bare` and `--safe-mode`.

Observed (`docs/claude-cli-notes.md` §3):

- `--bare` reads no OAuth/keychain credentials ("Anthropic auth is strictly ANTHROPIC_API_KEY or
  apiKeyHelper"). Quintet runs under the subscription with no API key (§0 #11), so `--bare` cannot be used.
- `--safe-mode` removes user skills, agents and hooks, but also drops an explicit `--mcp-config`
  (`init.mcp_servers: []`). Quintet depends on `quintet-mcp`, so `--safe-mode` cannot be used.
- `--setting-sources ""` + `--disable-slash-commands` + `--strict-mcp-config --mcp-config <file>` +
  `--tools <explicit built-in list>` yields `skills: []`, `plugins: []`, `slash_commands: []`, no hook
  events, MCP `quintet: connected`, and only the named built-in tools.

## Decision

Every run is spawned with:

```
--setting-sources "" --disable-slash-commands
--strict-mcp-config --mcp-config <per-run json>
--tools "Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch"
```

plus an environment scrubbed of `CLAUDECODE`, `CLAUDE_*` and `SESSION_INGRESS*` variables, a pre-assigned
`--session-id`, and cwd = the agent's workspace (which contains no `CLAUDE.md`).

`--restricted` is kept as an optional add-on (settings flag, default on once verified on the Mac): it
confines Write/Edit to cwd and `--add-dir` directories, which implements §11 "deny file access outside
`~/Quintet/`" with `--add-dir ~/Quintet`.

## Consequences

- Bundled skills are hidden too (there is no flag to keep bundled and drop user-level). Agents get their
  behaviour from `agent.md`, which is what §1.5 wants anyway.
- `init.agents` still lists built-in agent names, but the `Task` tool is not exposed, so sub-agents are
  unreachable. Accept.
- Any future need for a bundled skill has to be met by prose in `agent.md` or a Quintet MCP tool.
