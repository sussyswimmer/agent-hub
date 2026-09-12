import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-secondary">{hint}</div>}
    </label>
  );
}

export const inputClass = "w-full rounded-mac border border-card-border bg-input px-2 py-1.5 text-base outline-none focus:ring-2 focus:ring-accent/40";
