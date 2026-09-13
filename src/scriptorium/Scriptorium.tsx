import { useEffect } from "react";

import { Rule } from "@/ui";
import { useStore } from "@/store";
import { FamiliarPane } from "@/familiar/FamiliarPane";

import { Roster } from "./Roster";

export function Scriptorium() {
  const { load, familiars, selected, ready, error, kind } = useStore();
  useEffect(() => {
    void load();
  }, [load]);

  const familiar = familiars.find((f) => f.id === selected) ?? null;
  const seals = familiars.filter((f) => f.state === "awaiting-seal").length;

  return (
    <div className="flex h-screen w-screen overflow-hidden" data-backend={kind ?? "loading"}>
      <Roster seals={seals} />
      <Rule vertical />
      {familiar ? (
        <FamiliarPane key={familiar.id} familiar={familiar} />
      ) : (
        <main className="flex flex-1 items-center justify-center bg-void">
          <p className="text-base text-bone-dim">{ready ? "No familiar selected." : "Opening the study…"}</p>
        </main>
      )}
      {error && (
        <div role="alert" className="fixed bottom-3 right-3 max-w-md bg-panel px-3 py-2 text-base text-oxblood-text" data-testid="error">
          {error}
        </div>
      )}
    </div>
  );
}
