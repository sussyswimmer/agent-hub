import { useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import type { Estimate, LedgerSummary, Tokens } from "@/lib/types";
import { Rule } from "@/ui";

/**
 * The ledger of ink (§6.9): what has been spent, by familiar and by day.
 *
 * **Every figure of money here says it is an estimate.** §6.9: "Estimated cost is labelled as
 * estimated everywhere it appears. Never display it as a settled number, and never sum it into
 * anything that looks like a bill." There is one component that renders money, it takes an
 * `Estimate` rather than a number, and it cannot render one without the qualifier — so the rule
 * holds by construction rather than by everyone remembering.
 */
function Money({ of, testid }: { of: Estimate; testid?: string }) {
  return (
    <span className="mono whitespace-nowrap text-xs text-bone-dim" data-testid={testid} data-estimated>
      ~${of.usd < 0.01 && of.usd > 0 ? of.usd.toFixed(4) : of.usd.toFixed(2)}
      <span className="text-bone-dim"> est.</span>
    </span>
  );
}

function Count({ of }: { of: Tokens }) {
  const total = of.input + of.output + of.cache_read + of.cache_write;
  const shown = total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : `${Math.round(total / 1000)}k`;
  return <span className="mono whitespace-nowrap text-xs text-bone-dim">{total > 0 ? shown : "—"}</span>;
}

function duration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function Ledger({ names }: { names: Map<string, string> }) {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void backend()
      .then((b) => b.ledgerSummary())
      .then((s) => live && setSummary(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return <p className="measure p-4 text-base text-oxblood-text">{error}</p>;
  }
  if (!summary) {
    return <p className="p-4 text-base text-bone-dim">Reading the ledger…</p>;
  }
  if (summary.commissions === 0) {
    return (
      <p className="measure p-4 text-base text-bone-dim" data-testid="ledger-empty">
        Nothing in the ledger yet. It fills as familiars work.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rule-scroll p-4" data-testid="ledger">
      <div className="flex items-baseline gap-6 pb-3">
        <span className="text-base text-bone">
          {summary.commissions} commission{summary.commissions === 1 ? "" : "s"}
        </span>
        <span className="flex items-baseline gap-1.5 text-base text-bone-dim">
          tokens <Count of={summary.tokens} />
        </span>
        <span className="flex items-baseline gap-1.5 text-base text-bone-dim">
          spend <Money of={summary.total} testid="ledger-total" />
        </span>
      </div>
      <Rule />

      <h2 className="pt-4 pb-2 text-xs text-bone-dim">By familiar</h2>
      <table className="w-full text-left text-base">
        <tbody>
          {summary.by_familiar.map((f) => (
            <tr key={f.familiar_id} className="border-t border-rule" data-spend-familiar={f.familiar_id}>
              <td className="py-1.5 pr-4 text-bone">{names.get(f.familiar_id) ?? f.familiar_id}</td>
              <td className="py-1.5 pr-4 text-xs text-bone-dim">{f.commissions}</td>
              <td className="py-1.5 pr-4">
                <Count of={f.tokens} />
              </td>
              <td className="py-1.5 pr-4 text-xs text-bone-dim">{duration(f.seconds)}</td>
              <td className="py-1.5 text-right">
                <Money of={f.cost} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="pt-6 pb-2 text-xs text-bone-dim">By day</h2>
      <table className="w-full text-left text-base">
        <tbody>
          {summary.by_day.map((d) => (
            <tr key={d.day} className="border-t border-rule" data-spend-day={d.day}>
              <td className="mono py-1.5 pr-4 text-xs text-bone">{d.day}</td>
              <td className="py-1.5 pr-4 text-xs text-bone-dim">{d.commissions}</td>
              <td className="py-1.5 pr-4">
                <Count of={d.tokens} />
              </td>
              <td className="py-1.5 text-right">
                <Money of={d.cost} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="measure pt-6 text-xs text-bone-dim">
        Every figure here is an estimate at list prices, for comparing one run with another. It is
        not a bill, and a subscription is not billed this way.
      </p>
    </div>
  );
}
