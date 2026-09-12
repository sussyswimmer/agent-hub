import type { ReactNode } from "react";

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="fade-in flex h-full flex-col items-center justify-center gap-1 p-8 text-center text-secondary">
      <div className="text-md font-medium text-label">{title}</div>
      {hint && <div className="max-w-sm text-sm">{hint}</div>}
      {children}
    </div>
  );
}
