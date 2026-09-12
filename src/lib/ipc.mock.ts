// In-memory backend for Playwright and browser previews. Mirrors the Rust behaviour closely enough
// for the UI: five valid agents plus one broken one, runs that stream fixture rows, and status events.
import type { Backend, Unsubscribe } from "./ipc";
import replay from "./fixtures/run-research.json";
import { shouldSkip } from "./skipIf";
import type { AgentDef, AgentDetail, AgentSummary, IntakeFieldView, IntakeForm, Preflight, RunEventRow, RunRow, RunStatus, StartRunArgs, UiRow } from "./types";

type Listener<T> = (v: T) => void;

class Emitter<T> {
  private ls = new Set<Listener<T>>();
  on(l: Listener<T>): Unsubscribe { this.ls.add(l); return () => this.ls.delete(l); }
  emit(v: T) { for (const l of this.ls) l(v); }
}

const AGENTS: AgentSummary[] = [
  { id: "research", name: "Research", icon: "magnifyingglass", color: "indigo", version: 1, mission: "Turn a research question into a verified, cited deliverable Maxwell can build on.", error: null, hash: "a", run_state: "idle", badge: 0 },
  { id: "college", name: "College", icon: "graduationcap", color: "purple", version: 1, mission: "Get Maxwell to submission day with a smart school list and essays that sound like him.", error: null, hash: "b", run_state: "idle", badge: 1 },
  { id: "scout", name: "Scout", icon: "binoculars", color: "orange", version: 1, mission: "Never miss an opportunity he is eligible for and would want.", error: null, hash: "c", run_state: "idle", badge: 2 },
  { id: "school", name: "School", icon: "calendar", color: "blue", version: 1, mission: "Keep every assignment on time without cramming.", error: null, hash: "d", run_state: "idle", badge: 0 },
  { id: "tutor", name: "Tutor", icon: "brain", color: "green", version: 1, mission: "Make Maxwell actually remember and understand his material.", error: null, hash: "e", run_state: "idle", badge: 0 },
  { id: "broken", name: "broken", icon: "exclamationmark.triangle", color: "gray", version: 0, mission: "", error: "YAML: mapping values are not allowed in this context at line 3 column 7", hash: "f", run_state: "error", badge: 0 },
];

const BASE_DEF = { version: 1, owns: [], does_not_own: [], model: "sonnet" as const, max_turns: 40, integrity: false as const, allowed_tools: ["Read", "mcp__quintet__*"], mcp_extra: [], state_snapshot: null, intake: [], schedules: [] };
const field = (f: Partial<AgentDef["intake"][number]> & { id: string; type: AgentDef["intake"][number]["type"] }): AgentDef["intake"][number] => ({ prompt: null, required: false, options: null, default: null, skip_if: null, max: null, from_chat: false, ...f });
const DEFS: Record<string, AgentDef> = {
  research: { ...BASE_DEF, id: "research", name: "Research", icon: "magnifyingglass", color: "indigo", mission: AGENTS[0]!.mission, model: "opus", max_turns: 60, integrity: "when_graded", outputs_dir: "research", board: "research_library", state_snapshot: "research_recent",
    intake: [
      field({ id: "question", type: "text", prompt: "What's the research question?", required: true, from_chat: true }),
      field({ id: "output", type: "multi", prompt: "What do you want back?", options: ["brief", "lit_review", "data_charts"], default: ["brief"] }),
      field({ id: "depth", type: "single", prompt: "How deep?", options: ["quick", "standard", "exhaustive"], default: "standard" }),
      field({ id: "citation_style", type: "single", prompt: "Citation style", options: ["APA", "Chicago", "MLA"], default: "Chicago", skip_if: "memory.default_citation_style" }),
      field({ id: "graded", type: "single", prompt: "Does this feed a graded assignment?", options: ["no", "yes"], default: "no" }),
      field({ id: "integrity", type: "integrity", prompt: "Integrity level", default: 1, max: 3, skip_if: "task.graded != 'yes'" }),
    ] },
  college: { ...BASE_DEF, id: "college", name: "College", icon: "graduationcap", color: "purple", mission: AGENTS[1]!.mission, model: "opus", integrity: true, outputs_dir: "college", board: "college_tracker",
    intake: [field({ id: "mode", type: "single", prompt: "What are we doing?", options: ["essay_coach", "tracker", "activities", "school_list"], default: "essay_coach", required: true }), field({ id: "request", type: "text", prompt: "What do you need?", required: true, from_chat: true }), field({ id: "integrity", type: "integrity", prompt: "Integrity level (essays are capped at 2)", default: 1, max: 2, skip_if: "task.mode != 'essay_coach'" })] },
  scout: { ...BASE_DEF, id: "scout", name: "Scout", icon: "binoculars", color: "orange", mission: AGENTS[2]!.mission, max_turns: 50, outputs_dir: "scout", board: "scout_opportunities",
    intake: [field({ id: "request", type: "text", prompt: "What should I look for?", required: true, from_chat: true })],
    schedules: [
      { name: "weekly-sweep", cron: "0 7 * * 1", tz: "Asia/Saigon", task: "Run the weekly sweep across all four categories and write the digest.", model: "sonnet", enabled: true },
      { name: "deadline-watch", cron: "30 7 * * *", tz: "Asia/Saigon", task: "db:deadline_watch", model: null, enabled: true },
    ] },
  school: { ...BASE_DEF, id: "school", name: "School", icon: "calendar", color: "blue", mission: AGENTS[3]!.mission, integrity: true, outputs_dir: "school", board: "school_planner" },
  tutor: { ...BASE_DEF, id: "tutor", name: "Tutor", icon: "brain", color: "green", mission: AGENTS[4]!.mission, integrity: true, outputs_dir: "tutor", board: "tutor_review" },
};

const MOCK_MEMORY: Record<string, Record<string, unknown>> = { research: {}, college: {}, scout: {}, school: {}, tutor: {} };
const MOCK_PROFILE = { class_of: 2028, timezone: "Asia/Saigon" };

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Same rules as crates/quintet-core/src/intake.rs. */
function evaluateIntake(def: AgentDef, taskText: string, partial: Record<string, unknown>): IntakeForm {
  const prefill = (f: AgentDef["intake"][number]): unknown => {
    if (!isEmpty(partial[f.id])) return partial[f.id];
    if (f.type === "text" && f.from_chat && taskText.trim()) return taskText.trim();
    return isEmpty(f.default) ? null : f.default;
  };
  const task: Record<string, unknown> = { text: taskText };
  for (const f of def.intake) { const v = prefill(f); if (v !== null) task[f.id] = v; }
  Object.assign(task, partial);
  const ctx = { memory: MOCK_MEMORY[def.id] ?? {}, profile: MOCK_PROFILE, task };
  const fields: IntakeFieldView[] = def.intake.map((f) => {
    const skipped = f.skip_if ? shouldSkip(f.skip_if, ctx) : false;
    let p = prefill(f);
    if (f.type === "integrity" && p !== null) p = Math.min(Number(p), f.max ?? 3);
    const satisfied = skipped || !f.required || !isEmpty(p);
    return { field: f, skipped, prefill: p, satisfied };
  });
  const missing = fields.filter((v) => !v.satisfied).map((v) => v.field.id);
  return { agent_id: def.id, fields, can_start: missing.length === 0, missing };
}

let ulidCounter = 0;
const ulid = () => `01MOCK${String(++ulidCounter).padStart(6, "0")}`;
const now = () => new Date().toISOString();

export function createMockBackend(): Backend {
  const agents = structuredClone(AGENTS);
  const runs = new Map<string, RunRow>();
  const rows = new Map<string, UiRow[]>();
  const runEvents = new Emitter<{ runId: string; row: UiRow }>();
  const statusEvents = new Emitter<RunRow>();
  const registryEvents = new Emitter<AgentSummary[]>();
  const preflightEvents = new Emitter<Preflight>();
  const settings = new Map<string, string>();
  const pf: Preflight = { ok: true, cli_version: "2.1.268 (Claude Code)", logged_in: true, auth_method: "oauth_token", error: null };

  // One finished run so Activity and Chat have history on first paint.
  const seed: RunRow = {
    id: ulid(), agent_id: "research", trigger: "manual", status: "done", session_id: "s-seed", integrity_level: null, intake_json: null,
    task_title: "Compare Basel III and Basel IV capital rules", started_at: "2026-09-11T02:10:00.000Z", ended_at: "2026-09-11T02:14:30.000Z",
    cost_usd: 0.61, tokens_in: 48000, tokens_out: 3900, turns: 12, error: null,
    summary: "Produced brief.md with 11 sources (8 grade A). Proposed a Drive doc. Open question: treatment of output floors after 2028.",
    pid: null, log_path: "/HOME/Quintet/logs/runs/seed.jsonl", output_dir: "/HOME/Quintet/outputs/research/2026-09-11-compare-basel-iii-and-basel", created_at: "2026-09-11T02:09:58.000Z", updated_at: "2026-09-11T02:14:30.000Z",
  };
  runs.set(seed.id, seed);
  rows.set(seed.id, (replay as unknown as UiRow[]).map((r) => ({ ...r, ts: seed.started_at ?? "" })));

  const setStatus = (id: string, patch: Partial<RunRow>) => {
    const r = runs.get(id);
    if (!r) return;
    const next = { ...r, ...patch, updated_at: now() };
    runs.set(id, next);
    const a = agents.find((x) => x.id === next.agent_id);
    if (a) a.run_state = next.status === "running" || next.status === "queued" ? "running" : next.status === "waiting_user" || next.status === "awaiting_approval" ? "waiting" : "idle";
    statusEvents.emit(next);
  };

  const stream = (id: string) => {
    const seq: UiRow[] = (replay as unknown as UiRow[]).map((r) => ({ ...r, ts: now() }));
    rows.set(id, []);
    let i = 0;
    const tick = () => {
      const row = seq[i++];
      if (!row) {
        const last = rows.get(id)?.at(-1);
        setStatus(id, { status: "done", ended_at: now(), cost_usd: 0.412, turns: 9, tokens_in: 31000, tokens_out: 2100, summary: last?.detail ?? null, pid: null });
        return;
      }
      rows.get(id)?.push(row);
      runEvents.emit({ runId: id, row });
      setTimeout(tick, row.kind === "tool" && row.state === "running" ? 350 : 150);
    };
    setTimeout(tick, 200);
  };

  const api: Backend = {
    kind: "mock",
    preflight: async () => pf,
    listAgents: async () => structuredClone(agents),
    getAgent: async (id) => {
      const summary = agents.find((a) => a.id === id);
      if (!summary) return null;
      const detail: AgentDetail = { summary, def: DEFS[id] ?? null, body: `# Role\n\nYou are ${summary.name}.`, memory: "---\n---\n# Memory\n", path: `/HOME/Quintet/agents/${id}/agent.md` };
      return detail;
    },
    evaluateIntake: async (agentId, taskText, partial) => {
      const def = DEFS[agentId];
      if (!def) throw new Error(`agent \`${agentId}\` not found`);
      return evaluateIntake(def, taskText, partial);
    },
    startTask: async (args) => {
      const def = DEFS[args.agent_id];
      if (!def) throw new Error(`agent \`${args.agent_id}\` not found`);
      const form = evaluateIntake(def, args.task_text, args.answers);
      const intake: Record<string, unknown> = {};
      let integrity: number | null = null;
      for (const v of form.fields) { if (v.skipped || v.prefill === null) continue; intake[v.field.id] = v.prefill; if (v.field.type === "integrity") integrity = Number(v.prefill); }
      const startArgs: StartRunArgs = { agent_id: args.agent_id, task_text: args.task_text, intake, integrity_level: integrity, trigger: args.trigger ?? null };
      return api.startRun(startArgs);
    },
    startRun: async (args) => {
      const a = agents.find((x) => x.id === args.agent_id);
      if (!a) throw new Error(`agent \`${args.agent_id}\` not found`);
      if (a.error) throw new Error(`agent \`${args.agent_id}\` is not valid: ${a.error}`);
      const id = ulid();
      const run: RunRow = {
        id, agent_id: args.agent_id, trigger: args.trigger ?? "manual", status: "queued", session_id: `s-${id}`, integrity_level: args.integrity_level ?? null,
        intake_json: Object.keys(args.intake).length ? JSON.stringify(args.intake) : null, task_title: args.task_text.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "Untitled task",
        started_at: null, ended_at: null, cost_usd: null, tokens_in: null, tokens_out: null, turns: null, error: null, summary: null, pid: null, log_path: `/HOME/Quintet/logs/runs/${id}.jsonl`,
        output_dir: `/HOME/Quintet/outputs/${args.agent_id}/2026-09-12-mock`, created_at: now(), updated_at: now(),
      };
      runs.set(id, run);
      statusEvents.emit(run);
      setTimeout(() => { setStatus(id, { status: "running", started_at: now(), pid: 4242 }); stream(id); }, 120);
      return run;
    },
    cancelRun: async (id) => { setStatus(id, { status: "failed", error: "cancelled by user", ended_at: now(), pid: null }); },
    listRuns: async (q = {}) => [...runs.values()].filter((r) => (!q.agentId || r.agent_id === q.agentId) && (!q.status || r.status === (q.status as RunStatus))).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, q.limit ?? 100),
    getRun: async (id) => runs.get(id) ?? null,
    getRunEvents: async (id): Promise<RunEventRow[]> => (rows.get(id) ?? []).map((r) => ({ seq: r.seq, type: r.kind, json: JSON.stringify(r), created_at: r.ts })),
    getRunRows: async (id) => structuredClone(rows.get(id) ?? []),
    getPaths: async () => ({ home: "/HOME/Quintet", db_file: "/HOME/Quintet/data/quintet.db", agents: "/HOME/Quintet/agents", outputs: "/HOME/Quintet/outputs", logs_runs: "/HOME/Quintet/logs/runs" }),
    getSettings: async () => Object.fromEntries(settings),
    setSetting: async (k, v) => { settings.set(k, v); },
    readTextFile: async (path) => `# ${path.split("/").pop()}\n\n(mock file contents)\n`,
    onRunEvent: (runId, cb) => runEvents.on((e) => { if (e.runId === runId) cb(e.row); }),
    onRunStatus: (cb) => statusEvents.on(cb),
    onRegistryChanged: (cb) => registryEvents.on(cb),
    onPreflight: (cb) => { setTimeout(() => cb(pf), 50); return preflightEvents.on(cb); },
  };
  return api;
}
