import { useEffect, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { runsFor, useStore } from "@/app/store";
import { Composer } from "@/features/workspace/Composer";
import { IntakeSheet } from "@/features/workspace/intake/IntakeSheet";
import { RunCard } from "@/features/workspace/run/RunCard";
import type { AgentSummary } from "@/lib/types";

export function ChatTab({ agent, newTaskTick }: { agent: AgentSummary; newTaskTick: number }) {
  const { state, dispatch, backend } = useStore();
  const [sheet, setSheet] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  useEffect(() => { if (newTaskTick > 0) setSheet({ open: true, text: "" }); }, [newTaskTick]);
  const runs = runsFor(state, agent.id);
  const pf = state.preflight;
  const disabled = agent.error !== null || (pf !== null && !pf.ok);
  const reason = agent.error ? "Fix agent.md to run this agent" : pf && !pf.ok ? "Claude Code is not ready" : undefined;

  // Quick path: a task typed into Chat skips intake unless a required field cannot be inferred.
  const onRun = async (text: string) => {
    if (!backend) return;
    try {
      const form = await backend.evaluateIntake(agent.id, text, {});
      if (form.can_start) {
        await backend.startTask({ agent_id: agent.id, task_text: text, answers: {}, trigger: null });
        dispatch({ type: "error", value: null });
      } else {
        setSheet({ open: true, text });
      }
    } catch (e) {
      dispatch({ type: "error", value: String(e) });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4 mac-scroll" data-testid="chat-runs">
        {runs.length === 0 ? <EmptyState title={`No runs yet for ${agent.name}`} hint="Describe a task below. The run streams here as it works." /> : runs.map((r, i) => <RunCard key={r.id} run={r} defaultOpen={i === 0} />)}
      </div>
      <Composer disabled={disabled} disabledReason={reason} focusTick={state.composerFocusTick} onRun={onRun} />
      <IntakeSheet agent={agent} open={sheet.open} initialText={sheet.text} onClose={() => setSheet({ open: false, text: "" })} />
    </div>
  );
}
