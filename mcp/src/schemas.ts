import { z } from "zod";

export const questionItem = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "question id must be snake_case"),
  prompt: z.string().min(1),
  type: z.enum(["single", "multi", "text"]),
  options: z.array(z.string().min(1)).min(1).optional(),
}).refine((q) => q.type === "text" || (q.options?.length ?? 0) > 0, { message: "single/multi questions need options" });

export const askUserInput = { questions: z.array(questionItem).min(1).max(12) };

/** CLAUDE.md §6.2 — the only action types quintet-mcp exec will ever run. */
export const actionType = z.enum(["calendar.create_events", "calendar.update_events", "calendar.delete_events", "gmail.create_draft", "drive.create_doc"]);

export const proposeActionInput = {
  type: actionType,
  payload: z.unknown(),
  preview_md: z.string().min(1),
  reason: z.string().optional(),
};

export const outputKind = z.enum(["md", "csv", "png", "docx", "feedback"]);

export const saveOutputInput = {
  path: z.string().min(1).optional(),
  content: z.string().optional(),
  kind: outputKind,
  title: z.string().min(1).max(200),
};

export const nowInput = {};
