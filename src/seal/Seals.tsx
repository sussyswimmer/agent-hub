import { useCallback, useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { Resolution, Seal, SealKind } from "@/lib/types";
import { Rule, Sigil } from "@/ui";

/**
 * The seal queue (§6.4).
 *
 * Each request shows the familiar, the exact action, the exact target, and what is about to be
 * written where there is anything. Three answers: seal it, seal it and stop asking for this
 * commission, or refuse — and a refusal goes back to the familiar as a message it can act on.
 *
 * **Nothing here decides anything.** The buttons send an answer to Rust, which is where the
 * gate lives (§11). A familiar blocked on a request is waiting on the socket, not on this view,
 * so a closed window does not let anything through.
 */

/** Oxblood for the two that destroy or leave the machine; brass for the rest. */
const TONE: Record<SealKind, string> = {
  write: "text-brass-text",
  shell: "text-brass-text",
  network: "text-slate-text",
  destructive: "text-oxblood-text",
  send: "text-oxblood-text",
  reliquary: "text-brass-text",
  proposal: "text-slate-text",
  // The breaker's two. Brass, because both are the aether running out rather than a familiar
  // reaching for something it should not have (§6.5).
  extend: "text-brass-text",
  stalled: "text-brass-text",
};

const KIND_LABEL: Record<SealKind, string> = {
  write: "write",
  shell: "command",
  network: "network",
  destructive: "destructive",
  send: "sends outward",
  reliquary: "shared memory",
  proposal: "proposed commission",
  extend: "out of aether",
  stalled: "stalled",
};

function waiting(raised: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - raised);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  // §6.4 gives thirty minutes before it times out into bind, so the clock matters here.
  return `${minutes} min ago${minutes >= 25 ? " · times out soon" : ""}`;
}

function Request({
  seal,
  onDecide,
  busy,
}: {
  seal: Seal;
  onDecide: (id: string, resolution: Resolution) => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 border-t border-rule py-4 first:border-t-0" data-seal={seal.id} data-kind={seal.kind}>
      <div className="flex items-baseline gap-2">
        <Sigil name={seal.familiar_name} order="compass" state="awaiting-seal" size={18} />
        <span className="display text-base text-bone">{seal.familiar_name}</span>
        <span className={`text-xs ${TONE[seal.kind]}`} data-seal-kind>
          {KIND_LABEL[seal.kind]}
        </span>
        <span className="ml-auto text-xs text-bone-dim">{waiting(seal.raised)}</span>
      </div>

      {/* The exact action and the exact target, which is what §6.4 asks the request to show. */}
      <p className="mono measure text-base text-bone" data-seal-action>
        {seal.action}
      </p>
      <p className="measure text-xs text-bone-dim" data-seal-reason>
        {seal.reason}
      </p>

      {seal.preview && (
        <pre
          className="measure max-h-48 overflow-auto rule-scroll whitespace-pre-wrap border-l-2 border-brass bg-panel p-2 text-xs text-bone-dim"
          data-seal-preview
        >
          {seal.preview}
        </pre>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(seal.id, "sealed")}
          data-seal-button="sealed"
          className="h-7 rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-panel disabled:text-bone-dim"
        >
          Seal
        </button>
        {seal.kind !== "proposal" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(seal.id, "sealed_always")}
            data-seal-button="sealed_always"
            title="For the rest of this commission only, and only for this kind of action."
            className="h-7 rounded-mark border border-rule px-3 text-base text-bone-dim transition-colors duration-150 hover:text-bone hover:bg-panel disabled:text-bone-dim"
          >
            Seal, and stop asking for this commission
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(seal.id, "refused")}
          data-seal-button="refused"
          className="h-7 rounded-mark border border-oxblood px-3 text-base text-oxblood-text transition-colors duration-150 hover:bg-panel disabled:text-bone-dim"
        >
          Refuse
        </button>
      </div>
    </li>
  );
}

export function Seals() {
  const [seals, setSeals] = useState<Seal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setSealCount = useStore((s) => s.setSealCount);

  const refresh = useCallback(async () => {
    try {
      const b = await backend();
      const pending = await b.sealsPending();
      setSeals(pending);
      setSealCount(pending.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setSealCount]);

  useEffect(() => {
    void refresh();
    let stop: (() => void) | undefined;
    void backend()
      .then((b) => b.onSealsChanged(() => void refresh()))
      .then((unsub) => {
        stop = unsub;
      });
    return () => stop?.();
  }, [refresh]);

  async function decide(id: string, resolution: Resolution) {
    setBusy(id);
    setError(null);
    try {
      const b = await backend();
      await b.sealDecide(id, resolution);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-void" data-testid="seals">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <h1 className="display text-md text-bone">Seals</h1>
        {seals && seals.length > 0 && (
          <span className="text-base text-brass-text">{seals.length} waiting</span>
        )}
      </header>
      <Rule />
      <div className="min-h-0 flex-1 overflow-y-auto rule-scroll px-4">
        {error && (
          <p className="measure py-4 text-base text-oxblood-text" data-testid="seals-error">
            {error}
          </p>
        )}
        {seals === null ? (
          <p className="py-4 text-base text-bone-dim">Reading the queue…</p>
        ) : seals.length === 0 ? (
          <p className="measure py-4 text-base text-bone-dim" data-testid="seals-empty">
            Nothing is waiting on you. Familiars stop here when they want to do something their
            binding does not let them do unasked.
          </p>
        ) : (
          <ul className="flex flex-col">
            {seals.map((s) => (
              <Request key={s.id} seal={s} onDecide={(id, r) => void decide(id, r)} busy={busy === s.id} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
