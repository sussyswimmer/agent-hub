import { Badge } from "@/components/Badge";
import { colorClass, Icon } from "@/components/Icon";
import { StatusDot } from "@/components/StatusDot";
import type { AgentSummary } from "@/lib/types";

export function AgentRow({ agent, selected, shortcut, onSelect }: { agent: AgentSummary; selected: boolean; shortcut?: string | undefined; onSelect: () => void }) {
  const broken = agent.error !== null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
      data-agent={agent.id}
      title={broken ? agent.error ?? "invalid agent.md" : `${agent.mission}${shortcut ? ` · ${shortcut}` : ""}`}
      className={`flex h-7 w-full items-center gap-2 rounded-mac px-2 text-left text-base transition-colors duration-150 ${selected ? "bg-selection" : "hover:bg-input"}`}
    >
      <Icon name={agent.icon} size={15} className={broken ? "text-sys-red" : colorClass(agent.color)} />
      <span className={`truncate ${broken ? "text-sys-red" : ""}`}>{agent.name}</span>
      {broken ? <span className="ml-auto rounded-full bg-sys-red px-1.5 text-xs text-white" data-error-badge>!</span> : <><StatusDot state={agent.run_state} /><Badge count={agent.badge} tone="accent" /></>}
    </button>
  );
}
