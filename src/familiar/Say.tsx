import { useState } from "react";

import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type { FamiliarSummary } from "@/lib/types";

/** Things worth saying often enough to be one press. Sent as they read. */
const QUICK = [
  "Stop and tell me what you have done so far.",
  "Wrap up: finish what you are doing, then summarise.",
];

/**
 * Talk to a summoned familiar from its commission tab: steer it, answer its question, tell it to
 * stop. The same as typing into its terminal and pressing Enter, as one message however many
 * lines it has (DECISIONS 0028).
 *
 * The owner could not see how to make a familiar do what they wanted once it was going. The
 * terminal always took typing, but it was a tab away and looked like a terminal; this is the
 * same thing, where the task was given.
 */
export function Say({ familiar }: { familiar: FamiliarSummary }) {
  const setTab = useStore((s) => s.setTab);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(message: string) {
    setError(null);
    setSent(null);
    if (!message.trim()) {
      setError(`Write what you want to tell ${familiar.name} first.`);
      return;
    }
    try {
      await (await backend()).say(familiar.id, message.trim());
      setText("");
      setSent(`Sent to ${familiar.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <form
      className="measure mb-6 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send(text);
      }}
      data-testid="say"
    >
      <label className="flex flex-col gap-1">
        <span className="text-base text-bone">Tell {familiar.name} something</span>
        <span className="text-xs text-bone-dim" id="say-hint">
          It reads this as its next message, the same as typing in its terminal. Enter sends; Shift and Enter starts a
          new line.
        </span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSent(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={2}
          aria-describedby="say-hint"
          placeholder="Use the newer data file instead. / Yes, go ahead. / Skip the tests for now."
          data-testid="say-text"
          className="rounded-mark border border-rule bg-panel p-2 text-base text-bone outline-none placeholder:text-bone-dim focus:border-brass"
        />
      </label>
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          data-testid="say-send"
          className="h-7 rounded-mark border border-brass px-3 text-base text-bone hover:bg-panel"
        >
          Send
        </button>
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void send(q)}
            className="h-7 rounded-mark border border-rule px-2 text-xs text-bone-dim hover:bg-panel hover:text-bone"
          >
            {q}
          </button>
        ))}
      </span>
      {sent && (
        <p role="status" className="text-base text-verdigris-text" data-testid="say-sent">
          {sent}{" "}
          <button type="button" onClick={() => setTab("terminal")} className="underline underline-offset-4">
            See its answer in the terminal
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-base text-oxblood-text" data-testid="say-error">
          {error}
        </p>
      )}
    </form>
  );
}
