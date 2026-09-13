import { useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import type { CodexView, FamiliarSummary } from "@/lib/types";

/**
 * A familiar's codex (§6.6): the one file it keeps between commissions.
 *
 * Read-only here on purpose. The familiar writes to this file itself, and an editor in the
 * interface would be a second writer racing the first — the file is the shared thing, so it is
 * shown, and edited where it lives.
 */
export function Codex({ familiar }: { familiar: FamiliarSummary }) {
  const [codex, setCodex] = useState<CodexView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setCodex(null);
    void backend()
      .then((b) => b.codexFor(familiar.id))
      .then((c) => live && setCodex(c))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [familiar.id]);

  if (error) return <p className="measure text-base text-oxblood-text">{error}</p>;
  if (!codex) return <p className="text-base text-bone-dim">Reading the codex…</p>;

  if (codex.text.trim() === "") {
    return (
      <div className="measure flex flex-col gap-2" data-testid="codex-empty">
        <p className="text-base text-bone-dim">
          {familiar.name} has not written anything down yet. It keeps what it learns here, between
          commissions.
        </p>
        <p className="mono text-xs text-bone-dim">{codex.path}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="codex">
      <div className="flex items-baseline gap-3">
        <span className="mono text-xs text-bone-dim">{codex.path}</span>
        <span className="text-xs text-bone-dim" data-codex-words>
          {codex.words} words
        </span>
        {codex.needs_condense && (
          <span className="text-xs text-brass-text" data-codex-condense>
            long enough to be worth condensing
          </span>
        )}
      </div>
      <pre className="measure min-h-0 flex-1 overflow-auto rule-scroll whitespace-pre-wrap border border-rule bg-panel p-3 text-base text-bone">
        {codex.text}
      </pre>
    </div>
  );
}
