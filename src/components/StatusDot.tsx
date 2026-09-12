import type { AgentRunState } from "@/lib/types";

const CLS: Record<AgentRunState, string> = {
  idle: "bg-tertiary",
  running: "bg-sys-green pulse",
  waiting: "bg-sys-orange",
  error: "bg-sys-red",
};

export function StatusDot({ state, title }: { state: AgentRunState; title?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${CLS[state]}`} title={title ?? state} data-state={state} aria-label={title ?? state} />;
}
