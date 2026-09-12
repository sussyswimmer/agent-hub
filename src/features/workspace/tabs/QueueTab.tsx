import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { runsFor, useStore } from "@/app/store";
import type { AgentDetail, AgentSummary, RunRow } from "@/lib/types";

function Row({ run, onCancel }: { run: RunRow; onCancel: () => void }) {
  const live = run.status === "running" || run.status === "queued";
  return (
    <div className="flex items-center gap-3 border-b border-separator py-1.5 text-sm" data-queue-run={run.id}>
      <span className="w-24 shrink-0 text-secondary">{run.status.replace("_", " ")}</span>
      <span className="truncate">{run.task_title}</span>
      <span className="ml-auto shrink-0 text-xs text-secondary">{new Date(run.created_at).toLocaleString()}</span>
      {live && <Button variant="ghost" className="h-6 px-2 text-xs" onClick={onCancel}>Cancel</Button>}
    </div>
  );
}

export function QueueTab({ agent }: { agent: AgentSummary }) {
  const { state, backend, dispatch } = useStore();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  useEffect(() => { void backend?.getAgent(agent.id).then(setDetail); }, [backend, agent.id, agent.hash]);
  const runs = runsFor(state, agent.id);
  const open = runs.filter((r) => !["done", "failed", "stale"].includes(r.status));
  const schedules = detail?.def?.schedules ?? [];

  const runNow = async (name: string, task: string) => {
    if (!backend) return;
    try { await backend.startRun({ agent_id: agent.id, task_text: task, intake: {}, integrity_level: null, trigger: `scheduled:${name}` }); }
    catch (e) { dispatch({ type: "error", value: String(e) }); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 mac-scroll">
      <h3 className="mb-2 text-sm font-semibold text-secondary">Queue</h3>
      {open.length === 0 ? <div className="mb-6 text-sm text-secondary">Nothing queued or running.</div> : open.map((r) => <Row key={r.id} run={r} onCancel={() => void backend?.cancelRun(r.id)} />)}
      <h3 className="mb-2 mt-6 text-sm font-semibold text-secondary">Schedules</h3>
      {schedules.length === 0 ? <div className="text-sm text-secondary">This agent has no schedules.</div> : schedules.map((s) => (
        <div key={s.name} className="flex items-center gap-3 border-b border-separator py-1.5 text-sm" data-schedule={s.name}>
          <span className="font-medium">{s.name}</span>
          <code className="rounded bg-input px-1 text-xs">{s.cron}</code>
          <span className="truncate text-secondary">{s.task}</span>
          <span className="ml-auto shrink-0 text-xs text-secondary">{s.enabled ? "on" : "off"} · fires in Phase 4</span>
          {!s.task.startsWith("db:") && <Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => void runNow(s.name, s.task)}>Run now</Button>}
        </div>
      ))}
      <h3 className="mb-2 mt-6 text-sm font-semibold text-secondary">History</h3>
      {runs.filter((r) => ["done", "failed", "stale"].includes(r.status)).slice(0, 30).map((r) => <Row key={r.id} run={r} onCancel={() => {}} />)}
      {runs.length === 0 && <EmptyState title="No runs yet" />}
    </div>
  );
}
