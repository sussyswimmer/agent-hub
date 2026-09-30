import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";

/** Read a theme token as a concrete colour. xterm paints to canvas and cannot resolve `var()`. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

type Status = "dormant" | "summoning" | "live" | "ended" | "failed";

const DIM = "[2m";
const RESET = "[0m";

/** Send what is typed to the familiar. Returns the disposable xterm gives back. */
function typeInto(xterm: Xterm, id: string, b: Awaited<ReturnType<typeof backend>>) {
  const encoder = new TextEncoder();
  return xterm.onData((data) => {
    void b.sendInput(id, encoder.encode(data)).catch(() => {});
  });
}

export function Terminal({ familiar }: { familiar: FamiliarSummary }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  // Set the instant Summon is pressed, before anything is awaited. The mount effect asks the
  // backend whether this familiar is already running, and that question is in flight for as
  // long as an import and an IPC round trip take — long enough to press the button first. The
  // answer then comes back "yes", because the summon that has just started is what it found.
  const summoning = useRef(false);
  const [status, setStatus] = useState<Status>("dormant");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteCommissionsChanged = useStore((s) => s.noteCommissionsChanged);

  // Built once and kept for the life of the pane, so switching tabs does not throw away
  // scrollback. Teardown disposes it; xterm leaves a canvas behind otherwise.
  useEffect(() => {
    if (!host.current) return;

    const xterm = new Xterm({
      fontFamily: token("--font-mono", "ui-monospace, monospace"),
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10_000,
      // The WebGL and canvas renderers paint pixels, so without this the terminal's contents
      // exist nowhere a screen reader — or a test — can reach. xterm's accessibility layer
      // mirrors the buffer into a live region, which is the only route into a canvas.
      screenReaderMode: true,
      theme: {
        background: token("--ink-void", "#14131A"),
        foreground: token("--bone", "#C9BFA4"),
        cursor: token("--brass", "#B08D3F"),
        selectionBackground: token("--ink-rule", "#332F40"),
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);

    // WebGL is a real speed difference under a flood, but it is also the one addon that can
    // throw where there is no GPU — a headless runner, a VM. Canvas is the fallback and the
    // terminal is perfectly usable on it, so a failure here must never be fatal.
    void (async () => {
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        xterm.loadAddon(webgl);
      } catch {
        // Canvas renderer it is.
      }
    })();

    term.current = xterm;
    fit.fit();

    // A familiar drawing a full-screen interface keeps painting to the old geometry until it
    // is told otherwise, and the buffer tears. Tell it on every resize, not just on drag end.
    const onResize = () => {
      // Hidden behind another tab, the host has no size, and fitting to nothing would tell the
      // engine it has a zero-column screen.
      if (!host.current || host.current.clientWidth === 0) return;
      fit.fit();
      void backend()
        .then((b) => b.resizeSummoning(familiar.id, xterm.cols, xterm.rows))
        .catch(() => {});
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host.current);

    // Ask the backend whether this familiar is already running before assuming it is not.
    //
    // The pane is unmounted whenever you look at another familiar, so it remembers nothing —
    // and a summoning outlives it. Without this, walking away from a live familiar and coming
    // back showed a dormant one: the button offered to summon it, and the backend refused
    // because it was already summoned, leaving it impossible to banish from the window while
    // its engine ran on. Found by clicking away from a live Tally and back.
    //
    // Scrollback from before the re-attach is genuinely gone — a pty is a stream, not a log —
    // so the pane says so rather than pretending the blank buffer is the whole story.
    let abandoned = false;
    let typed: { dispose: () => void } | undefined;
    summoning.current = false;
    void (async () => {
      try {
        const b = await backend();
        // Most of the window is this import, so check once it has landed: when Summon was
        // pressed first, the question is no longer worth asking and the outlet stays where
        // `summon` put it.
        if (abandoned || summoning.current) return;
        // Opened by Start or Summon elsewhere, which asked for this. Claimed here, after the
        // await, and not as the effect begins: React runs a mount twice in development, and the
        // first mount has been torn down by now, so only the terminal that stays does it.
        if (useStore.getState().claimSummon(familiar.id)) {
          void summonRef.current();
          return;
        }
        const found = await b.attachSummoning(familiar.id, (e) => {
          if (e.kind === "output") {
            xterm.write(e.bytes);
          } else {
            typed?.dispose();
            setStatus("ended");
            noteCommissionsChanged();
            setNote(e.code === null ? "the summoning ended" : `the summoning ended (${e.code})`);
          }
        });
        // And again, for a click that landed while the question itself was in flight: a summon
        // begun while this was running is not a summoning to re-attach to. Taking it as one
        // wrote "reattached" over a terminal that had just started and left two `onData`
        // handlers on the same xterm — every keystroke sent to the engine twice.
        //
        // The outlet has already been swapped by the time we get here, which is harmless: it
        // writes to the same terminal, and the exit it reports is the same exit.
        if (!found || abandoned || summoning.current) return;
        typed = typeInto(xterm, familiar.id, b);
        xterm.write(`${DIM}— reattached; what came before is not shown —${RESET}\r\n`);
        setStatus("live");
      } catch {
        // A backend that cannot be reached is reported by the buttons that need it, not by a
        // pane that was only asking a question.
      }
    })();

    return () => {
      abandoned = true;
      typed?.dispose();
      observer.disconnect();
      term.current = null;
      xterm.dispose();
    };
  }, [familiar.id, noteCommissionsChanged]);

  // The latest `summon`, for the mount effect, which runs once per familiar.
  const summonRef = useRef<() => Promise<void>>(async () => {});
  summonRef.current = summon;

  async function summon() {
    const xterm = term.current;
    if (!xterm) return;
    summoning.current = true;
    setStatus("summoning");
    setError(null);
    setNote(null);

    try {
      const b = await backend();
      const typed = typeInto(xterm, familiar.id, b);

      await b.summon({
        id: familiar.id,
        engine: familiar.engine,
        args: [],
        cwd: familiar.workspace,
        cols: xterm.cols,
        rows: xterm.rows,
        onEmission: (e) => {
          if (e.kind === "output") {
            // Bytes rather than a string: xterm does the stateful UTF-8 decoding, so a
            // character split across two chunks still renders as one character.
            xterm.write(e.bytes);
          } else {
            typed.dispose();
            setStatus("ended");
            noteCommissionsChanged();
            // Reported beside the button rather than written into the buffer. The engine owns
            // the buffer and redraws it as it dies — a line appended here was simply wiped,
            // which is how this was found. The chrome is ours and stays put.
            setNote(e.code === null ? "the summoning ended" : `the summoning ended (${e.code})`);
          }
        },
      });
      setStatus("live");
      // A summoning takes the oldest queued commission, so the queue has just changed.
      noteCommissionsChanged();
      xterm.focus();
    } catch (e) {
      setStatus("failed");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function banish() {
    try {
      const b = await backend();
      await b.banish(familiar.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = status === "live" || status === "summoning";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="terminal-pane" data-status={status}>
      <div className="flex shrink-0 items-center gap-3 pb-2">
        <button
          type="button"
          onClick={busy ? banish : summon}
          disabled={familiar.cannot_summon !== null}
          title={familiar.cannot_summon ?? undefined}
          data-testid="terminal-toggle"
          className="h-7 rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-panel disabled:cursor-not-allowed disabled:text-bone-dim disabled:hover:bg-transparent"
        >
          {busy ? "Banish" : "Summon"}
        </button>
        {error ? (
          <span className="text-base text-oxblood-text" data-testid="terminal-error">
            {error}
          </span>
        ) : (
          note && (
            <span className="text-base text-bone-dim" data-testid="terminal-note">
              {note}
            </span>
          )
        )}
      </div>
      <div
        ref={host}
        data-testid="xterm-host"
        className="min-h-0 flex-1 overflow-hidden border border-rule bg-void p-2"
      />
    </div>
  );
}
