import { CircleAlert, CircleCheck, FileOutput, Lightbulb, LoaderCircle, MessageCircleQuestion, Wrench } from "lucide-react";

import type { UiRow } from "@/lib/types";

export function ToolStepRow({ row }: { row: UiRow }) {
  const IconC = row.state === "running" ? LoaderCircle : row.state === "error" || row.kind === "error" ? CircleAlert : row.kind === "question" ? MessageCircleQuestion : row.kind === "proposal" ? Lightbulb : row.kind === "output" ? FileOutput : row.kind === "tool" ? CircleCheck : Wrench;
  const tone = row.state === "error" || row.kind === "error" ? "text-sys-red" : row.kind === "proposal" ? "text-sys-orange" : row.kind === "question" ? "text-sys-blue" : "text-secondary";
  return (
    <div className="flex items-start gap-2 py-0.5 text-sm" data-row-kind={row.kind} data-row-state={row.state} title={row.detail ?? undefined}>
      <IconC size={14} className={`mt-[3px] shrink-0 ${tone} ${row.state === "running" ? "animate-spin" : ""}`} />
      <span className={`min-w-0 truncate ${row.kind === "error" ? "text-sys-red" : ""}`}>{row.label}</span>
    </div>
  );
}
