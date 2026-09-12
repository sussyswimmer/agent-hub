// Intake form (CLAUDE.md §4): only non-skipped fields, re-evaluated as answers change (100 ms debounce),
// runs as soon as every required field is satisfied when opened from the composer.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field, inputClass } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { useStore } from "@/app/store";
import type { AgentSummary, IntakeForm } from "@/lib/types";

import { IntakeFieldInput } from "./fields";

export function IntakeSheet({ agent, open, initialText, onClose }: { agent: AgentSummary; open: boolean; initialText: string; onClose: () => void }) {
  const { backend, dispatch } = useStore();
  const [text, setText] = useState(initialText);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<IntakeForm | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (open) { setText(initialText); setAnswers({}); setForm(null); } }, [open, initialText]);

  useEffect(() => {
    if (!open || !backend) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void backend.evaluateIntake(agent.id, text, answers).then(setForm).catch((e: unknown) => dispatch({ type: "error", value: String(e) })); }, 100);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [open, backend, agent.id, text, answers, dispatch]);

  const run = async () => {
    if (!backend || !form?.can_start) return;
    setBusy(true);
    try { await backend.startTask({ agent_id: agent.id, task_text: text, answers, trigger: null }); onClose(); }
    catch (e) { dispatch({ type: "error", value: String(e) }); }
    finally { setBusy(false); }
  };

  const visible = form?.fields.filter((v) => !v.skipped) ?? [];
  const hasTextFromChat = visible.some((v) => v.field.type === "text" && v.field.from_chat);
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={`New task · ${agent.name}`}>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void run(); } }} data-testid="intake-sheet">
        {!hasTextFromChat && <Field label="Task"><textarea className={`${inputClass} min-h-[60px] resize-y selectable`} value={text} onChange={(e) => setText(e.target.value)} data-intake="__task" /></Field>}
        {visible.map((v) => (
          <IntakeFieldInput
            key={v.field.id}
            view={v}
            value={answers[v.field.id] !== undefined ? answers[v.field.id] : v.field.type === "text" && v.field.from_chat ? text : v.prefill}
            onChange={(val) => { if (v.field.type === "text" && v.field.from_chat) setText(String(val)); else setAnswers((a) => ({ ...a, [v.field.id]: val })); }}
          />
        ))}
        {form && !form.can_start && <div className="mb-2 text-xs text-sys-red" data-testid="intake-missing">Required: {form.missing.join(", ")}</div>}
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!form?.can_start || busy} data-testid="intake-run">Run</Button>
        </div>
      </form>
    </Sheet>
  );
}
