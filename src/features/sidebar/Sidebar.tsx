import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { modLabel } from "@/app/keyboard";
import { useStore } from "@/app/store";
import type { View } from "@/lib/types";

import { AgentRow } from "./AgentRow";

function NavRow({ icon, label, active, badge, shortcut, onClick, testId }: { icon: string; label: string; active: boolean; badge?: number; shortcut?: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} data-nav={testId} title={shortcut} className={`flex h-7 w-full items-center gap-2 rounded-mac px-2 text-left text-base transition-colors duration-150 ${active ? "bg-selection" : "hover:bg-input"}`}>
      <Icon name={icon} size={15} className="text-secondary" />
      <span>{label}</span>
      {badge !== undefined && <Badge count={badge} tone="accent" />}
    </button>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const setView = (v: View) => dispatch({ type: "view", value: v });
  const is = (k: View["kind"]) => state.view.kind === k;
  const pending = state.agents.reduce((n, a) => n + a.badge, 0);
  const valid = state.agents.filter((a) => !a.error);
  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-sidebar pt-9" data-testid="sidebar">
      <div className="px-2">
        <NavRow icon="tray" label="Approvals" active={is("approvals")} badge={pending} shortcut={`${modLabel}0`} onClick={() => setView({ kind: "approvals" })} testId="approvals" />
        <NavRow icon="clock" label="Activity" active={is("activity")} onClick={() => setView({ kind: "activity" })} testId="activity" />
      </div>
      <div className="mt-4 px-4 text-xs font-semibold uppercase tracking-wide text-tertiary">Agents</div>
      <div className="mt-1 flex-1 overflow-y-auto px-2 mac-scroll" data-testid="agent-list">
        {state.agents.map((a) => {
          const idx = valid.findIndex((v) => v.id === a.id);
          return <AgentRow key={a.id} agent={a} selected={state.view.kind === "agent" && state.view.id === a.id} shortcut={idx >= 0 && idx < 5 ? `${modLabel}${idx + 1}` : undefined} onSelect={() => setView({ kind: "agent", id: a.id })} />;
        })}
        {state.ready && state.agents.length === 0 && <div className="px-2 py-3 text-sm text-secondary">No agents in ~/Quintet/agents.</div>}
      </div>
      <div className="border-t border-separator px-2 py-2">
        <NavRow icon="gear" label="Settings" active={is("settings")} shortcut={`${modLabel},`} onClick={() => setView({ kind: "settings" })} testId="settings" />
      </div>
    </aside>
  );
}
