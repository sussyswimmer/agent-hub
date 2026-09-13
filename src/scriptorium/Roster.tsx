import { Rule, Sigil } from "@/ui";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";

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
  const { familiars, selected, select, ready, showLedger, setShowLedger } = useStore();
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
            selected={!showLedger && f.id === selected}
            onSelect={() => select(f.id)}
          />
        ))}
        {ready && familiars.length === 0 && (
          <p className="px-3 py-4 text-xs text-bone-dim">
            No familiars bound yet. Drop a <span className="mono">.binding.md</span> in{" "}
            <span className="mono">~/.grimoire/bindings</span>.
          </p>
        )}
      </div>
      <Rule />
      {/* §6.9's ledger is reached from the lectern on the floor in Phase 5; until then the rail
          is the only way in, so it lives here beside the seals. */}
      <button
        type="button"
        onClick={() => setShowLedger(!showLedger)}
        aria-pressed={showLedger}
        data-testid="ledger-toggle"
        style={{ borderLeft: `2px solid ${showLedger ? "var(--brass)" : "transparent"}` }}
        className={`w-full py-1.5 pl-2.5 pr-3 text-left text-base transition-colors duration-150 ${
          showLedger ? "bg-void text-bone" : "text-bone-dim hover:text-bone"
        }`}
      >
        Ledger of ink
      </button>
      <Rule />
      <div className="px-3 py-2" data-testid="seal-rail">
        <div className="mb-1 text-xs text-bone-dim">Seals</div>
        {seals > 0 ? (
          <button type="button" className="text-base text-brass-text hover:underline" data-seal-count={seals}>
            {seals} waiting
          </button>
        ) : (
          <span className="text-base text-bone-dim" data-seal-count={0}>
            none waiting
          </span>
        )}
      </div>
    </nav>
  );
}
