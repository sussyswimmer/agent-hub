// App state: agents, current view, runs, streamed rows, preflight. React context + reducer, no store lib.
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";

import { backend, type Backend } from "@/lib/ipc";
import type { AgentSummary, Preflight, RunRow, UiRow, View } from "@/lib/types";

export interface State {
  ready: boolean;
  backendKind: "tauri" | "mock" | null;
  preflight: Preflight | null;
  agents: AgentSummary[];
  view: View;
  runs: Record<string, RunRow>;
  rows: Record<string, UiRow[]>;
  composerFocusTick: number;
  error: string | null;
}

type Action =
  | { type: "ready"; kind: "tauri" | "mock" }
  | { type: "preflight"; value: Preflight | null }
  | { type: "agents"; value: AgentSummary[] }
  | { type: "view"; value: View }
  | { type: "runs"; value: RunRow[] }
  | { type: "run"; value: RunRow }
  | { type: "rows"; runId: string; value: UiRow[] }
  | { type: "row"; runId: string; value: UiRow }
  | { type: "focusComposer" }
  | { type: "error"; value: string | null };

const initial: State = { ready: false, backendKind: null, preflight: null, agents: [], view: { kind: "agent", id: "research" }, runs: {}, rows: {}, composerFocusTick: 0, error: null };

/** A tool_result row (empty label, same tool_use_id) updates the state of its tool_use row. */
export function mergeRow(rows: UiRow[], row: UiRow): UiRow[] {
  if (row.tool_use_id && row.label === "") {
    const i = rows.findIndex((r) => r.tool_use_id === row.tool_use_id && r.label !== "");
    if (i !== -1) {
      const next = rows.slice();
      const prev = next[i]!;
      next[i] = { ...prev, state: row.state, detail: row.detail ?? prev.detail };
      return next;
    }
    return rows;
  }
  if (rows.some((r) => r.seq === row.seq && r.label === row.label)) return rows;
  return [...rows, row];
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "ready": return { ...s, ready: true, backendKind: a.kind };
    case "preflight": return { ...s, preflight: a.value };
    case "agents": {
      const stillThere = a.value.some((x) => s.view.kind === "agent" && x.id === s.view.id);
      const view: View = s.view.kind === "agent" && !stillThere && a.value[0] ? { kind: "agent", id: a.value[0].id } : s.view;
      return { ...s, agents: a.value, view };
    }
    case "view": return { ...s, view: a.value };
    case "runs": { const runs = { ...s.runs }; for (const r of a.value) runs[r.id] = r; return { ...s, runs }; }
    case "run": return { ...s, runs: { ...s.runs, [a.value.id]: a.value } };
    case "rows": return { ...s, rows: { ...s.rows, [a.runId]: a.value } };
    case "row": return { ...s, rows: { ...s.rows, [a.runId]: mergeRow(s.rows[a.runId] ?? [], a.value) } };
    case "focusComposer": return { ...s, composerFocusTick: s.composerFocusTick + 1 };
    case "error": return { ...s, error: a.value };
  }
}

interface Ctx {
  state: State;
  dispatch: (a: Action) => void;
  backend: Backend | null;
  refreshAgents: () => Promise<void>;
  loadRuns: (agentId?: string) => Promise<void>;
  loadRows: (runId: string) => Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const be = useRef<Backend | null>(null);

  useEffect(() => {
    let unsub: Array<() => void> = [];
    let alive = true;
    (async () => {
      const b = await backend();
      if (!alive) return;
      be.current = b;
      dispatch({ type: "ready", kind: b.kind });
      const [agents, pf, runs] = await Promise.all([b.listAgents(), b.preflight(), b.listRuns({ limit: 200 })]);
      if (!alive) return;
      dispatch({ type: "agents", value: agents });
      dispatch({ type: "preflight", value: pf });
      dispatch({ type: "runs", value: runs });
      unsub = [
        b.onRunStatus((run) => { dispatch({ type: "run", value: run }); void b.listAgents().then((a) => dispatch({ type: "agents", value: a })); }),
        b.onRegistryChanged((a) => dispatch({ type: "agents", value: a })),
        b.onPreflight((p) => dispatch({ type: "preflight", value: p })),
      ];
    })().catch((e: unknown) => dispatch({ type: "error", value: String(e) }));
    return () => { alive = false; for (const u of unsub) u(); };
  }, []);

  const ctx = useMemo<Ctx>(() => ({
    state,
    dispatch,
    backend: be.current,
    refreshAgents: async () => { const b = be.current; if (b) dispatch({ type: "agents", value: await b.listAgents() }); },
    loadRuns: async (agentId) => { const b = be.current; if (b) dispatch({ type: "runs", value: await b.listRuns(agentId ? { agentId, limit: 100 } : { limit: 200 }) }); },
    loadRows: async (runId) => { const b = be.current; if (b) dispatch({ type: "rows", runId, value: await b.getRunRows(runId) }); },
  }), [state]);

  return <StoreCtx.Provider value={ctx}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}

export function runsFor(state: State, agentId: string): RunRow[] {
  return Object.values(state.runs).filter((r) => r.agent_id === agentId).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
