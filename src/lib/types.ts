// Generated from crates/grimoire-core/src/types.rs by ts-rs (`bun run bindings`).
export type { Aether } from "./generated/Aether";
export type { Autonomy } from "./generated/Autonomy";
export type { Commission } from "./generated/Commission";
export type { DaySpend } from "./generated/DaySpend";
export type { Engine } from "./generated/Engine";
export type { Estimate } from "./generated/Estimate";
export type { Event } from "./generated/Event";
export type { EventKind } from "./generated/EventKind";
export type { FamiliarSpend } from "./generated/FamiliarSpend";
export type { LedgerSummary } from "./generated/LedgerSummary";
export type { Resolution } from "./generated/Resolution";
export type { Seal } from "./generated/Seal";
export type { SealKind } from "./generated/SealKind";
export type { Status } from "./generated/Status";
export type { Tokens } from "./generated/Tokens";
export type { IntakeField } from "./generated/IntakeField";
export type { IntakeKind } from "./generated/IntakeKind";
export type { FamiliarSummary } from "./generated/FamiliarSummary";
export type { Isolation } from "./generated/Isolation";
export type { Order } from "./generated/Order";
export type { SigilState } from "./generated/SigilState";

export interface HomeInfo {
  home: string;
  bindings: string;
  db_file: string;
  schema_version: number;
}

/** Which tab of the familiar pane is showing (§7.5). */
export type Tab = "commission" | "terminal" | "outputs" | "codex";

/** What the interface shows of a familiar's codex (§6.6). */
export interface CodexView {
  path: string;
  text: string;
  words: number;
  needs_condense: boolean;
}
