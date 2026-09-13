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

export const pid = z.number().int().positive();
export const rung = z.enum(["already", "interrupt", "terminate", "kill"]);
export const summoningIds = z.array(z.string());

/** Mirrors `Emission` in src-tauri/src/summonings.rs. */
export const emission = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("output"), bytes: z.array(z.number().int().min(0).max(255)) }),
  z.object({ kind: z.literal("ended"), code: z.number().int().nullable() }),
]);

/** Mirrors `IntakeField` in crates/grimoire-core/src/binding/schema.rs (§6.2). */
export const intakeKind = z.enum(["text", "select", "multiline"]);
export const intakeField = z.object({
  id: z.string(),
  ask: z.string(),
  // `type` on the wire, because that is what a binding author writes in the YAML. The Rust
  // field is `kind`, since `type` is a keyword there.
  type: intakeKind,
  options: z.array(z.string()),
  required: z.boolean(),
});
