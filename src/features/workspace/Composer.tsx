import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { isMod, modLabel } from "@/app/keyboard";

export function Composer({ disabled, disabledReason, focusTick, onRun }: { disabled: boolean; disabledReason?: string | undefined; focusTick: number; onRun: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, [focusTick]);

  const submit = async () => {
    const t = text.trim();
    if (!t || disabled || busy) return;
    setBusy(true);
    try { await onRun(t); setText(""); } finally { setBusy(false); }
  };

  return (
    <div className="shrink-0 border-t border-separator p-3" data-testid="composer">
      <div className="flex items-end gap-2 rounded-lg border border-card-border bg-card p-2 shadow-sm">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isMod(e.nativeEvent) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder={disabled ? disabledReason ?? "Unavailable" : `Describe the task… (${modLabel}↩ to run)`}
          disabled={disabled}
          rows={2}
          aria-label="Task"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-0.5 text-base outline-none placeholder:text-tertiary selectable"
        />
        <Button variant="primary" onClick={() => void submit()} disabled={disabled || busy || !text.trim()} data-testid="run-button">Run</Button>
      </div>
    </div>
  );
}
