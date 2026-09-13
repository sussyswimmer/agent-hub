// The one boundary between the UI and Rust. Real Tauri inside the app, an in-memory stand-in
// in a plain browser, so the whole shell is testable headless.
import type { Aether, Engine, FamiliarSummary, HomeInfo } from "./types";

/** One message from a summoning's pty. Bytes, not text: see `Emission` in Rust. */
export type Emission =
  | { kind: "output"; bytes: Uint8Array }
  | { kind: "ended"; code: number | null };

export interface SummonRequest {
  id: string;
  engine: Engine;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  onEmission: (e: Emission) => void;
}

export interface Backend {
  readonly kind: "tauri" | "mock";
  homeInfo(): Promise<HomeInfo>;
  listFamiliars(): Promise<FamiliarSummary[]>;
  /** Phase 0 has no live commissions; the pane draws empty meters until Phase 3. */
  aetherFor(familiarId: string): Promise<Aether | null>;

  /** Start a familiar in a pty. Resolves to its pid. */
  summon(req: SummonRequest): Promise<number>;
  /** Typed input, as bytes — the familiar is reading keys, not lines. */
  sendInput(id: string, bytes: Uint8Array): Promise<void>;
  resizeSummoning(id: string, cols: number, rows: number): Promise<void>;
  /** Walk the stop ladder. Resolves to which rung it took. */
  banish(id: string): Promise<string>;
  liveSummonings(): Promise<string[]>;
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
    instance = (await import("./ipc.tauri")).createTauriBackend();
  } else {
    instance = (await import("./ipc.mock")).createMockBackend();
  }
  return instance;
}
