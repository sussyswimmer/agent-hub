import type { Commission, Status } from "@/lib/types";

/**
 * The commissions for one familiar (§6.2: "New commissions queue behind it, visibly").
 *
 * Visibly is the requirement. A queue that is merely correct, with nothing on screen, is
 * indistinguishable from a request that was dropped — so a queued commission says where it is in
 * the line rather than only that it is waiting.
 */

const LABEL: Record<Status, string> = {
  queued: "queued",
  running: "running",
  awaiting_seal: "waiting on your seal",
  done: "done",
  banished: "banished",
  misfired: "misfired",
};

/** Oxblood only for the two that went wrong; brass for the two that want attention. */
function tone(status: Status): string {
  switch (status) {
    case "running":
      return "text-verdigris-text";
    case "awaiting_seal":
      return "text-brass-text";
    case "banished":
    case "misfired":
      return "text-oxblood-text";
    default:
      return "text-bone-dim";
  }
}

function when(created: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - created);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

export function Queue({ commissions }: { commissions: Commission[] }) {
  if (commissions.length === 0) return null;

  // They arrive newest first; the line forms in the other direction, so the oldest queued one
  // is next and says so.
  const queued = commissions.filter((c) => c.status === "queued");
  const placeInLine = new Map(queued.map((c, i) => [c.id, queued.length - i]));

  return (
    <section className="measure mt-6 flex flex-col gap-2" data-testid="queue">
      <h2 className="text-xs text-bone-dim">Commissions</h2>
      <ul className="flex flex-col">
        {commissions.map((c) => {
          const place = placeInLine.get(c.id);
          return (
            <li
              key={c.id}
              data-commission={c.id}
              data-status={c.status}
              className="flex items-baseline gap-2 border-t border-rule py-1.5 first:border-t-0"
            >
              <span className={`shrink-0 text-xs ${tone(c.status)}`} data-commission-status>
                {LABEL[c.status]}
                {place !== undefined && place > 1 && (
                  <span className="text-bone-dim"> · {place} in line</span>
                )}
                {place === 1 && <span className="text-bone-dim"> · next</span>}
              </span>
              <span className="min-w-0 flex-1 truncate text-base text-bone" title={c.prompt}>
                {c.prompt}
              </span>
              {c.turns > 0 && (
                <span className="mono shrink-0 text-xs text-bone-dim" data-commission-turns>
                  {c.turns} turns
                </span>
              )}
              <span className="shrink-0 text-xs text-bone-dim">{when(c.created)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
