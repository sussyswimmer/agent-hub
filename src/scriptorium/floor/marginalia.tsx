// The hover card (§8.5): name, order, what it is working on, its three meters, elapsed time.
//
// DOM, not Pixi, and deliberately. Text in a canvas is a picture of text — unselectable,
// unreadable to a screen reader, and re-rasterised at every zoom. The card is also the one place
// on the floor with a paragraph's worth of reading in it, which is exactly what the DOM is for.

import type { Aether, FamiliarSummary } from "@/lib/types";
import { Meter } from "@/ui";

export interface Marginalia {
  familiar: FamiliarSummary;
  aether: Aether | null;
  /** What it is working on, when it is working on anything. */
  commission: string | null;
  /** Seconds since the commission started. */
  elapsed: number | null;
  /** Where the sigil is, in pixels inside the floor. */
  at: { x: number; y: number };
}

function clock(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function MarginaliaCard({ familiar, aether, commission, elapsed, at }: Marginalia) {
  return (
    <div
      // Pinned beside the sigil, nudged clear of it. `pointer-events: none` because a card that
      // can be hovered can steal the hover that produced it and then flicker for ever.
      className="pointer-events-none absolute z-10 w-64 border border-rule bg-panel px-3 py-2"
      style={{ left: at.x + 30, top: at.y - 10 }}
      data-testid="marginalia"
      data-familiar={familiar.id}
      role="tooltip"
    >
      <p className="display text-base text-bone">{familiar.name}</p>
      <p className="text-xs text-bone-dim">
        {familiar.order}
        {elapsed !== null && ` · ${clock(elapsed)}`}
      </p>

      <p className="measure pt-1 text-xs text-bone-dim" data-testid="marginalia-doing">
        {commission ?? familiar.status}
      </p>

      {aether && (
        <div className="flex flex-col gap-1 pt-2" data-testid="marginalia-aether">
          <Meter label="tokens" value={aether.tokens} max={aether.tokens_max} />
          <Meter label="turns" value={aether.turns} max={aether.turns_max} />
          <Meter label="minutes" value={Math.round(aether.seconds / 60)} max={aether.seconds_max ? Math.round(aether.seconds_max / 60) : null} />
        </div>
      )}
    </div>
  );
}
