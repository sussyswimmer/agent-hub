import { Rule, Sigil } from "@/ui";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";

function RosterRow({ familiar, selected, onSelect }: { familiar: FamiliarSummary; selected: boolean; onSelect: () => void }) {
  const broken = familiar.error !== null;
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
        <span className={`display block truncate text-base ${broken ? "text-oxblood-text" : "text-bone"}`}>{familiar.name}</span>
        <span className={`block truncate text-xs ${broken ? "text-oxblood-text" : "text-bone-dim"}`} data-status>
          {broken ? familiar.error : familiar.status}
        </span>
      </span>
    </button>
  );
}

export function Roster({ seals = 0 }: { seals?: number }) {
  const { familiars, selected, select, ready } = useStore();
  return (
    <nav style={{ width: "var(--rail)" }}
      className="flex h-full shrink-0 flex-col bg-panel" aria-label="Roster" data-testid="roster">
      {/* room for the traffic lights under an overlay title bar */}
      <div className="h-9 shrink-0" data-tauri-drag-region />
      <div className="flex-1 overflow-y-auto rule-scroll">
        {familiars.map((f) => (
          <RosterRow key={f.id} familiar={f} selected={f.id === selected} onSelect={() => select(f.id)} />
        ))}
        {ready && familiars.length === 0 && (
          <p className="px-3 py-4 text-xs text-bone-dim">
            No familiars bound yet. Drop a <span className="mono">.binding.md</span> in{" "}
            <span className="mono">~/.grimoire/bindings</span>.
          </p>
        )}
      </div>
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
