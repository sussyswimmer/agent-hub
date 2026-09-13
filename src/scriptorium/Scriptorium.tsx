import { useEffect } from "react";

import { Rule } from "@/ui";
import { useStore } from "@/store";
import { FamiliarPane } from "@/familiar/FamiliarPane";
import { Ledger } from "@/ledger/Ledger";
import { Seals } from "@/seal/Seals";

import { Roster } from "./Roster";

export function Scriptorium() {
  const { load, familiars, selected, ready, error, kind, view, sealCount } = useStore();
  useEffect(() => {
    void load();
  }, [load]);

  const familiar = familiars.find((f) => f.id === selected) ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden" data-backend={kind ?? "loading"}>
      <Roster seals={sealCount} />
      <Rule vertical />
      {view === "seals" ? (
        <Seals />
      ) : view === "ledger" ? (
        <main className="flex min-w-0 flex-1 flex-col bg-void">
          <header className="flex h-12 shrink-0 items-center px-4">
            <h1 className="display text-md text-bone">The ledger of ink</h1>
          </header>
          <Rule />
          <Ledger names={new Map(familiars.map((f) => [f.id, f.name]))} />
        </main>
      ) : familiar ? (
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
