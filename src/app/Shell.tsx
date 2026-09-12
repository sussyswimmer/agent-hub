import { useCallback } from "react";

import { useGlobalShortcuts } from "./keyboard";
import { useStore } from "./store";
import { Activity } from "@/features/activity/Activity";
import { Approvals } from "@/features/approvals/Approvals";
import { Settings } from "@/features/settings/Settings";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { Workspace } from "@/features/workspace/Workspace";
import type { View } from "@/lib/types";

function PreflightBanner() {
  const { state } = useStore();
  const pf = state.preflight;
  if (!pf || pf.ok) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-30 bg-sys-red px-4 py-2 text-sm text-white" data-testid="preflight-banner">
      <strong>Claude Code is not ready.</strong> {pf.error} {pf.cli_version ? ` (CLI ${pf.cli_version})` : ""}
    </div>
  );
}

export function Shell() {
  const { state, dispatch } = useStore();
  const setView = useCallback((v: View) => dispatch({ type: "view", value: v }), [dispatch]);
  const focusComposer = useCallback(() => { dispatch({ type: "newTask" }); }, [dispatch]);
  useGlobalShortcuts(state.agents, setView, focusComposer);

  let main: React.ReactNode;
  switch (state.view.kind) {
    case "approvals": main = <Approvals />; break;
    case "activity": main = <Activity />; break;
    case "settings": main = <Settings />; break;
    case "agent": {
      const id = state.view.id;
      const agent = state.agents.find((a) => a.id === id);
      main = agent ? <Workspace key={agent.id} agent={agent} /> : <div className="flex flex-1 items-center justify-center text-secondary">{state.ready ? "Select an agent" : "Loading…"}</div>;
    }
  }
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <PreflightBanner />
      <Sidebar />
      {main}
      {state.error && (
        <div role="status" className="fade-in fixed bottom-4 right-4 z-30 max-w-md rounded-lg border border-sys-red/40 bg-card px-3 py-2 text-sm shadow-lg" data-testid="error-toast">
          <span className="text-sys-red">Error:</span> {state.error}
          <button type="button" className="ml-3 text-secondary hover:text-label" onClick={() => dispatch({ type: "error", value: null })}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
