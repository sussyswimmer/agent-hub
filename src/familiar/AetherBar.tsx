import { Meter, Rule } from "@/ui";
import type { Aether } from "@/lib/types";

function minutes(v: number, max: number | null): string {
  const m = Math.round(v / 60);
  return max ? `${m} / ${Math.round(max / 60)} min` : `${m} min`;
}

function thousands(v: number, max: number | null): string {
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  return max ? `${k(v)} / ${k(max)}` : k(v);
}

/** How far through the tightest of the three budgets, or 0 where none is set. */
export function pressure(aether: Aether | null): number {
  if (!aether) return 0;
  const of = (used: number, max: number | null) => (max && max > 0 ? used / max : 0);
  return Math.max(
    of(aether.tokens, aether.tokens_max),
    of(aether.turns, aether.turns_max),
    of(aether.seconds, aether.seconds_max),
  );
}

/** Pinned to the bottom of the right pane, visible while a commission runs (§7.5). */
export function AetherBar({ aether }: { aether: Aether | null }) {
  // §6.5: "At 80% of any budget: the card's rule turns brass." The rule rather than the meter,
  // because the meter is already saying it — this is the part you see without looking.
  const spent = pressure(aether);
  const rule = spent >= 1 ? "bg-oxblood" : spent >= 0.8 ? "bg-brass" : "";

  return (
    <div className="shrink-0" data-testid="aether" data-pressure={spent.toFixed(3)}>
      <Rule className={rule} />
      <div className="flex items-center gap-4 overflow-hidden px-4 py-2">
        <span className="shrink-0 text-xs text-bone-dim">Aether</span>
        {aether ? (
          <>
            <Meter label="tokens" value={aether.tokens} max={aether.tokens_max} format={thousands} />
            <Meter label="turns" value={aether.turns} max={aether.turns_max} />
            <Meter label="time" value={aether.seconds} max={aether.seconds_max} format={minutes} />
          </>
        ) : (
          <span className="text-xs text-bone-dim">no commission running</span>
        )}
      </div>
    </div>
  );
}
