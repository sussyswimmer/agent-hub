// Single source of IPC types: generated from Rust by ts-rs (crates/quintet-core/src/types.rs).
export type { Action } from "./generated/Action";
export type { AgentDef } from "./generated/AgentDef";
export type { AgentDetail } from "./generated/AgentDetail";
export type { AgentRunState } from "./generated/AgentRunState";
export type { AgentSummary } from "./generated/AgentSummary";
export type { IntakeField } from "./generated/IntakeField";
export type { IntakeFieldView } from "./generated/IntakeFieldView";
export type { IntakeForm } from "./generated/IntakeForm";
export type { ResolvedIntake } from "./generated/ResolvedIntake";
export type { TaskArgs } from "./generated/TaskArgs";
export type { IntakeType } from "./generated/IntakeType";
export type { Integrity } from "./generated/Integrity";
export type { Model } from "./generated/Model";
export type { OutputFile } from "./generated/OutputFile";
export type { PathsInfo } from "./generated/PathsInfo";
export type { Preflight } from "./generated/Preflight";
export type { Question } from "./generated/Question";
export type { QuestionItem } from "./generated/QuestionItem";
export type { RunRow } from "./generated/RunRow";
export type { RunStatus } from "./generated/RunStatus";
export type { RunStatusEvent } from "./generated/RunStatusEvent";
export type { RunStreamEvent } from "./generated/RunStreamEvent";
export type { Schedule } from "./generated/Schedule";
export type { StartRunArgs } from "./generated/StartRunArgs";
export type { UiRow } from "./generated/UiRow";
export type { UiRowKind } from "./generated/UiRowKind";
export type { UiRowState } from "./generated/UiRowState";

export type IntegrityLevel = 0 | 1 | 2 | 3;

export interface RunEventRow {
  seq: number;
  type: string;
  json: string;
  created_at: string;
}

/** Which screen the workspace shows. */
export type View = { kind: "approvals" } | { kind: "activity" } | { kind: "settings" } | { kind: "agent"; id: string };
