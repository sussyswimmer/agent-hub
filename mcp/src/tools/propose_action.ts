import { z } from "zod";

import type { RunContext } from "../context";
import { insertRow } from "../db";
import { proposeActionInput } from "../schemas";

export const proposeActionDescription = "Propose an external action (calendar events, a Gmail draft, a Google Doc). Nothing happens until Maxwell approves it in the app. Say \"proposed\", never \"done\".";

export function proposeAction(ctx: RunContext, args: { type: string; payload: unknown; preview_md: string; reason?: string | undefined }): { action_id: string; message: string } {
  const parsed = z.object(proposeActionInput).parse(args);
  const id = insertRow(ctx.db, "actions", {
    run_id: ctx.runId,
    agent_id: ctx.agentId,
    type: parsed.type,
    payload_json: JSON.stringify(parsed.payload ?? null),
    preview_md: parsed.preview_md,
    reason: parsed.reason ?? null,
    status: "pending",
  });
  return { action_id: id, message: `Proposed ${parsed.type} as action ${id}. It is waiting for Maxwell's approval; say "proposed", never "done".` };
}
