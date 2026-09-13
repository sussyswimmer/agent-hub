// The one boundary between the UI and Rust. Real Tauri inside the app, an in-memory stand-in
// in a plain browser, so the whole shell is testable headless.
import type { Aether, FamiliarSummary, HomeInfo } from "./types";

export interface Backend {
  readonly kind: "tauri" | "mock";
  homeInfo(): Promise<HomeInfo>;
  listFamiliars(): Promise<FamiliarSummary[]>;
  /** Phase 0 has no live commissions; the pane draws empty meters until Phase 3. */
  aetherFor(familiarId: string): Promise<Aether | null>;
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
