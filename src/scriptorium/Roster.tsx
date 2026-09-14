import { useState } from "react";

import { Rule, Sigil } from "@/ui";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";
import { backend } from "@/lib/ipc";

function RosterRow({ familiar, selected, onSelect }: { familiar: FamiliarSummary; selected: boolean; onSelect: () => void }) {
  const broken = familiar.error !== null;
  const warned = familiar.warnings.length > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
      data-familiar={familiar.id}
      data-state={familiar.state}
      title={broken ? familiar.error! : familiar.status}
      style={{ borderLeft: `2px solid ${selected ? "var(--brass)" : "transparent"}` }}
      className={`flex w-full items-start gap-2 py-1.5 pl-2.5 pr-3 text-left transition-colors duration-150 ${
        selected ? "bg-void" : "hover:bg-void/60"
      }`}
    >
      <span className="mt-0.5">
        <Sigil name={familiar.name} order={familiar.order} state={familiar.state} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`display flex items-baseline gap-1.5 text-base ${broken ? "text-oxblood-text" : "text-bone"}`}>
          <span className="min-w-0 truncate">{familiar.name}</span>
          {warned && !broken && (
            // A binding that works but has something odd in it. Not an error, so not oxblood:
            // brass, and small, and it says what when you hover.
            <span
              className="shrink-0 text-xs text-brass-text"
              data-warned={familiar.warnings.length}
              title={familiar.warnings.join("\n")}
              aria-label={`${familiar.warnings.length} thing${familiar.warnings.length === 1 ? "" : "s"} to look at in this binding`}
            >
              ·
            </span>
          )}
        </span>
        <span className={`block truncate text-xs ${broken ? "text-oxblood-text" : "text-bone-dim"}`} data-status>
          {broken ? familiar.error : familiar.status}
        </span>
      </span>
    </button>
  );
}

export function Roster({ seals = 0 }: { seals?: number }) {
  const { familiars, selected, select, ready, view, setView, load } = useStore();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function restoreStarterCircle() {
    setRestoring(true);
    setRestoreError(null);
    try {
      await (await backend()).workbenchRestoreBindings();
      await load();
    } catch (reason) {
      setRestoreError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <nav style={{ width: "var(--rail)" }}
      className="flex h-full shrink-0 flex-col bg-panel" aria-label="Roster" data-testid="roster">
      {/* room for the traffic lights under an overlay title bar */}
      <div className="h-9 shrink-0" data-tauri-drag-region />
      <div className="flex-1 overflow-y-auto rule-scroll">
        {familiars.map((f) => (
          <RosterRow
            key={f.id}
            familiar={f}
            selected={view === "familiar" && f.id === selected}
            onSelect={() => select(f.id)}
          />
        ))}
        {ready && familiars.length === 0 && (
          <div className="m-3 rounded-[18px] border border-brass/30 bg-void/70 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
            <p className="display text-base text-bone">The circle is empty.</p>
            <p className="mt-1 text-xs text-bone-dim">Place the five starter agents, or add a <span className="mono">.binding.md</span> yourself.</p>
            <button
              type="button"
              disabled={restoring}
              onClick={() => void restoreStarterCircle()}
              className="mt-3 w-full rounded-full border border-brass/50 bg-brass/10 px-3 py-1.5 text-xs text-brass-text transition hover:bg-brass/20 disabled:opacity-50"
            >
              {restoring ? "Restoring..." : "Restore starter agents"}
            </button>
            {restoreError && <p role="alert" className="mt-2 text-xs text-oxblood-text">{restoreError}</p>}
          </div>
        )}
      </div>
      <Rule />
      <button
        type="button"
        onClick={() => setView(view === "workbench" ? "familiar" : "workbench")}
        aria-pressed={view === "workbench"}
        data-testid="workbench-toggle"
        style={{ borderLeft: `2px solid ${view === "workbench" ? "var(--brass)" : "transparent"}` }}
        className={`w-full py-1.5 pl-2.5 pr-3 text-left text-base transition-colors duration-150 ${
          view === "workbench" ? "bg-void text-bone" : "text-bone-dim hover:text-bone"
        }`}
      >
        Workbench
      </button>
      <Rule />
      {/* §6.9's ledger is reached from the lectern on the floor in Phase 5; until then the rail
          is the only way in, so it lives here beside the seals. */}
      <button
        type="button"
        onClick={() => setView(view === "ledger" ? "familiar" : "ledger")}
        aria-pressed={view === "ledger"}
        data-testid="ledger-toggle"
        style={{ borderLeft: `2px solid ${view === "ledger" ? "var(--brass)" : "transparent"}` }}
        className={`w-full py-1.5 pl-2.5 pr-3 text-left text-base transition-colors duration-150 ${
          view === "ledger" ? "bg-void text-bone" : "text-bone-dim hover:text-bone"
        }`}
      >
        Ledger of ink
      </button>
      <Rule />
      <button
        type="button"
        onClick={() => setView(view === "seals" ? "familiar" : "seals")}
        aria-pressed={view === "seals"}
        data-testid="seal-rail"
        style={{ borderLeft: `2px solid ${view === "seals" ? "var(--brass)" : "transparent"}` }}
        className={`w-full px-3 py-2 text-left transition-colors duration-150 ${
          view === "seals" ? "bg-void" : "hover:bg-void/60"
        }`}
      >
        <span className="mb-1 block text-xs text-bone-dim">Seals</span>
        <span
          className={`block text-base ${seals > 0 ? "text-brass-text" : "text-bone-dim"}`}
          data-seal-count={seals}
        >
          {seals > 0 ? `${seals} waiting` : "none waiting"}
        </span>
      </button>
    </nav>
  );
}
