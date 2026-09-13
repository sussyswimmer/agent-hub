// Generated from crates/grimoire-core/src/types.rs by ts-rs (`bun run bindings`).
export type { Aether } from "./generated/Aether";
export type { Autonomy } from "./generated/Autonomy";
export type { Engine } from "./generated/Engine";
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
