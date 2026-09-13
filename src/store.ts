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
}));

export function selectedFamiliar(): FamiliarSummary | null {
  const { familiars, selected } = useStore.getState();
  return familiars.find((f) => f.id === selected) ?? null;
}
