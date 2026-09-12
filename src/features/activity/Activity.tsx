import { EmptyState } from "@/components/EmptyState";
import { useStore } from "@/app/store";
import type { RunRow } from "@/lib/types";

function dur(r: RunRow) {
  if (!r.started_at) return "—";
  const ms = (r.ended_at ? Date.parse(r.ended_at) : Date.now()) - Date.parse(r.started_at);
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function Activity() {
  const { state, dispatch } = useStore();
  const runs = Object.values(state.runs).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const name = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id;
  const total = runs.reduce((n, r) => n + (r.cost_usd ?? 0), 0);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-separator px-4"><h2 className="text-md font-semibold">Activity</h2><span className="ml-auto text-xs text-secondary">{runs.length} runs · ${total.toFixed(2)} total</span></header>
      {runs.length === 0 ? <EmptyState title="No runs yet" /> : (
        <div className="flex-1 overflow-y-auto mac-scroll">
          <table className="w-full text-sm" data-testid="activity-table">
            <thead className="sticky top-0 bg-surface text-left text-xs text-secondary"><tr><th className="px-4 py-2 font-medium">When</th><th className="py-2 font-medium">Agent</th><th className="py-2 font-medium">Task</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Duration</th><th className="py-2 font-medium">Turns</th><th className="py-2 pr-4 font-medium text-right">Cost</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="cursor-default border-t border-separator hover:bg-input" onClick={() => dispatch({ type: "view", value: { kind: "agent", id: r.agent_id } })} data-activity-run={r.id} title={r.log_path ?? undefined}>
                  <td className="px-4 py-1.5 text-secondary">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-1.5">{name(r.agent_id)}</td>
                  <td className="max-w-[360px] truncate py-1.5">{r.task_title}</td>
                  <td className={`py-1.5 ${r.status === "failed" ? "text-sys-red" : ""}`}>{r.status.replace("_", " ")}{r.error ? ` · ${r.error}` : ""}</td>
                  <td className="py-1.5 text-secondary">{dur(r)}</td>
                  <td className="py-1.5 text-secondary">{r.turns ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right text-secondary">{r.cost_usd === null ? "—" : `$${r.cost_usd.toFixed(3)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
