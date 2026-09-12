import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

import type { Backend } from "./ipc";
import * as S from "./schemas";
import type { AgentSummary, Preflight, RunRow, RunStatusEvent, RunStreamEvent, UiRow } from "./types";

async function call<T>(cmd: string, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<T> {
  const raw = await invoke(cmd, args);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.error(`IPC ${cmd}: response failed validation`, parsed.error.issues, raw);
    throw new Error(`IPC ${cmd}: invalid response`);
  }
  return parsed.data;
}

function sub<T>(event: string, schema: z.ZodType<T>, cb: (payload: T) => void): () => void {
  let un: (() => void) | null = null;
  let cancelled = false;
  void listen<unknown>(event, (e) => {
    const parsed = schema.safeParse(e.payload);
    if (parsed.success) cb(parsed.data);
    else console.error(`event ${event}: payload failed validation`, parsed.error.issues);
  }).then((u) => {
    if (cancelled) u();
    else un = u;
  });
  return () => {
    cancelled = true;
    un?.();
  };
}

export function createTauriBackend(): Backend {
  return {
    kind: "tauri",
    preflight: () => call("preflight", S.preflight.nullable()),
    listAgents: () => call("list_agents", z.array(S.agentSummary)),
    getAgent: (id) => call("get_agent", S.agentDetail.nullable(), { id }),
    startRun: (args) => call("start_run", S.runRow, { args }),
    cancelRun: (id) => call("cancel_run", z.null().or(z.undefined()).transform(() => undefined), { id }),
    listRuns: (q = {}) => call("list_runs", z.array(S.runRow), { agentId: q.agentId ?? null, status: q.status ?? null, limit: q.limit ?? null }),
    getRun: (id) => call("get_run", S.runRow.nullable(), { id }),
    getRunEvents: (id, afterSeq = 0) => call("get_run_events", z.array(S.runEventRow), { id, afterSeq }),
    getRunRows: (id) => call("get_run_rows", z.array(S.uiRow), { id }),
    getPaths: () => call("get_paths", S.pathsInfo),
    getSettings: async () => Object.fromEntries(await call("get_settings", S.settingsList)),
    setSetting: (key, value) => call("set_setting", z.null().or(z.undefined()).transform(() => undefined), { key, value }),
    readTextFile: (path) => call("read_text_file", z.string(), { path }),
    onRunEvent: (runId, cb) => sub<RunStreamEvent>(`run://${runId}`, z.object({ run_id: z.string(), row: S.uiRow }), (e) => cb(e.row as UiRow)),
    onRunStatus: (cb) => sub<RunStatusEvent>("runs://status", z.object({ run: S.runRow }), (e) => cb(e.run as RunRow)),
    onRegistryChanged: (cb) => sub<AgentSummary[]>("registry://changed", z.array(S.agentSummary), cb),
    onPreflight: (cb) => sub<Preflight>("preflight://changed", S.preflight, cb),
  };
}
