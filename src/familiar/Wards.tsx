import { useCallback, useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import type { Ward } from "@/lib/types";
import { Rule } from "@/ui";

/**
 * Standing wards (§6.7): a schedule, a prompt, and what happened last time.
 *
 * The prompt is shown as stored and never as a preview of something else, because that is the
 * whole promise a ward makes — what it sends next month is byte-for-byte what you read when you
 * wrote it. §6.7: no drift, no "improve the prompt" logic.
 */

/** A crontab expression in words, for the common shapes. Falls back to the expression itself. */
function inWords(cron: string): string {
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/);
  const at = (h: string, m: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // The interval shapes first: `*/15 * * * *` also satisfies the daily test below, and would
  // fall through it to the raw expression.
  if (minute?.startsWith("*/") && hour === "*") return `every ${minute.slice(2)} minutes`;
  if (minute === "0" && hour?.startsWith("*/")) return `every ${hour.slice(2)} hours`;

  if (dom === "*" && month === "*" && minute && hour && /^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    if (dow === "*") return `every day at ${at(hour, minute)}`;
    if (dow === "1-5") return `every weekday at ${at(hour, minute)}`;
    const day = days[Number(dow)];
    if (day) return `every ${day} at ${at(hour, minute)}`;
  }
  return cron;
}

function when(at: number | null): string {
  if (at === null) return "never";
  const seconds = Math.floor(Date.now() / 1000) - at;
  const ago = seconds >= 0;
  const n = Math.abs(seconds);
  const say = n < 60 ? "less than a minute" : n < 3600 ? `${Math.floor(n / 60)} min` : n < 86_400 ? `${Math.floor(n / 3600)}h` : `${Math.floor(n / 86_400)}d`;
  return ago ? `${say} ago` : `in ${say}`;
}

function Row({ ward, onChange }: { ward: Ward; onChange: () => void }) {
  return (
    <li className="flex flex-col gap-1 border-t border-rule py-3 first:border-t-0" data-ward={ward.id}>
      <div className="flex items-baseline gap-2">
        <span className="mono text-base text-bone" data-ward-cron>
          {ward.cron}
        </span>
        <span className="text-xs text-bone-dim">{inWords(ward.cron)}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-ward-toggle
            aria-pressed={ward.enabled}
            onClick={() => void backend().then((b) => b.wardSetEnabled(ward.id, !ward.enabled)).then(onChange)}
            className={`h-6 rounded-mark border border-rule px-2 text-xs transition-colors duration-150 hover:bg-void ${
              ward.enabled ? "text-bone" : "text-bone-dim"
            }`}
          >
            {ward.enabled ? "standing" : "stood down"}
          </button>
          <button
            type="button"
            data-ward-delete
            onClick={() => void backend().then((b) => b.wardDelete(ward.id)).then(onChange)}
            className="h-6 rounded-mark border border-oxblood px-2 text-xs text-oxblood-text transition-colors duration-150 hover:bg-void"
          >
            Dismiss
          </button>
        </span>
      </div>

      <pre className="measure whitespace-pre-wrap border-l-2 border-rule pl-2 text-xs text-bone-dim" data-ward-prompt>
        {ward.prompt}
      </pre>

      <p className="text-xs text-bone-dim" data-ward-last>
        {ward.last_result ?? "has not come round yet"}
        {ward.enabled && ward.next_run !== null && ` · next ${when(ward.next_run)}`}
      </p>
    </li>
  );
}

export function Wards({ familiarId }: { familiarId: string }) {
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [cron, setCron] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await backend();
      setWards(await b.wardsFor(familiarId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [familiarId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function set() {
    setError(null);
    try {
      const b = await backend();
      await b.wardCreate(familiarId, cron, prompt, {});
      setCron("");
      setPrompt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const ready = cron.trim().length > 0 && prompt.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rule-scroll" data-testid="wards">
      <div className="flex flex-col gap-2">
        <label className="measure text-base text-bone" htmlFor="ward-cron">
          Set a standing ward
        </label>
        <p className="measure text-xs text-bone-dim">
          It runs with the window closed, and sends this prompt word for word every time.
        </p>
        <input
          id="ward-cron"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="0 9 * * 1"
          data-testid="ward-cron"
          className="mono h-8 w-48 rounded-mark border border-rule bg-panel px-2 text-base text-bone"
        />
        {cron.trim() && <p className="text-xs text-bone-dim" data-testid="ward-in-words">{inWords(cron)}</p>}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="What it should do, every time."
          data-testid="ward-prompt"
          className="measure rounded-mark border border-rule bg-panel p-2 text-base text-bone"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void set()}
            data-blocked={!ready || undefined}
            aria-describedby={ready ? undefined : "ward-blocked"}
            data-testid="ward-set"
            className="h-7 w-fit rounded-mark border border-rule px-3 text-base text-bone transition-colors duration-150 hover:bg-panel"
          >
            Set the ward
          </button>
          {!ready && (
            <span id="ward-blocked" className="text-xs text-bone-dim">
              A ward needs a schedule and a prompt.
            </span>
          )}
        </div>
        {error && (
          <p className="measure text-base text-oxblood-text" data-testid="ward-error">
            {error}
          </p>
        )}
      </div>

      <Rule />

      {wards === null ? (
        <p className="text-base text-bone-dim">Reading the wards…</p>
      ) : wards.length === 0 ? (
        <p className="measure text-base text-bone-dim" data-testid="wards-empty">
          No standing wards. A ward is work that happens without you: a morning brief, a weekly
          tidy, a nightly check.
        </p>
      ) : (
        <ul className="flex flex-col">
          {wards.map((w) => (
            <Row key={w.id} ward={w} onChange={() => void refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}
