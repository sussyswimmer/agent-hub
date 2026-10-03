// The one boundary between the UI and Rust. Real Tauri inside the app, an in-memory stand-in
// in a plain browser, so the whole shell is testable headless.
import type {
  Ward,
  Aether,
  BindingForm,
  FolderStatus,
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
  /** Opens the engine's own macOS sign-in flow. Credentials never pass through Grimoire. */
  workbenchOpenEngineLogin(engine: Engine): Promise<string>;
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

  /**
   * Place a commission. A summoned familiar with nothing in hand starts on it at once; otherwise
   * it queues and starts when its familiar is next free (§6.2). Resolves to the row as it stands
   * afterwards, so `status` says which of the two happened.
   */
  commissionCreate(id: string, prompt: string, intake: Record<string, string>): Promise<Commission>;
  /**
   * The owner says the running commission is done. The familiar stays summoned and is handed the
   * next in its queue; resolves to that one, or null if the queue was empty.
   */
  commissionDone(id: string): Promise<Commission | null>;
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

  // Setting familiars up from inside the app (DECISIONS 0028). The binding file is still what
  // changes; these write it.
  /** The settings page's form for one familiar. Refuses for a binding that does not load. */
  bindingForm(id: string): Promise<BindingForm>;
  /**
   * A new familiar for `id === null`, otherwise that one changed. Resolves to its id. `read` is
   * the form as the page was filled: given it, only what changed on the page is written, and an
   * edit made in the file meanwhile is kept.
   */
  bindingSave(id: string | null, form: BindingForm, read?: BindingForm): Promise<string>;
  /** Put a familiar away. Its file is renamed, not deleted; resolves to where it went. */
  bindingRemove(id: string): Promise<string>;
  /** Whether a folder is there, as it is typed. */
  folderStatus(path: string): Promise<FolderStatus>;
  /** The system's folder picker. Null if it was closed without choosing. */
  pickFolder(start?: string): Promise<string | null>;
  /** Say something to a summoned familiar, as one message, as if typed and sent. */
  say(id: string, text: string): Promise<void>;
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
