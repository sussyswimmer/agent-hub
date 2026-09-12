import type { IntegrityLevel } from "@/lib/types";

const META: Record<IntegrityLevel, { name: string; cls: string }> = {
  0: { name: "No AI", cls: "bg-sys-gray/20 text-label" },
  1: { name: "Coach", cls: "bg-sys-blue/15 text-sys-blue" },
  2: { name: "Examples", cls: "bg-sys-orange/15 text-sys-orange" },
  3: { name: "Assisted", cls: "bg-sys-green/15 text-sys-green" },
};

export function IntegrityPill({ level }: { level: number | null }) {
  if (level === null || level === undefined) return null;
  const l = Math.max(0, Math.min(3, level)) as IntegrityLevel;
  const m = META[l];
  return <span className={`rounded-full px-2 text-xs font-medium leading-[18px] ${m.cls}`} title={`Integrity level ${l}`} data-integrity={l}>L{l} · {m.name}</span>;
}
