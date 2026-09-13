// The one boundary between the UI and the backend. Real Tauri when running inside the app,
// an in-memory mock in a plain browser (Playwright, `vite dev` without Tauri).
import type { AgentDetail, AgentSummary, IntakeForm, PathsInfo, Preflight, Question, RunEventRow, RunRow, RunStatus, StartRunArgs, TaskArgs, UiRow } from "./types";

export type Unsubscribe = () => void;

export interface Backend {
  preflight(): Promise<Preflight | null>;
  listAgents(): Promise<AgentSummary[]>;
  getAgent(id: string): Promise<AgentDetail | null>;
  startRun(args: StartRunArgs): Promise<RunRow>;
  /** Intake form for a task: which fields to show, prefills, whether it can start now. */
  evaluateIntake(agentId: string, taskText: string, partial: Record<string, unknown>): Promise<IntakeForm>;
  /** Resolve intake (defaults, from_chat, integrity cap) and start. */
  startTask(args: TaskArgs): Promise<RunRow>;
  cancelRun(id: string): Promise<void>;
  listQuestions(q?: { runId?: string; status?: string }): Promise<Question[]>;
  /** Store answers; the run resumes once no pending questions remain. */
  answerQuestions(questionId: string, answers: Record<string, unknown>): Promise<RunRow>;
  listRuns(q?: { agentId?: string; status?: RunStatus; limit?: number }): Promise<RunRow[]>;
  getRun(id: string): Promise<RunRow | null>;
  getRunEvents(id: string, afterSeq?: number): Promise<RunEventRow[]>;
  getRunRows(id: string): Promise<UiRow[]>;
  getPaths(): Promise<PathsInfo>;
  getSettings(): Promise<Record<string, string>>;
  setSetting(key: string, value: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  onRunEvent(runId: string, cb: (row: UiRow) => void): Unsubscribe;
  onRunStatus(cb: (run: RunRow) => void): Unsubscribe;
  onRegistryChanged(cb: (agents: AgentSummary[]) => void): Unsubscribe;
  onPreflight(cb: (p: Preflight) => void): Unsubscribe;
  /** "tauri" or "mock" — shown in Settings so a mock session is never mistaken for the app. */
  readonly kind: "tauri" | "mock";
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

let instance: Backend | null = null;

export async function backend(): Promise<Backend> {
  if (instance) return instance;
  const forceMock = import.meta.env["VITE_IPC_MOCK"] === "1";
  if (!forceMock && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { createTauriBackend } = await import("./ipc.tauri");
    instance = createTauriBackend();
  } else {
    const { createMockBackend } = await import("./ipc.mock");
    instance = createMockBackend();
  }
  return instance;
}
