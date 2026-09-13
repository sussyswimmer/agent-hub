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
  /** Which of the whole-window views is open, if any. */
  view: "familiar" | "ledger" | "seals";
  setView: (v: "familiar" | "ledger" | "seals") => void;
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
  view: "familiar",
  sealCount: 0,
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
        await be.onSealsChanged(countSeals);
        countSeals();
      }
    } catch (e) {
      set({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  select: (id) => {
    // Picking a familiar is a request to look at that familiar, so it closes whatever
    // whole-window view was covering it.
    set({ view: "familiar" });
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

  setView: (view) => set({ view }),

  setSealCount: (sealCount) => set({ sealCount }),

  noteCommissionsChanged: () => set((s) => ({ commissionsChanged: s.commissionsChanged + 1 })),
}));

export function selectedFamiliar(): FamiliarSummary | null {
  const { familiars, selected } = useStore.getState();
  return familiars.find((f) => f.id === selected) ?? null;
}
