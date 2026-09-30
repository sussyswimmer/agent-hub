import { useEffect, useMemo, useState } from "react";

import { backend } from "@/lib/ipc";
import type { FamiliarSummary, IntakeField } from "@/lib/types";

/** The answers, keyed by field id. Everything is a string; a select is one of its options. */
export type Answers = Record<string, string>;

/** Which button placed it. The pane decides what each one means for this familiar right now. */
export type How = "primary" | "secondary";

/**
 * The form a familiar asks before a commission (§6.2), generated from its own binding.
 *
 * There is no schema here and there should not be: the questions are whatever the binding says,
 * so adding one means editing a markdown file, not this component.
 */
export function Intake({
  familiar,
  onSubmit,
  primary = "Commission",
  secondary,
}: {
  familiar: FamiliarSummary;
  onSubmit: (prompt: string, answers: Answers, how: How) => boolean | void | Promise<boolean | void>;
  /** The main button's verb, which says what pressing it will do: "Summon and start", "Start". */
  primary?: string;
  /** A second, quieter way to place it, when there is one: "Queue for later". */
  secondary?: string;
}) {
  const [fields, setFields] = useState<IntakeField[] | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [prompt, setPrompt] = useState("");
  // Nothing is marked missing until submit is pressed. Reddening a field the moment it is
  // focused and left tells people off for reading the form in order.
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setFields(null);
    setAnswers({});
    setPrompt("");
    setShowMissing(false);
    void backend()
      .then((b) => b.intakeFor(familiar.id))
      .then((f) => {
        if (live) setFields(f);
      })
      .catch(() => {
        if (live) setFields([]);
      });
    return () => {
      live = false;
    };
  }, [familiar.id]);

  const missing = useMemo(
    () => (fields ?? []).filter((f) => f.required && !(answers[f.id] ?? "").trim()).map((f) => f.id),
    [fields, answers],
  );
  const blocked = missing.length > 0 || !prompt.trim();

  async function submit(e: React.FormEvent, how: How = "primary") {
    e.preventDefault();
    if (blocked) {
      setShowMissing(true);
      return;
    }
    // A placement that failed keeps the draft, so the error can be fixed rather than retyped.
    if ((await onSubmit(prompt.trim(), answers, how)) === false) return;
    // Clear it. Found by placing two commissions in a row in the running application: the
    // second inherited the first's text, so the queue showed one prompt with another stuck on
    // the end of it. A form that has been submitted is not still holding a draft.
    setPrompt("");
    setAnswers({});
    setShowMissing(false);
  }

  if (fields === null) {
    return <p className="text-base text-bone-dim">Reading the binding…</p>;
  }

  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));

  return (
    <form className="measure flex flex-col gap-4" onSubmit={(e) => void submit(e)} data-testid="intake">
      <label className="flex flex-col gap-1">
        <span className="text-base text-bone">What should {familiar.name} do?</span>
        <span className="text-xs text-bone-dim" id="intake-prompt-hint">
          Plain words. This is the commission: the task {familiar.name} works on until you mark it done.
        </span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          aria-describedby="intake-prompt-hint"
          placeholder={placeholder(familiar.order)}
          data-testid="intake-prompt"
          className="rounded-mark border border-rule bg-panel p-2 text-base text-bone outline-none placeholder:text-bone-dim focus:border-brass"
        />
      </label>

      {fields.map((field) => {
        const isMissing = showMissing && missing.includes(field.id);
        const border = isMissing ? "border-oxblood" : "border-rule";
        return (
          <label key={field.id} className="flex flex-col gap-1" data-field={field.id}>
            <span className="text-base text-bone">
              {field.ask}
              {field.required && <span className="text-bone-dim"> · required</span>}
            </span>

            {field.type === "select" ? (
              <select
                value={answers[field.id] ?? ""}
                onChange={(e) => set(field.id, e.target.value)}
                className={`h-8 rounded-mark border ${border} bg-panel px-2 text-base text-bone outline-none focus:border-brass`}
              >
                <option value="">Choose one</option>
                {field.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : field.type === "multiline" ? (
              <textarea
                value={answers[field.id] ?? ""}
                onChange={(e) => set(field.id, e.target.value)}
                rows={3}
                className={`rounded-mark border ${border} bg-panel p-2 text-base text-bone outline-none focus:border-brass`}
              />
            ) : (
              <input
                value={answers[field.id] ?? ""}
                onChange={(e) => set(field.id, e.target.value)}
                className={`h-8 rounded-mark border ${border} bg-panel px-2 text-base text-bone outline-none focus:border-brass`}
              />
            )}

            {isMissing && (
              <span className="text-xs text-oxblood-text" data-missing>
                This one is needed before the commission can start.
              </span>
            )}
          </label>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="intake-submit"
          // Neither `disabled` nor `aria-disabled`. A button that cannot be pressed cannot say
          // why, and both of those tell assistive technology it is unavailable — which is
          // exactly wrong here, because pressing it is how you find out what is missing.
          // `data-blocked` carries the same information for styling without the lie.
          data-blocked={blocked || undefined}
          aria-describedby={showMissing && blocked ? "intake-blocked" : undefined}
          className="h-8 rounded-mark border border-brass bg-panel px-3 text-base text-bone transition-colors duration-150 hover:bg-void data-blocked:border-rule data-blocked:text-bone-dim"
        >
          {primary}
        </button>
        {secondary && (
          <button
            type="button"
            data-testid="intake-queue"
            onClick={(e) => void submit(e, "secondary")}
            className="h-8 rounded-mark border border-rule px-3 text-base text-bone-dim transition-colors duration-150 hover:bg-panel hover:text-bone"
          >
            {secondary}
          </button>
        )}
        {showMissing && blocked && (
          <span
            id="intake-blocked"
            role="status"
            className="text-base text-oxblood-text"
            data-testid="intake-blocked"
          >
            {!prompt.trim()
              ? `Say what ${familiar.name} should do first.`
              : `Answer ${missing.length === 1 ? "the question" : `all ${missing.length} questions`} marked required.`}
          </span>
        )}
      </div>
    </form>
  );
}

/** An example in the empty box, so the first thing a new owner sees is what a commission reads like. */
function placeholder(order: FamiliarSummary["order"]): string {
  switch (order) {
    case "quill":
      return "Tighten the opening of the swimming essay. Keep my voice.";
    case "lantern":
      return "Find what has been published on cold-water swimming and sleep, with sources.";
    case "crucible":
      return "Add a test for the date parser, then make it pass.";
    case "compass":
      return "Look at this week and tell me what has to move.";
    case "ledger":
      return "Work out what the heating cost per month last winter. Show the sums.";
  }
}
