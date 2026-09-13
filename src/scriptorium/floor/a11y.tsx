// The floor, in words (§8.7).
//
// The floor is a canvas, so to a screen reader it is a blank rectangle. This is the floor's
// actual content, offscreen, in a live region — not a summary of it and not a caption, but the
// same four questions §8.4 says the picture answers, answered in a sentence each.
//
// **It updates on state change only, never on position.** A familiar crossing the room moves
// sixty times a second and means one thing; announcing the walk would bury the fact that
// something is waiting on you under a minute of narration.

import { useEffect, useRef, useState } from "react";

import type { Aether, FamiliarSummary } from "@/lib/types";

/** What a state is, said plainly. The rail's own status line is often better, and wins. */
const SAID: Record<string, string> = {
  dormant: "dormant at the hearth",
  idle: "summoned and idle",
  working: "working",
  "awaiting-seal": "waiting for your seal",
  bound: "bound, waiting to be let on",
  stalled: "stalled",
  banished: "banished",
  misfired: "misfired",
};

export function describe(familiars: FamiliarSummary[], aether: Map<string, Aether>): string {
  if (familiars.length === 0) return "The floor is empty. No familiars are bound.";

  const lines = familiars.map((f) => {
    const where = f.state === "working" || f.state === "bound" || f.state === "stalled" ? ` at the ${f.order} desk` : "";
    const a = aether.get(f.id);
    const budget =
      a && a.tokens_max ? `, ${Math.round((a.tokens / a.tokens_max) * 100)}% of budget` : "";
    return `${f.name}, ${SAID[f.state] ?? f.state}${where}${budget}.`;
  });

  // §8.4's first question goes first, because it is the one with someone waiting on the answer.
  const waiting = familiars.filter((f) => f.state === "awaiting-seal");
  const head =
    waiting.length > 0
      ? `${waiting.length === 1 ? `${waiting[0]!.name} is` : `${waiting.length} familiars are`} waiting for your seal.`
      : "Nothing is waiting on you.";

  return [head, ...lines].join(" ");
}

/**
 * The mirror itself. Offscreen rather than hidden: `display: none` and `visibility: hidden` are
 * both skipped by screen readers, which would make this elaborately useless.
 */
export function FloorMirror({
  familiars,
  aether,
}: {
  familiars: FamiliarSummary[];
  aether: Map<string, Aether>;
}) {
  const [said, setSaid] = useState("");
  const previous = useRef("");

  // The signature is what is announced, so a re-render that changes nothing announces nothing.
  const signature = familiars.map((f) => `${f.id}:${f.state}`).join("|");

  useEffect(() => {
    const next = describe(familiars, aether);
    if (next === previous.current) return;
    previous.current = next;
    setSaid(next);
    // `aether` is intentionally not a dependency: the meters move constantly and re-announcing
    // the room every time a token is spent is the opposite of helpful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="floor-mirror"
      className="absolute h-px w-px overflow-hidden"
      style={{ clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" }}
    >
      {said}
    </div>
  );
}
