// zod validation at the IPC boundary (CLAUDE.md §14). Shapes mirror src/lib/generated.
import { z } from "zod";

export const runStatus = z.enum(["queued", "running", "waiting_user", "awaiting_approval", "done", "failed", "stale"]);
export const agentRunState = z.enum(["idle", "running", "waiting", "error"]);

export const agentSummary = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  version: z.number(),
  mission: z.string(),
  error: z.string().nullable(),
  hash: z.string(),
  run_state: agentRunState,
  badge: z.number(),
});

export const intakeField = z.object({
  id: z.string(),
  type: z.enum(["text", "single", "multi", "date", "file", "integrity"]),
  prompt: z.string().nullable(),
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  default: z.unknown().nullable(),
  skip_if: z.string().nullable(),
  max: z.number().nullable(),
  from_chat: z.boolean(),
});

export const agentDef = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  version: z.number(),
  mission: z.string(),
  owns: z.array(z.string()),
  does_not_own: z.array(z.string()),
  model: z.enum(["opus", "sonnet", "haiku"]),
  max_turns: z.number(),
  integrity: z.union([z.boolean(), z.literal("when_graded")]),
  allowed_tools: z.array(z.string()),
  mcp_extra: z.array(z.string()),
  state_snapshot: z.string().nullable(),
  intake: z.array(intakeField),
  schedules: z.array(z.object({ name: z.string(), cron: z.string(), tz: z.string(), task: z.string(), model: z.enum(["opus", "sonnet", "haiku"]).nullable(), enabled: z.boolean() })),
  outputs_dir: z.string(),
  board: z.string(),
});

export const agentDetail = z.object({
  summary: agentSummary,
  def: agentDef.nullable(),
  body: z.string(),
  memory: z.string(),
  path: z.string(),
});

export const runRow = z.object({
  id: z.string(),
  agent_id: z.string(),
  trigger: z.string(),
  status: runStatus,
  session_id: z.string().nullable(),
  integrity_level: z.number().nullable(),
  intake_json: z.string().nullable(),
  task_title: z.string(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().nullable(),
  tokens_out: z.number().nullable(),
  turns: z.number().nullable(),
  error: z.string().nullable(),
  summary: z.string().nullable(),
  pid: z.number().nullable(),
  log_path: z.string().nullable(),
  output_dir: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const uiRow = z.object({
  seq: z.number(),
  kind: z.enum(["text", "tool", "question", "proposal", "output", "system", "result", "error"]),
  label: z.string(),
  detail: z.string().nullable(),
  tool_use_id: z.string().nullable(),
  state: z.enum(["running", "done", "error"]),
  ts: z.string(),
});

export const preflight = z.object({
  ok: z.boolean(),
  cli_version: z.string().nullable(),
  logged_in: z.boolean(),
  auth_method: z.string().nullable(),
  error: z.string().nullable(),
});

export const pathsInfo = z.object({ home: z.string(), db_file: z.string(), agents: z.string(), outputs: z.string(), logs_runs: z.string() });

export const runEventRow = z.object({ seq: z.number(), type: z.string(), json: z.string(), created_at: z.string() });

export const settingsList = z.array(z.tuple([z.string(), z.string()]));

export const intakeFieldView = z.object({ field: intakeField, skipped: z.boolean(), prefill: z.unknown().nullable(), satisfied: z.boolean() });
export const intakeForm = z.object({ agent_id: z.string(), fields: z.array(intakeFieldView), can_start: z.boolean(), missing: z.array(z.string()) });
