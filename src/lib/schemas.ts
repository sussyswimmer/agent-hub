// Zod at the IPC boundary (§5: both sides validate). Shapes mirror src/lib/generated.
import { z } from "zod";

export const order = z.enum(["quill", "lantern", "crucible", "compass", "ledger"]);
export const engine = z.enum(["claude", "codex", "gemini", "qwen", "custom"]);
export const sigilState = z.enum(["dormant", "idle", "working", "awaiting-seal", "bound", "stalled", "banished", "misfired"]);

export const familiarSummary = z.object({
  id: z.string(),
  name: z.string(),
  order,
  engine,
  state: sigilState,
  status: z.string(),
  workspace: z.string(),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
  cannot_summon: z.string().nullable(),
  binding_path: z.string(),
});

export const homeInfo = z.object({
  home: z.string(),
  bindings: z.string(),
  db_file: z.string(),
  schema_version: z.number(),
});

export const aether = z.object({
  tokens: z.number(),
  tokens_max: z.number().nullable(),
  turns: z.number(),
  turns_max: z.number().nullable(),
  seconds: z.number(),
  seconds_max: z.number().nullable(),
});
