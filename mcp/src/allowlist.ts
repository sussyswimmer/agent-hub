// Which agents may call which tools (CLAUDE.md §6.1). "all" = every agent.
export type Allowed = "all" | readonly string[];

export const TOOL_AGENTS: Record<string, Allowed> = {
  ask_user: "all",
  propose_action: "all",
  save_output: "all",
  now: "all",
  // Phase 3+: save_source/list_sources → research; calendar_* → all; gmail_* → scout, college; drive_* → all; ...
};

export function isAllowed(tool: string, agentId: string): boolean {
  const a = TOOL_AGENTS[tool];
  if (a === undefined) return false;
  return a === "all" || a.includes(agentId);
}
