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

  load: async () => {
    try {
      const be = await backend();
      const [home, familiars] = await Promise.all([be.homeInfo(), be.listFamiliars()]);
      const selected = get().selected ?? familiars[0]?.id ?? null;
      set({ ready: true, kind: be.kind, home, familiars, selected });
      if (selected) set({ aether: await be.aetherFor(selected) });
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
