// Native answer form for a waiting_user run (CLAUDE.md §6.3): chips for options, text otherwise.
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { inputClass } from "@/components/Field";
import { useStore } from "@/app/store";
import type { Question } from "@/lib/types";

export function QuestionForm({ runId, onAnswered }: { runId: string; onAnswered?: () => void }) {
  const { backend, dispatch } = useStore();
  const [qs, setQs] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { void backend?.listQuestions({ runId, status: "pending" }).then(setQs); }, [backend, runId]);

  const set = (qid: string, id: string, v: unknown) => setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? {}), [id]: v } }));
  const complete = (q: Question) => q.questions.every((item) => { const v = answers[q.id]?.[item.id]; return v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0); });

  const submit = async (q: Question) => {
    if (!backend || !complete(q)) return;
    setBusy(true);
    try { await backend.answerQuestions(q.id, answers[q.id] ?? {}); setQs((cur) => cur.filter((x) => x.id !== q.id)); onAnswered?.(); }
    catch (e) { dispatch({ type: "error", value: String(e) }); }
    finally { setBusy(false); }
  };

  if (qs.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="question-form">
      {qs.map((q) => (
        <form key={q.id} onSubmit={(e) => { e.preventDefault(); void submit(q); }} className="rounded-mac border border-sys-blue/30 bg-sys-blue/8 p-3">
          {q.questions.map((item) => {
            const v = answers[q.id]?.[item.id];
            return (
              <div key={item.id} className="mb-2" data-question={item.id}>
                <div className="mb-1 text-sm font-medium">{item.prompt}</div>
                {item.type === "text" ? (
                  <textarea className={`${inputClass} min-h-[48px] selectable`} value={typeof v === "string" ? v : ""} onChange={(e) => set(q.id, item.id, e.target.value)} />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(item.options ?? []).map((o) => {
                      const on = item.type === "multi" ? Array.isArray(v) && (v as string[]).includes(o) : v === o;
                      const next = () => item.type === "multi" ? (on ? (v as string[]).filter((x) => x !== o) : [...((v as string[] | undefined) ?? []), o]) : o;
                      return <button key={o} type="button" role={item.type === "multi" ? "checkbox" : "radio"} aria-checked={on} onClick={() => set(q.id, item.id, next())} className={`h-6 rounded-full px-2.5 text-sm transition-colors duration-150 ${on ? "bg-accent text-accent-text" : "bg-card hover:bg-selection"}`}>{o}</button>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end"><Button type="submit" variant="primary" disabled={busy || !complete(q)} data-testid="answer-submit">Answer and continue</Button></div>
        </form>
      ))}
    </div>
  );
}
