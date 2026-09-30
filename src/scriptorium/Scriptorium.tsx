import { useEffect } from "react";

import { Rule } from "@/ui";
import { useStore } from "@/store";
import { FamiliarPane } from "@/familiar/FamiliarPane";
import { Ledger } from "@/ledger/Ledger";
import { Seals } from "@/seal/Seals";
import { Workbench } from "@/workbench/Workbench";

import { Roster } from "./Roster";
import { FloorBoundary } from "./floor/Boundary";
import { Floor } from "./floor/Floor";
import { Quit } from "./Quit";

/**
 * §8.7: the floor is never the only route to anything, so it is a view you can put away. The
 * choice is remembered, because a person who prefers the list prefers it tomorrow too.
 */
function FloorToggle() {
  const floor = useStore((s) => s.floor);
  const setFloor = useStore((s) => s.setFloor);
  return (
    <div className="flex items-center gap-1" data-testid="floor-toggle" data-floor={floor ? "on" : "off"}>
      {(["Floor", "Roster"] as const).map((label) => {
        const on = (label === "Floor") === floor;
        return (
          <button
            key={label}
            type="button"
            onClick={() => setFloor(label === "Floor")}
            aria-pressed={on}
            data-view={label.toLowerCase()}
            className={`h-7 rounded-mark px-2 text-base transition-colors duration-150 ${
              on ? "text-bone" : "text-bone-dim hover:text-bone"
            }`}
            style={on ? { borderBottom: "1px solid var(--brass)" } : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Scriptorium() {
  const { load, familiars, selected, ready, error, kind, view, sealCount, floor, setFloor } = useStore();
  useEffect(() => {
    void load();
  }, [load]);

  const familiar = familiars.find((f) => f.id === selected) ?? null;

  // §8.5: choosing a familiar from the floor does not put the floor away — it shrinks to a strip
  // above the workspace, so the rest of the bench stays in sight while you work on one of them.
  const showFloor = floor && view === "familiar" && ready;

  return (
    <div className="flex h-screen w-screen overflow-hidden" data-backend={kind ?? "loading"}>
      <Roster seals={sealCount} />
      <Rule vertical />
      {view === "seals" ? (
        <Seals />
      ) : view === "workbench" ? (
        <Workbench />
      ) : view === "ledger" ? (
        <main className="flex min-w-0 flex-1 flex-col bg-void">
          <header className="flex h-12 shrink-0 items-center px-4">
            <h1 className="display text-md text-bone">The ledger of ink</h1>
            <div className="ml-auto">
              <FloorToggle />
            </div>
          </header>
          <Rule />
          <Ledger names={new Map(familiars.map((f) => [f.id, f.name]))} />
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col bg-void" data-testid="scriptorium">
          {showFloor && (
            <>
              <header className="flex h-10 shrink-0 items-center px-4">
                <h2 className="display text-base text-bone-dim">The floor</h2>
                <div className="ml-auto">
                  <FloorToggle />
                </div>
              </header>
              <div
                className={
                  familiar ? "flex h-2/5 min-w-0 shrink-0 flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"
                }
                data-testid="floor-slot"
                data-strip={familiar ? "true" : "false"}
              >
                <FloorBoundary onRoster={() => setFloor(false)}>
                  <Floor familiars={familiars} />
                </FloorBoundary>
              </div>
              {familiar && <Rule />}
            </>
          )}
          {familiar ? (
            <FamiliarPane key={familiar.id} familiar={familiar} showToggle={!showFloor} />
          ) : (
            !showFloor && (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-base text-bone-dim">
                  {ready ? "No familiar selected." : "Opening the study…"}
                </p>
              </div>
            )
          )}
        </main>
      )}
      <Quit />
      {error && (
        <div role="alert" className="fixed bottom-3 right-3 max-w-md bg-panel px-3 py-2 text-base text-oxblood-text" data-testid="error">
          {error}
        </div>
      )}
    </div>
  );
}

export { FloorToggle };
