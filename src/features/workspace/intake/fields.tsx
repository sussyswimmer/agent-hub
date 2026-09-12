import { Field, inputClass } from "@/components/Field";
import { SegmentedControl } from "@/components/SegmentedControl";
import type { IntakeFieldView } from "@/lib/types";

const INTEGRITY = [{ value: "0", label: "0 · No AI" }, { value: "1", label: "1 · Coach" }, { value: "2", label: "2 · Examples" }, { value: "3", label: "3 · Assisted" }];

export function IntakeFieldInput({ view, value, onChange }: { view: IntakeFieldView; value: unknown; onChange: (v: unknown) => void }) {
  const f = view.field;
  const label = f.prompt ?? f.id;
  const req = f.required ? " *" : "";
  switch (f.type) {
    case "text":
      return <Field label={label + req}><textarea className={`${inputClass} min-h-[60px] resize-y selectable`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} data-intake={f.id} /></Field>;
    case "single": {
      const opts = f.options ?? [];
      const v = typeof value === "string" ? value : "";
      return (
        <Field label={label + req}>
          {opts.length <= 4 ? (
            <div data-intake={f.id}><SegmentedControl value={v} options={opts.map((o) => ({ value: o, label: o.replace(/_/g, " ") }))} onChange={onChange} ariaLabel={label} /></div>
          ) : (
            <select className={inputClass} value={v} onChange={(e) => onChange(e.target.value)} data-intake={f.id}><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          )}
        </Field>
      );
    }
    case "multi": {
      const opts = f.options ?? [];
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={label + req}>
          <div className="flex flex-wrap gap-1.5" data-intake={f.id}>
            {opts.map((o) => {
              const on = arr.includes(o);
              return <button key={o} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={`h-6 rounded-full px-2.5 text-sm transition-colors duration-150 ${on ? "bg-accent text-accent-text" : "bg-input hover:bg-selection"}`}>{o.replace(/_/g, " ")}</button>;
            })}
          </div>
        </Field>
      );
    }
    case "date":
      return <Field label={label + req}><input type="date" className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} data-intake={f.id} /></Field>;
    case "file":
      return <Field label={label + req} hint="A local path. The Drive picker arrives in Phase 3."><input type="text" className={`${inputClass} font-mono text-xs selectable`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} data-intake={f.id} placeholder="/Users/…/draft.md" /></Field>;
    case "integrity": {
      const max = f.max ?? 3;
      const v = String(typeof value === "number" ? Math.min(value, max) : f.default ?? 1);
      return (
        <Field label={label + req} hint={max < 3 ? `Capped at level ${max} for this task.` : undefined}>
          <div data-intake={f.id}><SegmentedControl value={v} options={INTEGRITY.filter((o) => Number(o.value) <= max)} onChange={(x) => onChange(Number(x))} ariaLabel={label} /></div>
        </Field>
      );
    }
  }
}
