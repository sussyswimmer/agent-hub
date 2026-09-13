import { Rule, Sigil } from "@/ui";
import { useStore } from "@/store";
import type { FamiliarSummary, Tab } from "@/lib/types";

import { AetherBar } from "./AetherBar";
import { Terminal } from "./Terminal";

const TABS: Tab[] = ["commission", "terminal", "outputs", "codex"];

const COMING: Record<Exclude<Tab, "terminal">, string> = {
  commission: "Commissions arrive in Phase 3. The intake form that starts them arrives in Phase 2.",
  outputs: "Outputs arrive in Phase 3.",
  codex: "The codex arrives in Phase 3.",
};

function Header({ familiar, onSummon }: { familiar: FamiliarSummary; onSummon: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4" data-testid="pane-header">
      <Sigil name={familiar.name} order={familiar.order} state={familiar.state} size={26} />
      <h1 className="display text-md text-bone">{familiar.name}</h1>
      <span className="text-base text-bone-dim">·</span>
      <span className="text-base text-bone-dim">{familiar.order}</span>
      {familiar.workspace && (
        <>
          <span className="text-base text-bone-dim">·</span>
          <span className="mono truncate text-xs text-bone-dim" data-workspace>
            {familiar.workspace}
          </span>
        </>
      )}
      <div className="ml-auto">
        <button
          type="button"
          onClick={onSummon}
          disabled={familiar.cannot_summon !== null || familiar.error !== null}
          title={familiar.cannot_summon ?? familiar.error ?? undefined}
          data-testid="summon"
          className="h-7 rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-void disabled:cursor-not-allowed disabled:text-bone-dim disabled:hover:bg-transparent"
        >
          Summon
        </button>
      </div>
    </header>
  );
}

export function FamiliarPane({ familiar }: { familiar: FamiliarSummary }) {
  const { tab, setTab, aether } = useStore();
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-void">
      <Header familiar={familiar} onSummon={() => setTab("terminal")} />
      <Rule />
      <div role="tablist" aria-label="Familiar" className="flex shrink-0 items-center gap-1 px-4 py-2">
        {TABS.map((t, i) => (
          <span key={t} className="flex items-center gap-1">
            {i > 0 && <span className="px-1 text-bone-dim">·</span>}
            <button
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-tab={t}
              onClick={() => setTab(t)}
              className={`rounded-mark px-1 text-base transition-colors duration-150 ${
                tab === t ? "text-bone underline underline-offset-4" : "text-bone-dim hover:text-bone"
              }`}
            >
              {t}
            </button>
          </span>
        ))}
      </div>
      <section
        role="tabpanel"
        aria-label={tab}
        className={`flex min-h-0 flex-1 flex-col px-4 py-3 ${tab === "terminal" ? "" : "overflow-y-auto rule-scroll"}`}
        data-testid="tabpanel"
      >
        {familiar.error ? (
          <p className="measure text-base text-oxblood-text">{familiar.error}</p>
        ) : tab === "terminal" ? (
          // Keyed on the familiar so switching in the rail builds a fresh terminal rather than
          // showing one familiar's scrollback under another's name.
          <Terminal key={familiar.id} familiar={familiar} />
        ) : (
          <p className="measure text-base text-bone-dim">{COMING[tab as Exclude<Tab, "terminal">]}</p>
        )}
      </section>
      <AetherBar aether={aether} />
    </main>
  );
}
