import type { Commission, FamiliarSummary } from "@/lib/types";

/**
 * One sentence at the top of the commission tab saying what this familiar is doing and what the
 * button below it will do, with the one or two things that can be done about it right now.
 *
 * Written because the owner, on first use, could not tell how to get a familiar to do anything:
 * the commission tab queued work and said nothing, the header's Summon only changed tab, and a
 * commission placed on a summoned familiar waited for a summon that had already happened. The
 * nouns stay canonical (§3); the sentence says what they mean.
 */
export function Now({
  familiar,
  live,
  current,
  waiting,
  onWatch,
  onDone,
  onSeals,
}: {
  familiar: FamiliarSummary;
  live: boolean;
  /** The commission it is working on, if any. */
  current: Commission | null;
  /** How many are queued behind it. */
  waiting: number;
  onWatch: () => void;
  onDone: () => void;
  onSeals: () => void;
}) {
  const name = familiar.name;
  const line = waiting > 0 ? ` ${waiting} more ${waiting === 1 ? "is" : "are"} waiting in line.` : "";

  let text: React.ReactNode;
  let actions: React.ReactNode = null;

  if (familiar.cannot_summon) {
    text = `${name} cannot be summoned: ${familiar.cannot_summon}`;
  } else if (!live && familiar.workspace_missing) {
    text = (
      <>
        {name} is resting, and needs a folder to work in before it can be summoned. Anything you give it now waits in
        its queue.{line}
      </>
    );
  } else if (!live) {
    text = (
      <>
        {name} is resting. Say what you want done below and press <em>Summon and start</em>: {name} opens in a
        terminal and gets to work on it straight away.{line}
      </>
    );
  } else if (current?.status === "awaiting_seal") {
    text = <>{name} is waiting on your seal before it goes any further.{line}</>;
    actions = (
      <Action onClick={onSeals} testid="now-seals" strong>
        Open the seals
      </Action>
    );
  } else if (current) {
    text = (
      <>
        {name} is working on{" "}
        <q className="text-bone" title={current.prompt}>
          {short(current.prompt)}
        </q>
        . Tell it something below to steer it. When it has finished, mark it done and {name} starts on the next
        one.{line}
      </>
    );
    actions = (
      <>
        <Action onClick={onWatch} testid="now-watch">
          Watch it work
        </Action>
        <Action onClick={onDone} testid="commission-done" strong>
          Mark done
        </Action>
      </>
    );
  } else {
    text = (
      <>
        {name} is summoned and free. Say what you want done and press <em>Start</em>.{line}
      </>
    );
    actions = (
      <Action onClick={onWatch} testid="now-watch">
        Open the terminal
      </Action>
    );
  }

  return (
    <div className="measure mb-5 flex flex-col gap-2 border-l-2 border-rule pl-3" data-testid="now" data-live={live || undefined}>
      <p className="text-base text-bone-dim" data-testid="now-text">
        {text}
      </p>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

function Action({
  onClick,
  testid,
  strong = false,
  children,
}: {
  onClick: () => void;
  testid: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`h-7 rounded-mark border px-3 text-base transition-colors duration-150 hover:bg-panel ${
        strong ? "border-brass text-bone" : "border-rule text-bone-dim hover:text-bone"
      }`}
    >
      {children}
    </button>
  );
}

/** The commission's first line, cut at a word near 120 characters. The whole of it is on hover. */
function short(prompt: string): string {
  const first = prompt.trim().split("\n")[0] ?? "";
  if (first.length <= 120 && first.length === prompt.trim().length) return first;
  if (first.length <= 120) return `${first}…`;
  const cut = first.slice(0, 120);
  return `${cut.slice(0, Math.max(60, cut.lastIndexOf(" ")))}…`;
}
