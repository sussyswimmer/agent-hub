import { Markdown } from "@/components/Markdown";
import type { RunRow } from "@/lib/types";

export function ResultCard({ run }: { run: RunRow }) {
  if (run.status === "failed") {
    return <div className="rounded-mac border border-sys-red/30 bg-sys-red/8 px-3 py-2 text-sm" data-testid="result-card" data-outcome="failed"><span className="font-medium text-sys-red">Failed.</span> {run.error}</div>;
  }
  if (run.status === "waiting_user") return <div className="rounded-mac border border-sys-blue/30 bg-sys-blue/8 px-3 py-2 text-sm" data-testid="result-card" data-outcome="waiting_user">Waiting for your answers.</div>;
  if (run.status === "awaiting_approval") return <div className="rounded-mac border border-sys-orange/30 bg-sys-orange/8 px-3 py-2 text-sm" data-testid="result-card" data-outcome="awaiting_approval">Proposals are waiting in Approvals.</div>;
  if (run.status !== "done") return null;
  return (
    <div className="rounded-mac border border-card-border bg-surface-2 px-3 py-2" data-testid="result-card" data-outcome="done">
      {run.summary ? <Markdown text={run.summary} /> : <div className="text-sm text-secondary">Finished without a summary.</div>}
    </div>
  );
}
