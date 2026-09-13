type Tone = "bone" | "brass" | "verdigris" | "oxblood" | "slate";

const TONE: Record<Tone, string> = {
  bone: "text-bone-dim",
  brass: "text-brass-text",
  verdigris: "text-verdigris-text",
  oxblood: "text-oxblood-text",
  slate: "text-slate-text",
};

/** A small status word. Text-safe colour variants only — the saturated tokens are for fills (§7.2). */
export function Pill({ children, tone = "bone", title }: { children: string; tone?: Tone; title?: string }) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={`inline-flex h-5 items-center rounded-mark bg-void/40 px-1.5 text-xs ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
