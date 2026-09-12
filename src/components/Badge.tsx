export function Badge({ count, tone = "neutral" }: { count: number; tone?: "neutral" | "accent" | "error" }) {
  if (count <= 0) return null;
  const cls = tone === "accent" ? "bg-accent text-accent-text" : tone === "error" ? "bg-sys-red text-white" : "bg-input text-secondary";
  return <span className={`ml-auto min-w-[18px] rounded-full px-1.5 text-center text-xs leading-[18px] ${cls}`} data-badge={count}>{count}</span>;
}
