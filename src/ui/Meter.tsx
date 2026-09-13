/**
 * A thin aether meter (§6.5). Verdigris to 80%, brass past it, oxblood at 100%.
 * `value` and `max` are shown as text too — a bar alone is not a reading.
 */
export function Meter({
  label,
  value,
  max,
  format,
}: {
  label: string;
  value: number;
  max: number | null;
  format?: (v: number, max: number | null) => string;
}) {
  const frac = max && max > 0 ? Math.min(1, value / max) : 0;
  const fill = frac >= 1 ? "var(--oxblood)" : frac >= 0.8 ? "var(--brass)" : "var(--verdigris)";
  const text = format ? format(value, max) : max ? `${value} / ${max}` : String(value);
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap" data-meter={label} data-fraction={frac.toFixed(3)}>
      <span className="shrink-0 text-xs text-bone-dim">{label}</span>
      <div
        className="h-1 w-16 shrink-0 bg-rule"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        {...(max ? { "aria-valuemax": max } : {})}
      >
        <div className="h-full" style={{ width: `${frac * 100}%`, background: fill }} />
      </div>
      <span className="mono shrink-0 text-xs text-bone-dim tabular-nums">{text}</span>
    </div>
  );
}
