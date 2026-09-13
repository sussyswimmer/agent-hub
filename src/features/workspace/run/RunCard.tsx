import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { useStore } from "@/app/store";
import { IntegrityPill } from "@/features/workspace/IntegrityPill";
import type { RunRow, RunStatus } from "@/lib/types";

import { QuestionForm } from "./QuestionForm";
import { ResultCard } from "./ResultCard";
import { ToolStepRow } from "./ToolStepRow";

const STATUS: Record<RunStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-input text-secondary" },
  running: { label: "Running", cls: "bg-sys-green/15 text-sys-green" },
  waiting_user: { label: "Needs you", cls: "bg-sys-blue/15 text-sys-blue" },
  awaiting_approval: { label: "Approval", cls: "bg-sys-orange/15 text-sys-orange" },
  done: { label: "Done", cls: "bg-input text-secondary" },
  failed: { label: "Failed", cls: "bg-sys-red/15 text-sys-red" },
  stale: { label: "Stale", cls: "bg-input text-secondary" },
};

function fmtCost(c: number | null) { return c === null ? "" : `$${c.toFixed(c < 0.01 ? 4 : 2)}`; }
function fmtDuration(a: string | null, b: string | null) {
  if (!a) return "";
  const ms = (b ? Date.parse(b) : Date.now()) - Date.parse(a);
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function RunCard({ run, defaultOpen }: { run: RunRow; defaultOpen?: boolean }) {
  const { state, dispatch, backend, loadRows } = useStore();
  const rows = state.rows[run.id] ?? [];
  const live = run.status === "running" || run.status === "queued";
  const [open, setOpen] = useState(defaultOpen ?? live);

  useEffect(() => { if (open && !state.rows[run.id]) void loadRows(run.id); }, [open, run.id, state.rows, loadRows]);
  useEffect(() => {
    if (!backend || !live) return;
    return backend.onRunEvent(run.id, (row) => dispatch({ type: "row", runId: run.id, value: row }));
  }, [backend, live, run.id, dispatch]);

  const s = STATUS[run.status];
  const steps = rows.filter((r) => r.kind !== "result");
  const cancel = async () => { try { await backend?.cancelRun(run.id); } catch (e) { dispatch({ type: "error", value: String(e) }); } };

  return (
    <article className="fade-in rounded-lg border border-card-border bg-card p-3 shadow-sm" data-testid="run-card" data-run-id={run.id} data-status={run.status}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 text-xs font-medium leading-[18px] ${s.cls}`}>{s.label}</span>
        <IntegrityPill level={run.integrity_level} />
        <span className="truncate text-base font-medium">{run.task_title}</span>
        <span className="ml-auto shrink-0 text-xs text-secondary">
          {run.trigger !== "manual" && <span className="mr-2">{run.trigger}</span>}
          {fmtDuration(run.started_at, run.ended_at)}{run.turns !== null ? ` · ${run.turns} turn${run.turns === 1 ? "" : "s"}` : ""}{run.cost_usd !== null ? ` · ${fmtCost(run.cost_usd)}` : ""}
        </span>
        {live && <Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => void cancel()}>Cancel</Button>}
      </div>
      <div className="mt-2"><ResultCard run={run} /></div>
      {run.status === "waiting_user" && <div className="mt-2"><QuestionForm runId={run.id} /></div>}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 flex items-center gap-1 text-xs text-secondary hover:text-label" data-testid="steps-toggle">
        <ChevronRight size={12} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        {steps.length} step{steps.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-1 border-l border-separator pl-3" data-testid="steps">
          {steps.map((r, i) => r.kind === "text" ? <p key={`${r.seq}-${i}`} className="my-1 whitespace-pre-wrap text-sm selectable" data-row-kind="text">{r.label}</p> : <ToolStepRow key={`${r.seq}-${i}`} row={r} />)}
          {live && steps.length === 0 && <div className="text-sm text-secondary">Starting…</div>}
        </div>
      )}
    </article>
  );
}
