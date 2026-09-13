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
/** Whether a re-attach found a live summoning to attach to. */
export const attached = z.boolean();

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

// ── Commissions and the ledger (§6.2, §6.9) ────────────────────────────────────────────

export const commissionStatus = z.enum([
  "queued",
  "running",
  "awaiting_seal",
  "done",
  "banished",
  "misfired",
]);

export const tokens = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
});

/** §6.9: cost is never a settled number. The flag travels with it, and is checked here. */
export const estimate = z.object({ usd: z.number(), estimated: z.literal(true) });

export const commission = z.object({
  id: z.string(),
  familiar_id: z.string(),
  summoning_id: z.string().nullable(),
  prompt: z.string(),
  intake: z.unknown(),
  status: commissionStatus,
  created: z.number(),
  ended: z.number().nullable(),
  tokens,
  turns: z.number(),
  cost: estimate,
  note: z.string().nullable(),
});

export const ledgerSummary = z.object({
  by_familiar: z.array(
    z.object({
      familiar_id: z.string(),
      commissions: z.number(),
      tokens,
      cost: estimate,
      seconds: z.number(),
    }),
  ),
  by_day: z.array(
    z.object({ day: z.string(), commissions: z.number(), tokens, cost: estimate }),
  ),
  total: estimate,
  tokens,
  commissions: z.number(),
});

/** Mirrors `EventKind` in crates/grimoire-core/src/ledger/mod.rs. */
export const eventKind = z.enum([
  "summoned",
  "banished",
  "commission_queued",
  "commission_started",
  "commission_ended",
  "usage",
  "seal_raised",
  "seal_resolved",
  "breaker_tripped",
  "misfired",
]);

export const ledgerEvent = z.object({
  id: z.number(),
  at: z.number(),
  commission_id: z.string().nullable(),
  familiar_id: z.string().nullable(),
  kind: eventKind,
  payload: z.unknown(),
});

export const codexView = z.object({
  path: z.string(),
  text: z.string(),
  words: z.number(),
  needs_condense: z.boolean(),
});

// ── The seal (§6.4) ────────────────────────────────────────────────────────────────────

export const sealKind = z.enum(["write", "shell", "network", "destructive", "send", "reliquary"]);
export const resolution = z.enum(["sealed", "sealed_always", "refused", "timed_out"]);

export const seal = z.object({
  id: z.string(),
  commission_id: z.string(),
  familiar_id: z.string(),
  familiar_name: z.string(),
  kind: sealKind,
  action: z.string(),
  reason: z.string(),
  preview: z.string().nullable(),
  raised: z.number(),
  resolved: z.number().nullable(),
  resolution: resolution.nullable(),
});
