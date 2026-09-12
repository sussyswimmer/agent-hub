import { Button } from "@/components/Button";
import { colorClass, Icon } from "@/components/Icon";
import { StatusDot } from "@/components/StatusDot";
import { modLabel } from "@/app/keyboard";
import type { AgentSummary } from "@/lib/types";

const STATE_LABEL = { idle: "idle", running: "running", waiting: "waiting for you", error: "invalid agent.md" } as const;

export function Header({ agent, onNewTask }: { agent: AgentSummary; onNewTask: () => void }) {
  const broken = agent.error !== null;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-separator px-4" data-testid="workspace-header">
      <Icon name={agent.icon} size={20} className={broken ? "text-sys-red" : colorClass(agent.color)} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-md font-semibold leading-tight">
          <span>{agent.name}</span>
          <span className="flex items-center gap-1 text-sm font-normal text-secondary"><StatusDot state={agent.run_state} /> {STATE_LABEL[agent.run_state]}</span>
        </div>
        <div className="truncate text-xs text-secondary">{broken ? agent.error : agent.mission}</div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="primary" onClick={onNewTask} disabled={broken} title={`${modLabel}N`}>New task</Button>
      </div>
    </header>
  );
}
