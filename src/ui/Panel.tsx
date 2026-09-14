import type { ReactNode } from "react";

/** A raised vellum surface that carries a section without turning the whole product into a grid of boxes. */
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
    <section className={`overflow-hidden rounded-[18px] border border-rule/80 bg-panel/90 shadow-[0_20px_50px_rgba(0,0,0,0.18)] ${className}`}>
      {title && (
        <header className="flex h-10 items-center gap-3 border-b border-rule/70 bg-[linear-gradient(100deg,rgba(255,255,255,0.035),transparent)] px-4">
          <h2 className="display text-base text-bone">{title}</h2>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
