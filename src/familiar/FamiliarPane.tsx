import { useCallback, useEffect, useState } from "react";

import { Rule, Sigil } from "@/ui";
import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { Commission, FamiliarSummary, Tab } from "@/lib/types";

import { FloorToggle } from "@/scriptorium/Scriptorium";

import { AetherBar } from "./AetherBar";
import { Codex } from "./Codex";
import { Intake, type Answers, type How } from "./Intake";
import { Now } from "./Now";
import { Queue } from "./Queue";
import { Terminal } from "./Terminal";
import { Wards } from "./Wards";

const TABS: Tab[] = ["commission", "terminal", "outputs", "codex", "wards"];

/** What each tab is for, in plain words. Shown on hover and read out with the tab (§3: the nouns
 * stay canonical; this says what they mean). */
export const TAB_HINTS: Record<Tab, string> = {
  commission: "Give this familiar a task, and see what it is working on",
  terminal: "Watch it work, and type to it directly",
  outputs: "Where what it makes ends up",
  codex: "What it remembers between commissions",
  wards: "Commissions that repeat on a schedule",
};

function Header({
  familiar,
  live,
  onSummon,
  onBanish,
  toggle,
}: {
  familiar: FamiliarSummary;
  live: boolean;
  onSummon: () => void;
  onBanish: () => void;
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
        {/* It does what it says: Summon summons and opens the terminal; Banish stops the familiar.
            It used to only switch to the terminal tab, where a second Summon waited. */}
        <button
          type="button"
          onClick={live ? onBanish : onSummon}
          disabled={!live && (familiar.cannot_summon !== null || familiar.error !== null)}
          title={
            live
              ? `Stop ${familiar.name}. A commission it is working on ends as banished.`
              : (familiar.cannot_summon ?? familiar.error ?? `Start ${familiar.name} in a terminal`)
          }
          data-testid="summon"
          data-live={live || undefined}
          className="h-7 rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-void disabled:cursor-not-allowed disabled:text-bone-dim disabled:hover:bg-transparent"
        >
          {live ? "Banish" : "Summon"}
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
  const { tab, setTab, setView, commissionsChanged, noteCommissionsChanged, summonAndWatch } = useStore();
  // Out of the one map the floor reads too, so the bar and the arc cannot disagree (§10).
  const aether = useStore((st) => st.aether.get(familiar.id) ?? null);
  const live = useStore((st) => st.live.has(familiar.id));
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [placeError, setPlaceError] = useState<string | null>(null);
  // What just happened, said under the line that says what the familiar is doing — where the
  // eye already is — rather than under a form that may be taller than the pane.
  const [notice, setNotice] = useState<string | null>(null);
  const [doneError, setDoneError] = useState<string | null>(null);
  // Once this familiar's terminal has been opened it stays mounted, hidden, while other tabs are
  // looked at. A pty is a stream: output that arrives with no terminal attached is gone, and
  // without this, a commission handed over from the commission tab was typed into a terminal
  // nobody was keeping, and the terminal tab then opened on "reattached", blank.
  const [terminalFor, setTerminalFor] = useState<string | null>(tab === "terminal" ? familiar.id : null);
  useEffect(() => {
    if (tab === "terminal") setTerminalFor(familiar.id);
  }, [tab, familiar.id]);
  const keepTerminal = tab === "terminal" || terminalFor === familiar.id;

  const refresh = useCallback(async () => {
    try {
      const b = await backend();
      setCommissions(await b.commissionsFor(familiar.id));
    } catch {
      // The queue is a view of the truth, not the truth. A failed read leaves the last one up
      // rather than blanking the pane.
    }
  }, [familiar.id]);

  // Re-read when the tab is opened, whenever a summoning starts or ends, and whenever the
  // familiar's state moves, so what is on screen is what is actually happening rather than what
  // was true when the pane mounted.
  useEffect(() => {
    if (tab === "commission") void refresh();
  }, [refresh, tab, commissionsChanged, familiar.state, live]);

  // A notice belongs to the familiar it was about.
  useEffect(() => {
    setNotice(null);
    setPlaceError(null);
    setDoneError(null);
  }, [familiar.id]);

  const current = commissions.find((c) => c.status === "running" || c.status === "awaiting_seal") ?? null;
  const waiting = commissions.filter((c) => c.status === "queued").length;
  const summonable = familiar.cannot_summon === null && familiar.error === null;
  // The button says what pressing it does, for this familiar, now.
  const primary = !live ? (summonable ? "Summon and start" : "Queue it") : current ? "Add to queue" : "Start";
  const secondary = !live && summonable ? "Queue for later" : undefined;

  async function place(prompt: string, answers: Answers, how: How): Promise<boolean> {
    setPlaceError(null);
    setDoneError(null);
    setNotice(null);
    try {
      const b = await backend();
      const row = await b.commissionCreate(familiar.id, prompt, answers);
      if (!live && summonable && how === "primary") {
        // The terminal summons it, so nothing it says on the way up is lost; the summoning
        // takes the oldest commission in the queue, which is this one unless others are waiting.
        summonAndWatch(familiar.id);
        return true;
      }
      noteCommissionsChanged();
      await refresh();
      setNotice(
        row.status === "running"
          ? `Started. ${familiar.name} has it now.`
          : live
            ? `Queued. ${familiar.name} starts on it when you mark the current one done.`
            : `Queued. ${familiar.name} starts on it when you summon it.`,
      );
      return true;
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function markDone() {
    setPlaceError(null);
    setDoneError(null);
    setNotice(null);
    try {
      const b = await backend();
      const next = await b.commissionDone(familiar.id);
      noteCommissionsChanged();
      await refresh();
      setNotice(
        next
          ? `Marked done. ${familiar.name} has started on the next one.`
          : `Marked done. ${familiar.name} is free for another commission.`,
      );
    } catch (e) {
      setDoneError(e instanceof Error ? e.message : String(e));
    }
  }

  async function banish() {
    setPlaceError(null);
    try {
      const b = await backend();
      await b.banish(familiar.id);
      noteCommissionsChanged();
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
        live={live}
        onSummon={() => summonAndWatch(familiar.id)}
        onBanish={() => void banish()}
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
              title={TAB_HINTS[t]}
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
        ) : tab === "terminal" ? null : tab === "commission" ? (
          <>
            <Now
              familiar={familiar}
              live={live}
              current={current}
              waiting={waiting}
              onWatch={() => setTab("terminal")}
              onDone={() => void markDone()}
              onSeals={() => setView("seals")}
            />
            {doneError && (
              <p className="measure -mt-2 mb-4 text-base text-oxblood-text" data-testid="done-error">
                {doneError}
              </p>
            )}
            {notice && (
              <p className="measure -mt-2 mb-4 text-base text-verdigris-text" role="status" data-testid="commission-notice">
                {notice}
              </p>
            )}
            <Intake
              key={familiar.id}
              familiar={familiar}
              onSubmit={place}
              primary={primary}
              {...(secondary ? { secondary } : {})}
            />
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
          <p className="measure text-base text-bone-dim" data-testid="outputs">
            What {familiar.name} makes is written into its workspace,{" "}
            <span className="mono text-xs">{familiar.workspace}</span>. Watch the terminal to see it happen; a list of
            what changed arrives with a later phase.
          </p>
        )}
        {!familiar.error && keepTerminal && (
          // Keyed on the familiar so switching in the rail builds a fresh terminal rather than
          // showing one familiar's scrollback under another's name.
          <div className={tab === "terminal" ? "flex min-h-0 flex-1 flex-col" : "hidden"} data-testid="terminal-keep">
            <Terminal key={familiar.id} familiar={familiar} />
          </div>
        )}
      </section>
      <AetherBar aether={aether} />
    </section>
  );
}
