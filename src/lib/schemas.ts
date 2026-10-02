// Zod at the IPC boundary (§5: both sides validate). Shapes mirror src/lib/generated.
//
// **The enums below are checked against the generated types.** A Zod enum is a list of strings
// with no relationship to the TypeScript type it is supposed to mirror, so the two drift the
// moment a variant is added in Rust — and drift silently, because the failure is a parse error
// inside a `catch`. Phase 6 added two seal kinds and four ledger kinds; the rail went on
// reading "none waiting" beside a familiar whose own row said it was waiting on a seal, because
// `sealsPending()` was throwing on a `kind` Zod had never heard of.
//
// `satisfies` alone is not enough, and finding that out cost a second bug in the same shape.
// It checks that every string in the list *is* a valid variant — it says nothing about whether
// every variant is in the list, which is the direction that actually happens: a variant added
// in Rust, regenerated, and never added here. `Covers` below asserts the other direction, and
// names what is missing when it fails.
import { z } from "zod";

/**
 * Fails to compile when `T` does not list every variant of `U`, and says which are missing.
 *
 * The error reads `Type '{ missing: "ward_fired" }' does not satisfy the constraint 'true'`,
 * which points straight at the line to add.
 */
type Covers<T extends readonly string[], U extends string> =
  [Exclude<U, T[number]>] extends [never] ? true : { missing: Exclude<U, T[number]> };
type Exhaustive<T extends true> = T;

import type { Autonomy } from "./generated/Autonomy";
import type { Engine } from "./generated/Engine";
import type { EventKind } from "./generated/EventKind";
import type { IntakeKind } from "./generated/IntakeKind";
import type { OnExceed } from "./generated/OnExceed";
import type { Order } from "./generated/Order";
import type { Resolution } from "./generated/Resolution";
import type { SealKind } from "./generated/SealKind";
import type { SigilState } from "./generated/SigilState";
import type { Status } from "./generated/Status";

const ORDERS = ["quill", "lantern", "crucible", "compass", "ledger"] as const satisfies readonly Order[];
type _CoversOrder = Exhaustive<Covers<typeof ORDERS, Order>>;
const ENGINES = ["claude", "codex", "gemini", "qwen", "custom"] as const satisfies readonly Engine[];
type _CoversEngine = Exhaustive<Covers<typeof ENGINES, Engine>>;
const SIGIL_STATES = [
  "dormant", "idle", "working", "awaiting-seal", "bound", "stalled", "banished", "misfired",
] as const satisfies readonly SigilState[];
type _CoversSigilState = Exhaustive<Covers<typeof SIGIL_STATES, SigilState>>;

export const order = z.enum(ORDERS);
export const engine = z.enum(ENGINES);
export const sigilState = z.enum(SIGIL_STATES);

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
  workspace_missing: z.boolean(),
});

export const homeInfo = z.object({
  home: z.string(),
  bindings: z.string(),
  db_file: z.string(),
  schema_version: z.number(),
});

export const engineSetting = z.object({
  engine,
  configured: z.string(),
  resolved: z.string().nullable(),
  source: z.enum(["workbench", "PATH"]).nullable(),
  error: z.string().nullable(),
});

export const transcriptInfo = z.object({
  name: z.string(),
  bytes: z.number().nonnegative(),
  modified: z.number().nullable(),
});

export const workbenchSettings = z.object({
  engines: z.array(engineSetting),
  spend_cap_usd: z.number().positive(),
  transcripts: z.array(transcriptInfo),
});
export const stringArray = z.array(z.string());

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
const INTAKE_KINDS = ["text", "select", "multiline"] as const satisfies readonly IntakeKind[];
type _CoversIntakeKind = Exhaustive<Covers<typeof INTAKE_KINDS, IntakeKind>>;
export const intakeKind = z.enum(INTAKE_KINDS);
export const intakeField = z.object({
  id: z.string(),
  ask: z.string(),
  // `type` on the wire, because that is what a binding author writes in the YAML. The Rust
  // field is `kind`, since `type` is a keyword there.
  type: intakeKind,
  options: z.array(z.string()),
  required: z.boolean(),
});

// ── Setting familiars up (DECISIONS 0028) ─────────────────────────────────────────────

const AUTONOMIES = ["propose", "bounded", "free"] as const satisfies readonly Autonomy[];
type _CoversAutonomy = Exhaustive<Covers<typeof AUTONOMIES, Autonomy>>;
export const autonomy = z.enum(AUTONOMIES);
const ON_EXCEED = ["steer", "bind", "banish"] as const satisfies readonly OnExceed[];
type _CoversOnExceed = Exhaustive<Covers<typeof ON_EXCEED, OnExceed>>;
export const onExceed = z.enum(ON_EXCEED);

/** Mirrors `BindingForm` in crates/grimoire-core/src/binding/write.rs. */
export const bindingForm = z.object({
  name: z.string(),
  order,
  engine,
  model: z.string().nullable(),
  workspace: z.string(),
  autonomy,
  aether: z.object({
    tokens: z.number().nullable(),
    turns: z.number().nullable(),
    minutes: z.number().nullable(),
    on_exceed: onExceed,
  }),
  intake: z.array(intakeField),
  writ: z.string(),
});

export const folderStatus = z.object({ expanded: z.string(), exists: z.boolean() });

// ── Commissions and the ledger (§6.2, §6.9) ────────────────────────────────────────────

const COMMISSION_STATUSES = [
  "queued",
  "running",
  "awaiting_seal",
  "done",
  "banished",
  "misfired",
] as const satisfies readonly Status[];
type _CoversStatus = Exhaustive<Covers<typeof COMMISSION_STATUSES, Status>>;

export const commissionStatus = z.enum(COMMISSION_STATUSES);

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
const EVENT_KINDS = [
  "summoned",
  "banished",
  "commission_queued",
  "commission_started",
  "commission_ended",
  "usage",
  "seal_raised",
  "seal_resolved",
  "breaker_tripped",
  "breaker_steer",
  "breaker_bind",
  "breaker_banish",
  "stalled",
  "ward_fired",
  "misfired",
] as const satisfies readonly EventKind[];
type _CoversEventKind = Exhaustive<Covers<typeof EVENT_KINDS, EventKind>>;

export const eventKind = z.enum(EVENT_KINDS);

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

const SEAL_KINDS = [
  "write", "shell", "network", "destructive", "send", "reliquary", "proposal", "extend", "stalled",
] as const satisfies readonly SealKind[];
type _CoversSealKind = Exhaustive<Covers<typeof SEAL_KINDS, SealKind>>;

export const sealKind = z.enum(SEAL_KINDS);
const RESOLUTIONS = [
  "sealed", "sealed_always", "refused", "timed_out", "withdrawn",
] as const satisfies readonly Resolution[];
type _CoversResolution = Exhaustive<Covers<typeof RESOLUTIONS, Resolution>>;

export const resolution = z.enum(RESOLUTIONS);

/** A standing ward (§6.7). `next_run` is worked out for the panel, not stored. */
export const ward = z.object({
  id: z.string(),
  familiar_id: z.string(),
  cron: z.string(),
  prompt: z.string(),
  intake: z.unknown(),
  enabled: z.boolean(),
  last_run: z.number().nullable(),
  last_result: z.string().nullable(),
  next_run: z.number().nullable(),
});

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
