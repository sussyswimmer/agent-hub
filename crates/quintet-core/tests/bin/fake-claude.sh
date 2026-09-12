#!/usr/bin/env bash
# Fake `claude` for RunManager tests. Behaviour is driven by environment variables:
#   FAKE_CLAUDE_FIXTURE          jsonl replayed line by line on stdout
#   FAKE_CLAUDE_RESUME_FIXTURE   used instead when argv contains --resume
#   FAKE_CLAUDE_DELAY_MS         pause between lines (default 0)
#   FAKE_CLAUDE_SLEEP            seconds to sleep before replaying (kill tests)
#   FAKE_CLAUDE_EXIT             exit code after replay (default 0)
#   FAKE_CLAUDE_ARGS_FILE        argv is written here, one per line
#   FAKE_CLAUDE_STDIN_FILE       stdin is copied here
#   FAKE_CLAUDE_ENV_FILE         environment is dumped here
# SIGINT mimics the real CLI: emit an error_during_execution result and exit 0.
set -u
if [ "${1:-}" = "--version" ]; then echo "9.9.9 (fake)"; exit 0; fi
if [ "${1:-}" = "auth" ]; then echo '{"loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty"}'; exit 0; fi
if [ -n "${FAKE_CLAUDE_ARGS_FILE:-}" ]; then printf '%s\n' "$@" > "$FAKE_CLAUDE_ARGS_FILE"; fi
if [ -n "${FAKE_CLAUDE_ENV_FILE:-}" ]; then env | sort > "$FAKE_CLAUDE_ENV_FILE"; fi
if [ ! -t 0 ]; then
  if [ -n "${FAKE_CLAUDE_STDIN_FILE:-}" ]; then cat > "$FAKE_CLAUDE_STDIN_FILE"; else cat > /dev/null; fi
fi

on_int() {
  printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":1,"total_cost_usd":0.001,"session_id":"fake","result":null,"usage":{"input_tokens":1,"output_tokens":1}}'
  exit 0
}
trap on_int INT

fixture="${FAKE_CLAUDE_FIXTURE:-}"
for a in "$@"; do if [ "$a" = "--resume" ] && [ -n "${FAKE_CLAUDE_RESUME_FIXTURE:-}" ]; then fixture="$FAKE_CLAUDE_RESUME_FIXTURE"; fi; done

if [ -n "${FAKE_CLAUDE_SLEEP:-}" ]; then
  # Emit an init line first so the run is clearly "running", then idle (interruptible).
  printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake","model":"fake-model","tools":["Read"],"mcp_servers":[{"name":"quintet","status":"connected"}],"skills":[],"plugins":[],"agents":[]}'
  sleep "$FAKE_CLAUDE_SLEEP" &
  wait $!
fi

if [ -n "$fixture" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    printf '%s\n' "$line"
    if [ "${FAKE_CLAUDE_DELAY_MS:-0}" != "0" ]; then sleep "$(awk "BEGIN{print ${FAKE_CLAUDE_DELAY_MS}/1000}")"; fi
  done < "$fixture"
fi
if [ -n "${FAKE_CLAUDE_STDERR:-}" ]; then echo "$FAKE_CLAUDE_STDERR" >&2; fi
exit "${FAKE_CLAUDE_EXIT:-0}"
