import { useEffect, useState } from "react";

import { useStore } from "@/app/store";
import type { PathsInfo } from "@/lib/types";

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-4 border-b border-separator py-2 text-sm"><span className="w-44 shrink-0 text-secondary">{k}</span><span className="selectable break-all font-mono text-xs">{v}</span></div>;
}

export function Settings() {
  const { state, backend } = useStore();
  const [paths, setPaths] = useState<PathsInfo | null>(null);
  useEffect(() => { void backend?.getPaths().then(setPaths); }, [backend]);
  const pf = state.preflight;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center border-b border-separator px-4"><h2 className="text-md font-semibold">Settings</h2></header>
      <div className="flex-1 overflow-y-auto p-4 mac-scroll" data-testid="settings">
        <h3 className="mb-1 text-sm font-semibold">Claude Code</h3>
        <Row k="Status" v={pf === null ? "checking…" : pf.ok ? "ready" : `not ready: ${pf.error ?? ""}`} />
        <Row k="Version" v={pf?.cli_version ?? "—"} />
        <Row k="Auth" v={pf ? `${pf.logged_in ? "logged in" : "logged out"}${pf.auth_method ? ` · ${pf.auth_method}` : ""}` : "—"} />
        <h3 className="mb-1 mt-6 text-sm font-semibold">Data</h3>
        <Row k="Backend" v={state.backendKind ?? "—"} />
        <Row k="Quintet folder" v={paths?.home ?? "—"} />
        <Row k="Database" v={paths?.db_file ?? "—"} />
        <Row k="Agents" v={paths?.agents ?? "—"} />
        <Row k="Outputs" v={paths?.outputs ?? "—"} />
        <Row k="Run logs" v={paths?.logs_runs ?? "—"} />
        <p className="mt-6 text-xs text-secondary">Google connection, Schoology feed, schedule toggles, notification preferences and the usage meter arrive in Phases 3, 4 and 10.</p>
      </div>
    </div>
  );
}
