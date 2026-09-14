import { useCallback, useEffect, useState } from "react";

import { Rule, Sigil } from "@/ui";
import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { Commission, FamiliarSummary, Tab } from "@/lib/types";

import { FloorToggle } from "@/scriptorium/Scriptorium";

import { AetherBar } from "./AetherBar";
import { Codex } from "./Codex";
import { Intake } from "./Intake";
import { Queue } from "./Queue";
import { Terminal } from "./Terminal";
import { Wards } from "./Wards";

const TABS: Tab[] = ["commission", "terminal", "outputs", "codex", "wards"];

const COMING: Record<Exclude<Tab, "terminal" | "commission" | "codex" | "wards">, string> = {
  outputs: "Outputs arrive in a later phase.",
};

function Header({
  familiar,
  onSummon,
  toggle,
}: {
  familiar: FamiliarSummary;
  onSummon: () => void;
  /** The Floor/Roster switch, shown here when the floor is not carrying it (§8.7). */
  toggle?: React.ReactNode;
}) {
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
      <div className="ml-auto flex items-center gap-3">
        {toggle}
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

export function FamiliarPane({
  familiar,
  showToggle = false,
}: {
  familiar: FamiliarSummary;
  /** True when the floor is put away, so its switch has to live somewhere (§8.7). */
  showToggle?: boolean;
}) {
  const { tab, setTab, commissionsChanged } = useStore();
  // Out of the one map the floor reads too, so the bar and the arc cannot disagree (§10).
  const aether = useStore((st) => st.aether.get(familiar.id) ?? null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await backend();
      setCommissions(await b.commissionsFor(familiar.id));
    } catch {
      // The queue is a view of the truth, not the truth. A failed read leaves the last one up
      // rather than blanking the pane.
    }
  }, [familiar.id]);

  // Re-read when the tab is opened and whenever a summoning starts or ends, so what is on
  // screen is what is actually happening rather than what was true when the pane mounted.
  useEffect(() => {
    if (tab === "commission") void refresh();
  }, [refresh, tab, commissionsChanged]);

  async function place(prompt: string, answers: Record<string, string>) {
    setPlaceError(null);
    try {
      const b = await backend();
      await b.commissionCreate(familiar.id, prompt, answers);
      await refresh();
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    // A section, not a `main`: the scriptorium around it is the window's one main landmark, and
    // the floor now sits inside it above this. Two `main` elements is one too many for a screen
    // reader and, as it happens, for any `locator("main")` that means the pane.
    <section
      aria-label={`${familiar.name}'s workspace`}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-void"
    >
      <Header
        familiar={familiar}
        onSummon={() => setTab("terminal")}
        {...(showToggle ? { toggle: <FloorToggle /> } : {})}
      />
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
        {familiar.warnings.length > 0 && (
          <ul className="measure mb-4 flex flex-col gap-1 border-l-2 border-brass pl-3" data-testid="warnings">
            {familiar.warnings.map((w) => (
              <li key={w} className="text-xs text-bone-dim">
                {w}
              </li>
            ))}
          </ul>
        )}
        {familiar.error ? (
          <div className="measure flex flex-col gap-2">
            <p className="text-base text-oxblood-text">{familiar.error}</p>
            <p className="mono text-xs text-bone-dim">{familiar.binding_path}</p>
          </div>
        ) : tab === "terminal" ? (
          // Keyed on the familiar so switching in the rail builds a fresh terminal rather than
          // showing one familiar's scrollback under another's name.
          <Terminal key={familiar.id} familiar={familiar} />
        ) : tab === "commission" ? (
          <>
            <Intake key={familiar.id} familiar={familiar} onSubmit={place} />
            {placeError && (
              <p className="measure pt-3 text-base text-oxblood-text" data-testid="commission-error">
                {placeError}
              </p>
            )}
            <Queue commissions={commissions} />
          </>
        ) : tab === "codex" ? (
          <Codex key={familiar.id} familiar={familiar} />
        ) : tab === "wards" ? (
          <Wards key={familiar.id} familiarId={familiar.id} />
        ) : (
          <p className="measure text-base text-bone-dim">
            {COMING[tab as Exclude<Tab, "terminal" | "commission" | "codex" | "wards">]}
          </p>
        )}
      </section>
      <AetherBar aether={aether} />
    </section>
  );
}
