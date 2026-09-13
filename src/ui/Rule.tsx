/** A 1px hairline. Panels are separated by these and by space, never by borders + radius + shadow (§7.5). */
export function Rule({ vertical = false, className = "" }: { vertical?: boolean; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={`${vertical ? "w-px self-stretch" : "h-px w-full"} bg-rule ${className}`}
    />
  );
}
