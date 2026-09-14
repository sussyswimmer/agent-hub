import { useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import { Rule } from "@/ui";

/**
 * The warning in front of quitting (§6.7: "it warns if summonings are live").
 *
 * Quit is asked for from the menu bar, but it is answered here, because live familiars are the
 * one thing quitting throws away and the window is the only place that can be said. With nothing
 * running it does not ask at all — a confirmation nobody needs is one everybody learns to click
 * through.
 */
export function Quit() {
  const familiars = useStore((s) => s.familiars);
  const [asking, setAsking] = useState<string[] | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void backend()
      .then((b) => b.onQuitRequested(async () => {
        const live = await b.liveSummonings();
        if (live.length === 0) {
          await b.quit();
          return;
        }
        setAsking(live);
      }))
      .then((unsub) => {
        stop = unsub;
      });
    return () => stop?.();
  }, []);

  if (asking === null) return null;

  const names = asking.map((id) => familiars.find((f) => f.id === id)?.name ?? id);
  const what =
    names.length === 1
      ? `${names[0]} is still working.`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are still working.`;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-void/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quit-title"
      data-testid="quit-warning"
    >
      <div className="w-[28rem] border border-rule bg-panel">
        <h2 id="quit-title" className="display px-4 py-3 text-md text-bone">
          Quit Grimoire?
        </h2>
        <Rule />
        <p className="measure px-4 py-3 text-base text-bone-dim" data-testid="quit-who">
          {what} Quitting stops {names.length === 1 ? "it" : "them"}, and anything half-finished
          stays half-finished.
        </p>
        <div className="flex items-center justify-end gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => setAsking(null)}
            data-testid="quit-stay"
            className="h-7 rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-void"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={() => void backend().then((b) => b.quit())}
            data-testid="quit-anyway"
            className="h-7 rounded-mark border border-oxblood px-3 text-base text-oxblood-text transition-colors duration-150 hover:bg-void"
          >
            Quit and stop {names.length === 1 ? "it" : "them"}
          </button>
        </div>
      </div>
    </div>
  );
}
