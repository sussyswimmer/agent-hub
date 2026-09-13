import { create } from "zustand";

import { backend } from "./lib/ipc";
import type { Aether, FamiliarSummary, HomeInfo, Tab } from "./lib/types";

interface State {
  ready: boolean;
  kind: "tauri" | "mock" | null;
  home: HomeInfo | null;
  familiars: FamiliarSummary[];
  selected: string | null;
  tab: Tab;
  aether: Aether | null;
  error: string | null;
  /** Whether the bindings-changed subscription is already in place. */
  watching: boolean;
  /** The ledger replaces the familiar pane when it is open (§6.9). */
  showLedger: boolean;
  setShowLedger: (v: boolean) => void;
  /**
   * Bumped whenever a summoning starts or ends. Anything showing commission state watches it.
   *
   * §6.2 wants the queue *visible*, and a queue that still says "queued" while the commission is
   * running is not visible, it is wrong. A counter rather than the rows themselves, so there is
   * still one source of truth: this says "ask again", the backend answers.
   */
  commissionsChanged: number;
  noteCommissionsChanged: () => void;
  load: () => Promise<void>;
  select: (id: string) => void;
  setTab: (t: Tab) => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  kind: null,
  home: null,
  familiars: [],
  selected: null,
  tab: "commission",
  aether: null,
  error: null,
  watching: false,
  showLedger: false,
  commissionsChanged: 0,

  load: async () => {
    try {
      const be = await backend();
      const [home, familiars] = await Promise.all([be.homeInfo(), be.listFamiliars()]);
      // Keep the selection if it survived the reload; otherwise fall to the first familiar.
      const previous = get().selected;
      const selected = familiars.some((f) => f.id === previous)
        ? previous
        : (familiars[0]?.id ?? null);
      set({ ready: true, kind: be.kind, home, familiars, selected });
      if (selected) set({ aether: await be.aetherFor(selected) });

      // §4: an edit to a binding reaches the rail without a restart. Subscribed once, on the
      // first load, and left for the life of the window.
      if (!get().watching) {
        set({ watching: true });
        await be.onBindingsChanged(() => {
          void get().load();
        });
      }
    } catch (e) {
      set({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  select: (id) => {
    // Picking a familiar is a request to look at that familiar, so it closes the ledger.
    set({ showLedger: false });
    // The tab deliberately survives the switch. The app is for watching a bench of familiars
    // at once, so flicking between two terminals is the common move; being thrown back to
    // the commission tab every time would fight it.
    set({ selected: id, aether: null });
    void backend()
      .then((be) => be.aetherFor(id))
      .then((a) => {
        if (get().selected === id) set({ aether: a });
      });
  },

  setTab: (tab) => set({ tab }),

  setShowLedger: (showLedger) => set({ showLedger }),

  noteCommissionsChanged: () => set((s) => ({ commissionsChanged: s.commissionsChanged + 1 })),
}));

export function selectedFamiliar(): FamiliarSummary | null {
  const { familiars, selected } = useStore.getState();
  return familiars.find((f) => f.id === selected) ?? null;
}
