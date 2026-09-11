# Claude Code CLI notes (Phase 0)

Everything here was **observed** on 2026-09-11 with the setup below. Nothing is assumed from
documentation. Re-run `bun run scripts/spike.ts` after any CLI upgrade and update this file.

## 1. Environment

| Item | Value |
|---|---|
| `claude --version` | `2.1.268 (Claude Code)` |
| Auth | `claude auth status` → `{"loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty", ...}` (subscription, no API key). `init.apiKeySource == "none"` on every run. |
| Machine | Linux container (Ubuntu 24.04). Auth is injected by the environment, so a logged-out state could **not** be produced here (see §7). |
| Models | `haiku` → `claude-haiku-4-5-20251001`, `sonnet` → `claude-sonnet-5`, `opus` → `claude-opus-5` (from `system/init.model`). |
| Experiments | ~25 `claude -p` runs, `--model haiku`, `--max-budget-usd 0.25`. Raw captures in `scripts/out/` (gitignored); sanitized copies in `crates/quintet-core/tests/fixtures/stream/`. |

## 2. Verified flags

| Flag | Accepted | Observed | Exp. |
|---|---|---|---|
| `-p, --print` | yes | Non-interactive. Prompt via positional arg **or stdin**. | E1 |
| `--output-format stream-json` | yes | **Requires `--verbose`**: without it → `Error: When using --print, --output-format=stream-json requires --verbose`, exit 1. | E1 |
| `--verbose` | yes | Mandatory with stream-json. | E1 |
| `--append-system-prompt <text>` | yes | Works. Ignored on `--resume` (snapshot, §5). | E8 |
| `--append-system-prompt-file <path>` | yes (not in `--help`) | Works with a 2-line file and a 40 KB file. `result.result` shows the instruction took effect. | E5 |
| `--model <alias\|id>` | yes | Aliases resolve as in §1. | E6 |
| `--max-turns <n>` | yes (**hidden from `--help`**) | `--max-turns 2` on a 3-tool task → `result.subtype: "error_max_turns"`, `is_error: true`, exit code 1, `num_turns: 3` (one more than the limit). Session stays resumable. | E4, E8c |
| `--max-budget-usd <n>` | yes | Accepted on every run; never tripped at 0.25 for haiku. | all |
| `--allowedTools <rules...>` | yes | Variadic. `mcp__quintet__*` wildcard works. `Edit(//abs/path)`, `Edit(./rel)`, `Bash(echo *)` work. `Write(path)` is **accepted but never consulted** (§6). | E7, E9 |
| `--disallowedTools <rules...>` | yes | Variadic, separate args: `"Bash(curl *)" "Bash(git push *)" "mcp__*__send_*"`. `curl` denied with `decision_reason_type: "subcommandResults"`. | E10 |
| `--permission-mode acceptEdits\|default\|...` | yes | `acceptEdits` writes freely inside cwd; `default` + `--permission-prompts none` denies anything not in `--allowedTools`. | E9 |
| `--permission-prompts none` | yes | Denials are auto-answered: `system/permission_denied` event + `result.permission_denials[]`. Without it (in `-p` with no host) the outcome is the same denial, worded "no approval surface". | E7, E9 |
| `--mcp-config <file>` | yes | Variadic. Server appears in `init.mcp_servers` as `{name, status}`. | E7 |
| `--strict-mcp-config` | yes | Only the given config is loaded. | E3 |
| `--tools <names...>` | yes | Variadic. Restricts the **built-in** set: `"Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch"` → exactly those 8 (+ MCP tools). Drops `Task`, `Skill`, `Cron*`, `SendMessage`, etc. `Glob`/`Grep` exist even though the default list omits them. | E3 |
| `--setting-sources ""` | yes | Loads no user/project/local settings: `skills: []`, `plugins: []`, `slash_commands: []` (with `--disable-slash-commands`). | E3 |
| `--disable-slash-commands` | yes | Removes bundled skills too (`skills: []`, `slash_commands: []`, no `Skill` tool). | E3 |
| `--safe-mode` | yes | Removes user skills/agents/hooks **and also ignores an explicit `--mcp-config`** (`mcp_servers: []`). Not usable for Quintet. | E3 |
| `--bare` | not tested | Help text: OAuth/keychain never read, API key only → incompatible with the subscription. Not usable. | — |
| `--restricted` | yes | Compatible with `--mcp-config`, `--tools` incl. `Bash`, and `--allowedTools`. Write outside cwd → denied with `decision_reason_type: "other"`, message `<path> is outside <cwd>`. | E3f, E9g |
| `--session-id <uuid>` | yes | Pre-assigns the session id; `result.session_id` echoes it. | E8 |
| `--resume <session_id>` | yes | Continues the conversation (§5). | E8 |
| `--add-dir <dir>` | yes | Not required for `Edit(//abs)` on a parent-dir file; useful with `--restricted`. | E9d |

**Gotcha (E3):** `--tools`, `--allowedTools`, `--disallowedTools`, `--mcp-config` are variadic and swallow a trailing positional prompt → `Error: Input must be provided either through stdin or as a prompt argument`. **Quintet always sends the task on stdin.**

**Gotcha (E1):** a `claude` child inherits `CLAUDE_CODE_SESSION_ID` (and the messaging socket, remote-session plumbing) from a parent Claude Code process and then reports the parent's session id. The runner scrubs every `CLAUDECODE`, `CLAUDE_*` and `SESSION_INGRESS*` variable and passes its own `--session-id`.

## 3. Isolation from user-level settings

Positive control (default flags, this container): `skills: 19` (incl. user-level `session-start-hook`), `agents: 5` (incl. user-level `statusline-setup`), `slash_commands: 51`, `tools: 30`. With `CLAUDE_CODE_SYNC_SKILLS` etc. still in the env the count was 47 skills.

| Combination | skills | plugins | slash | MCP `quintet` | Verdict |
|---|---|---|---|---|---|
| `--safe-mode` | 18 (bundled only) | 0 | 50 | **not loaded** | ✗ kills MCP |
| `--safe-mode --disable-slash-commands` | 0 | 0 | 0 | not loaded | ✗ |
| `--setting-sources "" --disable-slash-commands --strict-mcp-config --mcp-config X --tools "Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch"` | **0** | **0** | **0** | **connected** | ✅ **chosen** |
| + `--restricted` | 0 | 0 | 0 | connected | ✅ optional add-on: confines file tools to cwd + `--add-dir` |

`init.agents` still lists `['claude','Explore','general-purpose','Plan','statusline-setup']` under the chosen combination, but the `Task` tool is not in `init.tools`, so no sub-agent can be launched. No hook events were observed under the chosen combination. Decision: `docs/decisions/0001-isolation-flags.md`.

**Verify on Maxwell's Mac:** the same combination against his `~/.claude` (50+ skills, Keychain OAuth), and that `CLAUDE_CONFIG_DIR` is *not* needed.

## 4. Event shapes (verbatim, trimmed)

All events carry `session_id` and `uuid`. Unknown types **must** be tolerated: `rate_limit_event`, `active_goal`, `autocompact_state`, `system/thinking_tokens`, `system/commands_changed`, `system/post_turn_summary`, `system/background_tasks_changed`, `system/task_started`, `system/task_updated`, `system/task_notification` were all seen.

### `system/init`
```json
{"type":"system","subtype":"init","cwd":"/HOME/Quintet/agents/test/workspace","session_id":"9cf47c0a-…",
 "tools":["Bash","Edit","Glob","Grep","Read","WebFetch","WebSearch","Write","mcp__quintet__ping"],
 "mcp_servers":[{"name":"quintet","status":"connected"}],
 "model":"claude-haiku-4-5-20251001","permissionMode":"default","slash_commands":[],"apiKeySource":"none",
 "claude_code_version":"2.1.268","output_style":"default","agents":["claude","Explore","general-purpose","Plan","statusline-setup"],
 "skills":[],"plugins":[],"capabilities":{…},"fast_mode_state":…,"messaging_socket_path":…,"uuid":"…"}
```
Failed server: `"mcp_servers":[{"name":"quintet","status":"failed"}]` and **no** `mcp_server_errors` key; the run continues without the tools.

### `assistant`
```json
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_…","type":"message","role":"assistant",
 "content":[{"type":"thinking","thinking":"","signature":"…"}],"usage":{…}},"parent_tool_use_id":null,"session_id":"…","uuid":"…"}
{"type":"assistant","message":{…,"content":[{"type":"tool_use","id":"toolu_01C8…","name":"mcp__quintet__ping","input":{},"caller":{"type":"direct"}}]},…}
{"type":"assistant","message":{…,"content":[{"type":"text","text":"The ping tool replied: pong"}]},…}
```
One event per content block. `thinking` blocks are usually empty strings with a signature.

### `user` (tool results)
```json
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01C8…","type":"tool_result","content":[{"type":"text","text":"pong"}]}]},"parent_tool_use_id":null,"session_id":"…","uuid":"…"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Permission to use Bash with command curl -sI https://example.com has been denied.","is_error":true,"tool_use_id":"toolu_01Rx…"}]},…}
```
`content` is either a string or an array of `{type:"text", text}`. `is_error` is present only on failures.

### `system/permission_denied`
```json
{"type":"system","subtype":"permission_denied","tool_name":"Bash","tool_use_id":"toolu_01Rx…",
 "decision_reason_type":"subcommandResults","message":"Permission to use Bash with command curl -sI https://example.com has been denied.","uuid":"…","session_id":"…"}
```
`decision_reason_type` seen: `subcommandResults` (denylist match), `asyncAgent` (no approval surface), `other` (`--restricted` path confinement).

### `result`
```json
{"type":"result","subtype":"success","is_error":false,"duration_ms":2300,"duration_api_ms":1900,"num_turns":2,
 "result":"The ping tool replied: pong","stop_reason":"end_turn","session_id":"9cf47c0a-…","total_cost_usd":0.0047532,
 "usage":{"input_tokens":18,"cache_creation_input_tokens":173,"cache_read_input_tokens":28052,"output_tokens":124,
          "output_tokens_details":{"thinking_tokens":66},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard",…},
 "modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":922,"outputTokens":136,"cacheReadInputTokens":28052,"cacheCreationInputTokens":173,"webSearchRequests":0,"costUSD":0.0047532,"contextWindow":200000,…}},
 "permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_…","tool_input":{"command":"curl …","description":"…"}}],
 "uuid":"…"}
```
Subtypes seen: `success`, `error_max_turns` (`is_error: true`, `result: null`), `error_during_execution` (after SIGINT, `is_error: true`). Other keys: `api_error_status`, `terminal_reason`, `ttft_ms`, `first_content_frame_ms`, `subagent_stats`, `fast_mode_state`.

### `rate_limit_event` (top level, every run)
```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1789104000,"rateLimitType":"five_hour",
 "utilization":0.91,"isUsingOverage":false,"surpassedThreshold":0.9,
 "unifiedWindows":{"five_hour":{"utilization":0.91,"resetsAt":1789104000},"seven_day":{"utilization":0.3,"resetsAt":1789567200}}},…}
```
`status` was `allowed` below 90 % and `allowed_warning` above. This is the usage meter and the usage-limit early warning.

## 5. Resume semantics

- `--session-id <uuid>` on the first run, `--resume <uuid>` later. `result.session_id` stays the same across resumes.
- The conversation carries over (a code word stated in run 1 was recalled in run 2).
- **The system prompt is snapshotted on the first request.** A different `--append-system-prompt` on `--resume` is ignored (`--system-prompt-snapshot` defaults to `on`). Consequence: Run context (date, integrity level) is frozen per session; agents call `now()` for the current time.
- Resume works after `error_max_turns` and after a SIGINT-interrupted turn; after SIGTERM the partial turn is lost but the session still resumes.
- Transcript: `~/.claude/projects/<cwd with "/" replaced by "-">/<session_id>.jsonl` plus a `memory/` folder next to it.

## 6. Permission rules for integrity (E9)

| Setup (cwd = `agent/workspace`) | Edit memory | Write deliverable | Verdict |
|---|---|---|---|
| plain `./memory.md`, `--allowedTools "Edit(./memory.md)" Read` | ✅ | ✗ denied | works |
| `./memory.md` → symlink to `../memory.md`, same rule | ✗ denied | ✗ | **symlinks break the rule** |
| memory at `../memory.md`, rule `Edit(//<abs>/agent/memory.md)` | ✅ | ✗ | **chosen** (no symlink, no `--add-dir` needed) |
| same + `--add-dir <agent dir>` | ✅ | ✗ | also works |
| rule `Write(./memory.md)` | ✗ | ✗ | `Write(path)` rules are never consulted |
| `Bash(echo *)` allowed, `echo hello > ./deliverable.md` | — | ✗ denied | redirect targets are checked against Edit rules |
| `--restricted --permission-mode acceptEdits`, write to `/elsewhere` | — | ✗ `is outside <cwd>` | confinement layer for §11 |

Integrity level ≤ 1 command shape: `--permission-mode default --permission-prompts none --allowedTools "Edit(//<abs>/agents/<id>/memory.md)" Read WebSearch WebFetch "mcp__quintet__*" …` (no bare `Write`/`Edit`). Level ≥ 2: `--permission-mode acceptEdits` with the agent's own list. Decision: `docs/decisions/0004-file-permission-rules.md`.

## 7. Failure detection

| Condition | Signal |
|---|---|
| Not logged in | `claude auth status` prints JSON; check `loggedIn`. **Unverified here** (this container injects auth even with an empty `HOME`/`CLAUDE_CONFIG_DIR`). Verify the `false` case and the `-p` error text on the Mac. |
| Usage limit approaching | `rate_limit_event.rate_limit_info.status == "allowed_warning"`, `utilization ≥ 0.9`. |
| Usage limit reached | Not inducible. Expect `rate_limit_event.status` other than `allowed*` and/or `result.is_error` with a message; binary contains the strings `Usage limit reached`, `You're out of usage credits`, `org's monthly usage limit`. Match those substrings in `result.result`/stderr as a fallback. |
| MCP server failed to start | `init.mcp_servers[].status != "connected"` → fail the run immediately with a clear reason. |
| Turn limit | `result.subtype == "error_max_turns"`. |
| Cancelled / killed | SIGINT: exit 0 within ~1 s, `result.subtype == "error_during_execution"`. SIGTERM: exit 143, **no result event**. SIGKILL: exit 137. Process may have background children (`system/task_started`) → kill the whole process group. |
| Crash without result | Non-zero exit and no `result` line → `failed` with the stderr tail. |

## 8. Command template v1 (implemented by `crates/quintet-core/src/runs/cmd.rs`)

```bash
# cwd = ~/Quintet/agents/<id>/workspace ; env scrubbed of CLAUDE*/SESSION_INGRESS* ; task text on stdin
claude -p \
  --output-format stream-json --verbose \
  --session-id <uuid-v4>                       # or: --resume <session_id>
  --model <opus|sonnet|haiku> \
  --max-turns <agent.max_turns> \
  --max-budget-usd <settings.max_budget_usd> \
  --append-system-prompt-file ~/Quintet/logs/runs/<run_id>.system.md \
  --setting-sources "" --disable-slash-commands \
  --strict-mcp-config --mcp-config ~/Quintet/logs/runs/<run_id>.mcp.json \
  --tools "Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch" \
  --permission-mode acceptEdits                # level ≤1: default + --permission-prompts none
  --permission-prompts none \
  --allowedTools <agent.allowed_tools…> "mcp__quintet__*" \
  --disallowedTools "Bash(curl *)" "Bash(wget *)" "Bash(git push *)" "Bash(rm -rf *)" "mcp__*__send_*" "mcp__*__delete_*" "mcp__*__create_*" "NotebookEdit"
```

## 9. Open questions for the Mac

1. `--setting-sources ""` against a real `~/.claude` with 50+ skills and plugins: confirm `skills: []`, `plugins: []`.
2. `claude auth status` output when logged out, and the `-p` error text.
3. Whether the Keychain-backed OAuth needs `HOME` intact (the runner keeps `HOME`; it only strips `CLAUDE*`).
4. `--restricted` + `--add-dir ~/Quintet` as the §11 confinement (works here; confirm no interference with `uv run` / `python3`).
