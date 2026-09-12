import { z } from "zod";

import type { RunContext } from "../context";
import { insertRow } from "../db";
import { askUserInput, questionItem } from "../schemas";

export const askUserDescription = "Queue questions for Maxwell. The run ends after this call; the app resumes you with his answers as YAML. Batch every question you have into one call.";

export function askUser(ctx: RunContext, args: { questions: z.infer<typeof questionItem>[] }): string {
  const parsed = z.object(askUserInput).parse(args);
  const ids = new Set<string>();
  for (const q of parsed.questions) {
    if (ids.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
    ids.add(q.id);
  }
  insertRow(ctx.db, "questions", { run_id: ctx.runId, agent_id: ctx.agentId, json: JSON.stringify(parsed.questions), status: "pending" });
  const n = parsed.questions.length;
  return `Queued ${n} question${n === 1 ? "" : "s"}. End your turn now with a one-line status.`;
}
