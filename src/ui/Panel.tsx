import type { ReactNode } from "react";

/** A raised surface. Heading in the display face; no radius, no shadow (§7.5). */
export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-panel ${className}`}>
      {title && (
        <header className="flex h-9 items-center gap-3 border-b border-rule px-3">
          <h2 className="display text-base text-bone">{title}</h2>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
