// The floor, mounted (§8.8).
//
// This file owns the things React is actually good at — the element, its size, whether the tab
// is visible, and the two pieces of DOM that sit over the canvas. The drawing is everything
// else in this folder, and none of it knows React exists.

import { useCallback, useEffect, useRef, useState } from "react";

import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";

import { FloorMirror } from "./a11y";
import { type ActorInput, type Actors, createActors } from "./actors";
import { palette } from "./bake";
import { type Interaction, attachInteraction } from "./interaction";
import { MarginaliaCard } from "./marginalia";
import { type Stage, createStage } from "./stage";

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Hovered {
  familiar: FamiliarSummary;
  at: { x: number; y: number };
  commission: string | null;
  elapsed: number | null;
}

export function Floor({ familiars }: { familiars: FamiliarSummary[] }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const actors = useRef<Actors | null>(null);
  const interaction = useRef<Interaction | null>(null);
  const [ready, setReady] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // One map, held by the store and refreshed on its tick. The floor used to fetch its own,
  // which meant the arc and the pane's meters were two readings taken at different moments.
  const aether = useStore((s) => s.aether);
  const [override, setOverride] = useState<Record<string, FamiliarSummary["state"]>>({});
  const readout = useRef<HTMLDivElement>(null);

  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const reload = useStore((s) => s.load);
  const commissionsChanged = useStore((s) => s.commissionsChanged);

  // The roster as the floor sees it, with any dev override applied (§10 asks that `bound` and
  // `stalled` render before Phase 6 exists to produce them).
  const shown = familiars.map((f) => ({ ...f, state: override[f.id] ?? f.state }));

  const onHoverRef = useRef<(id: string | null, at: { x: number; y: number } | null) => void>(() => {});
  const onHover = useCallback(
    (id: string | null, at: { x: number; y: number } | null) => {
      if (!id || !at) {
        setHovered(null);
        return;
      }
      const familiar = familiars.find((f) => f.id === id);
      if (!familiar) return;
      setHovered({ familiar, at, commission: null, elapsed: null });
      // What it is working on is asked for only when someone actually looks, which is the whole
      // reason the card waits 120ms before appearing.
      void backend()
        .then((b) => b.commissionsFor(id))
        .then((rows) => {
          const running = rows.find((c) => c.status === "running" || c.status === "awaiting_seal");
          if (!running) return;
          setHovered((h) =>
            h && h.familiar.id === id
              ? { ...h, commission: running.prompt, elapsed: Math.max(0, Date.now() / 1000 - running.created) }
              : h,
          );
        })
        .catch(() => {});
    },
    [familiars],
  );
  // The stage is built once and keeps whatever callback it was handed. `onHover` is remade
  // whenever the roster changes, so the interaction layer is given a shim that reads the
  // current one rather than the one that existed when WebGL was initialised.
  onHoverRef.current = onHover;

  // Build the stage once. Everything after arrives through `sync`.
  useEffect(() => {
    let live = true;
    let built: Stage | null = null;

    void (async () => {
      if (!host.current) return;
      const p = palette();
      const s = await createStage(host.current);
      if (!live) {
        s.destroy();
        return;
      }
      built = s;
      stage.current = s;

      const a = createActors({
        actors: s.actors,
        threads: s.threads,
        palette: p,
        reducedMotion: reducedMotion(),
      });
      actors.current = a;

      interaction.current = attachInteraction(host.current, s, a, p, {
        onHover: (id, at) => onHoverRef.current(id, at),
        onSelect: (id) => select(id),
        onStation: (id) => {
          // §8.7: each of these is a door onto something the rail also opens.
          if (id === "ward") setView("seals");
          else if (id === "lectern") setView("ledger");
          else setView("familiar");
        },
        onEscape: () => {
          document.querySelector<HTMLElement>("[data-testid='roster'] [data-familiar]")?.focus();
        },
      });

      s.app.ticker.add((ticker) => {
        a.tick(ticker.deltaMS);
        a.drawThreads(ticker.deltaMS);
        interaction.current?.drawFocus();
      });

      setReady(true);
    })().catch((reason: unknown) => {
      // A GPU or WebGL failure must not turn the entire application into an endless opening
      // screen. The DOM recovery scene gives the reader their agents and a repair path even on
      // a machine that cannot initialise Pixi.
      if (live) {
        console.error("could not initialise the floor", reason);
        setStageError(reason instanceof Error ? reason.message : "The floor renderer did not start.");
      }
    });

    return () => {
      live = false;
      interaction.current?.destroy();
      actors.current?.destroy();
      built?.destroy();
      stage.current = null;
      actors.current = null;
      interaction.current = null;
    };
    // Built once for the life of the pane. `onHover` is re-made when the roster changes and is
    // re-bound below rather than tearing down a WebGL context to change a callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The room, whenever the roster or a state moves.
  useEffect(() => {
    if (!ready || !actors.current) return;
    const inputs: ActorInput[] = shown.map((f) => {
      const a = aether.get(f.id);
      return {
        id: f.id,
        name: f.name,
        order: f.order,
        state: f.state,
        spent: a && a.tokens_max ? a.tokens / a.tokens_max : null,
      };
    });
    actors.current.sync(inputs);
    // `shown` is rebuilt every render; its content is what matters, so the signature is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown.map((f) => `${f.id}:${f.state}:${f.order}`).join("|"), aether]);

  // Size. A canvas has no layout of its own, so it is told.
  useEffect(() => {
    if (!ready || !host.current) return;
    const element = host.current;
    const observer = new ResizeObserver(() => {
      stage.current?.resize(element.clientWidth, element.clientHeight);
    });
    observer.observe(element);
    stage.current?.resize(element.clientWidth, element.clientHeight);
    return () => observer.disconnect();
  }, [ready]);

  const restoreStarterCircle = useCallback(async () => {
    setRestoring(true);
    try {
      await (await backend()).workbenchRestoreBindings();
      await reload();
    } finally {
      setRestoring(false);
    }
  }, [reload]);

  /**
   * Put the ticker's own numbers where they can be read.
   *
   * §10 asks for 60fps "measured with the Pixi ticker's own FPS readout, not by feel", and for
   * no frames at all while the floor is hidden. Neither is answerable from outside the module
   * unless the module says so, and neither is answerable honestly by watching. Written straight
   * to the element's attributes rather than through state, because a render per frame to report
   * the frame rate would be measuring the measurement.
   */
  useEffect(() => {
    if (!ready) return;
    const write = () => {
      const s = stage.current?.stats;
      const element = readout.current;
      if (!s || !element) return;
      element.dataset["fps"] = String(Math.round(s.fps));
      element.dataset["frames"] = String(s.frames);
      element.dataset["running"] = s.running ? "true" : "false";
    };
    write();
    const timer = setInterval(write, 250);
    return () => clearInterval(timer);
  }, [ready]);

  // §8.6: focused 60, unfocused 20, hidden nothing at all.
  useEffect(() => {
    if (!ready) return;
    const onFocus = () => stage.current?.setFocused(true);
    const onBlur = () => stage.current?.setFocused(false);
    const onVisibility = () => stage.current?.setVisible(!document.hidden);
    addEventListener("focus", onFocus);
    addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    stage.current?.setFocused(document.hasFocus());
    stage.current?.setVisible(!document.hidden);
    return () => {
      removeEventListener("focus", onFocus);
      removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready]);

  return (
    // `min-w-0` is load-bearing, not tidiness. A flex child's default `min-width: auto` refuses
    // to shrink below its content, and the canvas Pixi inserts has a size of its own before the
    // first resize lands — so without this the floor props the whole window open and the
    // scriptorium scrolls sideways at 1024px.
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="floor" data-ready={ready}>
      <div
        ref={host}
        tabIndex={0}
        role="application"
        aria-label="The floor of the tower. Tab moves between familiars; Escape returns to the roster."
        data-testid="floor-canvas"
        className="floor-canvas--higgs block h-full w-full max-w-full overflow-hidden outline-none"
      />
      {(stageError || familiars.length === 0) && (
        <FloorRecovery
          failed={stageError !== null}
          restoring={restoring}
          onRestore={() => void restoreStarterCircle()}
        />
      )}
      {hovered && (
        <MarginaliaCard
          familiar={hovered.familiar}
          aether={aether.get(hovered.familiar.id) ?? null}
          commission={hovered.commission}
          elapsed={hovered.elapsed}
          at={hovered.at}
        />
      )}
      <div ref={readout} data-testid="floor-stats" className="hidden" aria-hidden="true" />
      <FloorMirror familiars={shown} aether={aether} />
      {import.meta.env.DEV && <StateOverride familiars={familiars} value={override} onChange={setOverride} />}
    </div>
  );
}

function FloorRecovery({ failed, restoring, onRestore }: { failed: boolean; restoring: boolean; onRestore: () => void }) {
  return (
    <section className="floor-recovery" aria-live="polite">
      <div className="floor-recovery__grain" aria-hidden="true" />
      <div className="floor-recovery__constellation floor-recovery__constellation--one" aria-hidden="true" />
      <div className="floor-recovery__constellation floor-recovery__constellation--two" aria-hidden="true" />
      <div className="floor-recovery__orbit floor-recovery__orbit--outer" aria-hidden="true" />
      <div className="floor-recovery__orbit floor-recovery__orbit--inner" aria-hidden="true" />
      <div className="floor-recovery__party" aria-hidden="true">
        {[
          ["quill", "Scribe"],
          ["lantern", "Scout"],
          ["crucible", "Maker"],
          ["compass", "Guide"],
          ["ledger", "Keeper"],
        ].map(([order, name], index) => (
          <div className="floor-recovery__familiar" data-order={order} style={{ "--i": index } as React.CSSProperties} key={order}>
            <i className="floor-recovery__head" />
            <i className="floor-recovery__body" />
            <span>{name}</span>
          </div>
        ))}
      </div>
      <div className="floor-recovery__copy">
        <p className="mono floor-recovery__eyebrow">GRIMOIRE / FIRST LIGHT</p>
        <h2>{failed ? "The tower lost its lens." : "The tower is waiting for its circle."}</h2>
        <p>
          {failed
            ? "Your Mac can still restore the familiar roster while the animated floor takes its safer route."
            : "Five starter familiars are ready to be placed around the hearth."}
        </p>
        <button type="button" onClick={onRestore} disabled={restoring}>
          {restoring ? "Calling the circle..." : "Restore starter circle"}
        </button>
      </div>
    </section>
  );
}

/**
 * A dev-only way to put a familiar into a state nothing yet produces.
 *
 * §10 asks that `bound` and `stalled` render as specified in this phase even though the breaker
 * that causes them is Phase 6. Driving them from here means they are drawn and looked at now,
 * rather than written blind and discovered to be wrong in three phases' time. It is behind
 * `import.meta.env.DEV`, so it is not in the packaged application at all.
 */
function StateOverride({
  familiars,
  value,
  onChange,
}: {
  familiars: FamiliarSummary[];
  value: Record<string, FamiliarSummary["state"]>;
  onChange: (next: Record<string, FamiliarSummary["state"]>) => void;
}) {
  const states: FamiliarSummary["state"][] = [
    "dormant",
    "idle",
    "working",
    "awaiting-seal",
    "bound",
    "stalled",
    "banished",
    "misfired",
  ];
  return (
    <details className="absolute bottom-2 left-2 border border-rule bg-panel px-2 py-1" data-testid="floor-override">
      <summary className="cursor-pointer text-xs text-bone-dim">states (dev)</summary>
      <div className="flex flex-col gap-1 pt-2">
        {familiars.map((f) => (
          <label key={f.id} className="flex items-center gap-2 text-xs text-bone-dim">
            <span className="w-20">{f.name}</span>
            <select
              className="h-6 rounded-mark border border-rule bg-void px-1 text-xs text-bone"
              value={value[f.id] ?? f.state}
              data-override={f.id}
              onChange={(e) => onChange({ ...value, [f.id]: e.target.value as FamiliarSummary["state"] })}
            >
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" className="text-xs text-brass-text" onClick={() => onChange({})}>
          clear
        </button>
      </div>
    </details>
  );
}
