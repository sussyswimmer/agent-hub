import { create } from "zustand";

import { backend } from "./lib/ipc";
import type { Aether, FamiliarSummary, HomeInfo, Tab } from "./lib/types";

type View = "familiar" | "ledger" | "seals" | "workbench" | "help";

interface State {
  ready: boolean;
  kind: "tauri" | "mock" | null;
  home: HomeInfo | null;
  familiars: FamiliarSummary[];
  /**
   * Which familiars have a summoning running, asked of the backend on the roster's tick.
   *
   * Not read off `state`: a familiar whose last commission was banished and one that is summoned
   * and idle can both be at their desks, and "can I talk to it" is a different question from
   * "where does it stand".
   */
  live: ReadonlySet<string>;
  selected: string | null;
  tab: Tab;
  /**
   * The three meters, for every familiar, read on one tick.
   *
   * One map rather than one reading for whoever is selected, because §10 asks that the floor's
   * aether arc match the pane's meters "to within one frame" — and the surest way for two
   * views to agree about a number is for there to be one number. The floor needs all of them
   * anyway; the pane takes its own out of the same map.
   */
  aether: Map<string, Aether>;
  refreshAether: () => Promise<void>;
  error: string | null;
  /** Whether the bindings-changed subscription is already in place. */
  watching: boolean;
  /** Which of the whole-window views is open, if any. */
  view: View;
  setView: (v: View) => void;
  /**
   * Whether the right pane shows the floor (§8) or goes straight to the selected familiar.
   *
   * §8 calls the floor the default and the roster rail the fallback, so this starts true. §8.7
   * asks that the choice survive a restart, which is what the one `localStorage` read below is
   * for — a per-window preference, nothing the backend has any business holding.
   */
  floor: boolean;
  setFloor: (on: boolean) => void;
  /** How many requests are waiting on the owner, for the rail's badge (§6.4). */
  sealCount: number;
  setSealCount: (n: number) => void;
  /**
   * Bumped whenever a summoning starts or ends. Anything showing commission state watches it.
   *
   * §6.2 wants the queue *visible*, and a queue that still says "queued" while the commission is
   * running is not visible, it is wrong. A counter rather than the rows themselves, so there is
   * still one source of truth: this says "ask again", the backend answers.
   */
  commissionsChanged: number;
  noteCommissionsChanged: () => void;
  /**
   * A familiar whose terminal should summon it as soon as it opens.
   *
   * Summoning belongs to the terminal: it is the thing the engine's output goes to, and output
   * sent before a terminal is listening is gone. So "Start" on the commission tab does not
   * summon; it asks for a summon and opens the terminal, and the terminal does it.
   */
  summonOnOpen: string | null;
  /**
   * Which step of the guided tour is showing, or null when it is not. The tour opens by itself
   * once, on the first launch with familiars in the rail, and from "How it works" after that.
   */
  tour: number | null;
  setTour: (step: number | null) => void;
  /** Close the tour and remember that it has been seen. */
  endTour: () => void;
  /** Ask for a summon, and open the terminal that will do it. */
  summonAndWatch: (id: string) => void;
  /** Take the request if it is for this familiar. True once, then false. */
  claimSummon: (id: string) => boolean;
  load: () => Promise<void>;
  /**
   * Re-read the roster, and set it only when something actually moved.
   *
   * A familiar's state is not a file, so nothing on disk changes when it starts thinking —
   * there is no event to subscribe to for "the engine is working now". The rail and the floor
   * ask, on a slow tick. Compared before it is stored, because replacing an identical array
   * would re-render the rail and re-sync every actor on the floor twice a second for nothing.
   */
  refreshRoster: () => Promise<void>;
  select: (id: string) => void;
  setTab: (t: Tab) => void;
}

const FLOOR_KEY = "grimoire.floor";
const TOUR_KEY = "grimoire.tour";

/** Whether the guided tour has been seen (or skipped) in this window before. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "seen";
  } catch {
    return true;
  }
}

function readFloorPreference(): boolean {
  try {
    return localStorage.getItem(FLOOR_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  kind: null,
  home: null,
  familiars: [],
  live: new Set(),
  selected: null,
  tab: "commission",
  aether: new Map(),
  error: null,
  watching: false,
  view: "familiar",
  floor: readFloorPreference(),
  sealCount: 0,
  commissionsChanged: 0,
  summonOnOpen: null,
  tour: null,

  load: async () => {
    try {
      const be = await backend();
      const [home, familiars] = await Promise.all([be.homeInfo(), be.listFamiliars()]);
      // Keep the selection if it survived the reload. What happens when there isn't one depends
      // on which view is up: the roster needs something in the right pane or it is an empty
      // window, but §8 calls the floor "the thing you open the app to look at", and a floor that
      // opens as a 40% strip under a familiar nobody asked for is not that. Selecting happens
      // when you pick someone.
      const previous = get().selected;
      const selected = familiars.some((f) => f.id === previous)
        ? previous
        : get().floor
          ? null
          : (familiars[0]?.id ?? null);
      set({ ready: true, kind: be.kind, home, familiars, selected });
      void get().refreshAether();
      void get().refreshRoster();

      // §4: an edit to a binding reaches the rail without a restart. Subscribed once, on the
      // first load, and left for the life of the window. The seal's count is watched the same
      // way, so the rail's badge is right even when its view is not open (§6.4).
      if (!get().watching) {
        set({ watching: true });
        await be.onBindingsChanged(() => {
          void get().load();
        });
        const countSeals = () => {
          void backend()
            .then((b) => b.sealsPending())
            .then((pending) => set({ sealCount: pending.length }))
            .catch(() => {});
        };
        await be.onSealsChanged(() => {
          countSeals();
          // A raised or answered seal moves a familiar between its desk and the ward circle,
          // so the roster is stale the moment the count changes.
          void get().refreshRoster();
        });
        countSeals();

        // §8.3's states are mostly invisible to the filesystem: a summoning starting, an engine
        // taking a turn, a commission ending. This is the tick that notices.
        setInterval(() => {
          if (document.hidden) return;
          void get().refreshRoster();
          void get().refreshAether();
        }, 2500);
      }
    } catch (e) {
      set({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshAether: async () => {
    try {
      const be = await backend();
      const rows = get().familiars;
      const pairs = await Promise.all(rows.map((f) => be.aetherFor(f.id).then((a) => [f.id, a] as const)));
      set({ aether: new Map(pairs.filter((p): p is [string, Aether] => p[1] !== null)) });
    } catch {
      // Meters are a reading, not the truth. A failed one leaves the last up.
    }
  },

  refreshRoster: async () => {
    try {
      const be = await backend();
      const [next, ids] = await Promise.all([be.listFamiliars(), be.liveSummonings()]);
      const was = get().live;
      if (ids.length !== was.size || ids.some((id) => !was.has(id))) set({ live: new Set(ids) });
      const before = get().familiars;
      const same =
        before.length === next.length &&
        before.every((f, i) => {
          const n = next[i]!;
          return f.id === n.id && f.state === n.state && f.status === n.status && f.error === n.error;
        });
      if (!same) set({ familiars: next });
    } catch {
      // A failed read leaves the last roster up. It is a view of the truth, not the truth.
    }
  },

  select: (id) => {
    // Picking a familiar is a request to look at that familiar, so it closes whatever
    // whole-window view was covering it.
    set({ view: "familiar" });
    // The tab deliberately survives the switch. The app is for watching a bench of familiars
    // at once, so flicking between two terminals is the common move; being thrown back to
    // the commission tab every time would fight it.
    set({ selected: id });
    // Read now rather than waiting up to the next tick: choosing a familiar is a request to
    // look at it, and a bar that is blank for two seconds reads as a bar with nothing in it.
    void get().refreshAether();
  },

  setTab: (tab) => set({ tab }),

  setView: (view) => set({ view }),

  setFloor: (floor) => {
    set({ floor });
    // Putting the floor away must not leave an empty window. The floor can be the whole right
    // pane with nobody chosen — that is what §8 wants it to be — but the roster cannot: §7.5's
    // right-hand pane is one familiar at a time, and "No familiar selected" is not a view, it
    // is the absence of one.
    if (!floor && get().selected === null) {
      const first = get().familiars[0]?.id ?? null;
      if (first) get().select(first);
    }
    try {
      localStorage.setItem(FLOOR_KEY, floor ? "1" : "0");
    } catch {
      // A window with storage blocked still gets the toggle; it just forgets it on restart.
    }
  },

  setSealCount: (sealCount) => set({ sealCount }),

  noteCommissionsChanged: () => {
    set((s) => ({ commissionsChanged: s.commissionsChanged + 1 }));
    // Starting, finishing or queueing work moves the familiar on the floor and in the rail, so
    // ask now rather than on the next slow tick.
    void get().refreshRoster();
  },

  setTour: (tour) => set({ tour }),

  endTour: () => {
    set({ tour: null });
    try {
      localStorage.setItem(TOUR_KEY, "seen");
    } catch {
      // Storage blocked: the tour will offer itself again next launch, which is the lesser harm.
    }
  },

  summonAndWatch: (id) => {
    set({ summonOnOpen: id, tab: "terminal", view: "familiar", selected: id });
  },

  claimSummon: (id) => {
    if (get().summonOnOpen !== id) return false;
    set({ summonOnOpen: null });
    return true;
  },
}));

/** The selected familiar's meters, out of the one map everything else reads. */
export function selectedAether(): Aether | null {
  const { aether, selected } = useStore.getState();
  return selected ? (aether.get(selected) ?? null) : null;
}

export function selectedFamiliar(): FamiliarSummary | null {
  const { familiars, selected } = useStore.getState();
  return familiars.find((f) => f.id === selected) ?? null;
}
