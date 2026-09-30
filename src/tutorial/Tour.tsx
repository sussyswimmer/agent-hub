import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useStore } from "@/store";

import { STEPS, type Step } from "./steps";

/** Room left around what a step points at, so the ring does not sit on its edge. */
const PAD = 6;
const CARD_WIDTH = 340;
const MARGIN = 16;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function measure(step: Step | undefined): Box | null {
  if (!step?.anchor) return null;
  const el = document.querySelector(step.anchor);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Beside the ring where there is room — right, then below, then above — else in the middle. */
function place(ring: Box | null, card: { width: number; height: number }): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (t: number) => Math.min(Math.max(MARGIN, t), vh - card.height - MARGIN);
  const clampLeft = (l: number) => Math.min(Math.max(MARGIN, l), vw - card.width - MARGIN);
  if (!ring) return { left: (vw - card.width) / 2, top: Math.max(MARGIN, (vh - card.height) / 2) };
  if (ring.left + ring.width + MARGIN + card.width <= vw - MARGIN) {
    return { left: ring.left + ring.width + MARGIN, top: clampTop(ring.top) };
  }
  if (ring.top + ring.height + MARGIN + card.height <= vh - MARGIN) {
    return { left: clampLeft(ring.left), top: ring.top + ring.height + MARGIN };
  }
  if (ring.top - MARGIN - card.height >= MARGIN) {
    return { left: clampLeft(ring.left), top: ring.top - MARGIN - card.height };
  }
  return { left: (vw - card.width) / 2, top: Math.max(MARGIN, (vh - card.height) / 2) };
}

/**
 * The guided tour: a ring around one thing on screen and a card beside it saying what it is and
 * what to do with it. Everything else is dimmed and cannot be clicked while it is open, so the
 * tour cannot be left pointing at something that has gone.
 *
 * It moves only when a button is pressed (§7.4: the one ambient motion is the sigil's), so there
 * is nothing here for reduced motion to take away.
 */
export function Tour() {
  const step = useStore((s) => s.tour);
  const setTour = useStore((s) => s.setTour);
  const endTour = useStore((s) => s.endTour);
  const [ring, setRing] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH, height: 220 });
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // Which way the owner is going, so a step with nothing to point at is passed over in the
  // direction they were already moving rather than bouncing them back.
  const heading = useRef<1 | -1>(1);

  const current = step === null ? undefined : STEPS[step];

  // Open what the step needs before looking for it.
  useEffect(() => {
    if (!current?.needs) return;
    const s = useStore.getState();
    if (current.needs === "familiar") {
      const id = s.selected ?? s.familiars[0]?.id ?? null;
      if (id && (s.selected !== id || s.view !== "familiar")) s.select(id);
      if (current.id !== "terminal" && current.id !== "aether" && s.tab !== "commission") s.setTab("commission");
    }
  }, [current]);

  const look = useCallback(() => {
    setRing(measure(current));
    if (card.current) {
      const r = card.current.getBoundingClientRect();
      setCardSize((was) => (was.height === r.height && was.width === r.width ? was : { width: r.width, height: r.height }));
    }
  }, [current]);

  // Where the step's thing is: now, after the pane it needs has had a frame to open, and again
  // whenever the window moves under it. A step whose thing is not there is passed over when it
  // says it may be, and otherwise shown in the middle.
  useLayoutEffect(() => {
    if (step === null || !current) return;
    let alive = true;
    const settle = window.setTimeout(() => {
      if (!alive) return;
      const found = measure(current);
      const noFamiliars = current.needs === "familiar" && useStore.getState().familiars.length === 0;
      if ((current.optional && !found) || noFamiliars) {
        const to = step + heading.current;
        if (to >= 0 && to < STEPS.length) setTour(to);
        else endTour();
        return;
      }
      look();
      next.current?.focus();
    }, 60);
    look();
    const tick = window.setInterval(look, 300);
    window.addEventListener("resize", look);
    return () => {
      alive = false;
      window.clearTimeout(settle);
      window.clearInterval(tick);
      window.removeEventListener("resize", look);
    };
  }, [step, current, look, setTour, endTour]);

  function go(by: 1 | -1) {
    if (step === null) return;
    heading.current = by;
    const to = step + by;
    if (to >= STEPS.length) endTour();
    else if (to >= 0) setTour(to);
  }

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (step === null || !current) return null;

  const last = step === STEPS.length - 1;

  const at = place(ring, cardSize);

  return (
    <div className="fixed inset-0 z-50" data-testid="tour" data-step={current.id}>
      {ring ? (
        <div
          aria-hidden
          data-testid="tour-ring"
          className="pointer-events-none fixed border border-brass"
          style={{
            left: ring.left,
            top: ring.top,
            width: ring.width,
            height: ring.height,
            boxShadow: "0 0 0 9999px rgb(20 19 26 / 0.78)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0" style={{ background: "rgb(20 19 26 / 0.78)" }} />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed flex flex-col gap-3 border border-rule bg-panel p-4"
        style={{ left: at.left, top: at.top, width: CARD_WIDTH }}
      >
        <p className="text-xs text-bone-dim" data-testid="tour-count">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="display text-md text-bone">
          {current.title}
        </h2>
        <p id="tour-body" className="text-base text-bone-dim">
          {current.body}
        </p>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={endTour}
            data-testid="tour-skip"
            className="h-7 rounded-mark px-1 text-base text-bone-dim transition-colors duration-150 hover:text-bone"
          >
            {last ? "Close" : "Skip the tour"}
          </button>
          <span className="ml-auto" />
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              data-testid="tour-back"
              className="h-7 rounded-mark border border-rule px-3 text-base text-bone-dim transition-colors duration-150 hover:bg-void hover:text-bone"
            >
              Back
            </button>
          )}
          <button
            ref={next}
            type="button"
            onClick={() => go(1)}
            data-testid="tour-next"
            className="h-7 rounded-mark border border-brass px-3 text-base text-bone transition-colors duration-150 hover:bg-void"
          >
            {last ? "Done" : step === 0 ? "Show me" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
