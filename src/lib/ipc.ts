// The one boundary between the UI and Rust. Real Tauri inside the app, an in-memory stand-in
// in a plain browser, so the whole shell is testable headless.
import type {
  Ward,
  Aether,
  CodexView,
  Commission,
  Engine,
  Event,
  FamiliarSummary,
  HomeInfo,
  IntakeField,
  LedgerSummary,
  Resolution,
  Seal,
  WorkbenchSettings,
} from "./types";

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
  /** From the binding. Recorded on the summoning and used to price the run (§6.9). */
  model?: string | null;
  onEmission: (e: Emission) => void;
}

export interface Backend {
  readonly kind: "tauri" | "mock";
  homeInfo(): Promise<HomeInfo>;
  workbenchRead(): Promise<WorkbenchSettings>;
  workbenchSetEnginePath(engine: Engine, path: string): Promise<void>;
  workbenchSetSpendCap(usd: number): Promise<void>;
  workbenchDeleteTranscript(name: string): Promise<void>;
  workbenchRestoreBindings(): Promise<string[]>;
  listFamiliars(): Promise<FamiliarSummary[]>;
  /** Phase 0 has no live commissions; the pane draws empty meters until Phase 3. */
  aetherFor(familiarId: string): Promise<Aether | null>;
  /** The intake questions this familiar's binding declares (§6.2). */
  intakeFor(familiarId: string): Promise<IntakeField[]>;
  /** Called when the bindings folder changes. Returns an unsubscribe. */
  onBindingsChanged(fn: () => void): Promise<() => void>;

  /** Start a familiar in a pty. Resolves to its pid. */
  summon(req: SummonRequest): Promise<number>;
  /** Typed input, as bytes — the familiar is reading keys, not lines. */
  sendInput(id: string, bytes: Uint8Array): Promise<void>;
  resizeSummoning(id: string, cols: number, rows: number): Promise<void>;
  /** Walk the stop ladder. Resolves to which rung it took. */
  banish(id: string): Promise<string>;
  liveSummonings(): Promise<string[]>;
  /** Quit was asked for from the menu bar. Returns an unsubscribe (§6.7). */
  onQuitRequested(fn: () => void): Promise<() => void>;
  /** Quit for real, having warned. */
  quit(): Promise<void>;
  /**
   * Point a freshly-mounted terminal at a summoning that is already running, and say whether
   * there was one. Output written while nothing was attached is gone: a pty is a stream.
   */
  attachSummoning(id: string, onEmission: (e: Emission) => void): Promise<boolean>;

  /** Place a commission. It queues; it starts when its familiar is next free (§6.2). */
  commissionCreate(id: string, prompt: string, intake: Record<string, string>): Promise<Commission>;
  /** Every commission for one familiar, newest first. */
  commissionsFor(id: string): Promise<Commission[]>;
  /** Every standing ward on one familiar (§6.7). */
  wardsFor(id: string): Promise<Ward[]>;
  /** Set one up. The schedule is checked now, not once a minute for ever. */
  wardCreate(id: string, cron: string, prompt: string, intake: Record<string, string>): Promise<Ward>;
  wardSetEnabled(id: string, enabled: boolean): Promise<void>;
  wardDelete(id: string): Promise<void>;

  /** The ledger's roll-ups (§6.9). */
  ledgerSummary(): Promise<LedgerSummary>;
  ledgerEvents(limit?: number): Promise<Event[]>;
  /** What a familiar has written into its codex (§6.6). */
  codexFor(id: string): Promise<CodexView>;

  /** Everything waiting on the owner, oldest first (§6.4). */
  sealsPending(): Promise<Seal[]>;
  /** Answer one request. The familiar blocked on it is woken by this. */
  sealDecide(id: string, resolution: Resolution): Promise<Seal>;
  /** Called when the queue moves. Returns an unsubscribe. */
  onSealsChanged(fn: () => void): Promise<() => void>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * The one backend, as a promise rather than a resolved value.
 *
 * Caching the *result* looks equivalent and is not: two callers that arrive before the first
 * `await` finishes both see an empty cache, both build a backend, and the second overwrites the
 * first. Whoever captured the first is then talking to an orphan. With the mock that showed up
 * as a subscription that never fired — the roster watching one backend while the terminal
 * summoned on another — and against Tauri it would be two clients and two sets of listeners.
 * Caching the promise means every caller waits on the same construction.
 */
let building: Promise<Backend> | null = null;

export async function backend(): Promise<Backend> {
  building ??= (async () => {
    const forceMock = import.meta.env["VITE_IPC_MOCK"] === "1";
    const useTauri = !forceMock && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    return useTauri
      ? (await import("./ipc.tauri")).createTauriBackend()
      : (await import("./ipc.mock")).createMockBackend();
  })();
  return building;
}
