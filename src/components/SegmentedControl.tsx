export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-mac bg-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-6 rounded-[5px] px-2.5 text-sm transition-colors duration-150 ${o.value === value ? "bg-card shadow-sm font-medium" : "text-secondary hover:text-label"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
