import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import type { RunContext } from "../context";
import { insertRow } from "../db";
import { saveOutputInput } from "../schemas";

export const saveOutputDescription = "Register a deliverable in this run's output folder. Pass `path` for a file you already wrote (inside the output folder or your workspace), or `content` to have the file written for you (required at integrity levels 0–1, kind \"feedback\").";

function inside(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function safeName(title: string, kind: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "output";
  const ext = kind === "feedback" ? "md" : kind;
  return `${base}.${ext}`;
}

export function saveOutput(ctx: RunContext, args: { path?: string | undefined; content?: string | undefined; kind: string; title: string }): { id: string; path: string } {
  const parsed = z.object(saveOutputInput).parse(args);
  if ((parsed.path === undefined) === (parsed.content === undefined)) throw new Error("pass exactly one of `path` or `content`");
  mkdirSync(ctx.outputDir, { recursive: true });
  let finalPath: string;
  if (parsed.content !== undefined) {
    finalPath = join(ctx.outputDir, safeName(parsed.title, parsed.kind));
    writeFileSync(finalPath, parsed.content);
  } else {
    const p = parsed.path!;
    const abs = isAbsolute(p) ? p : existsSync(resolve(ctx.outputDir, p)) ? resolve(ctx.outputDir, p) : resolve(ctx.workspaceDir, p);
    if (!existsSync(abs)) throw new Error(`file not found: ${abs}`);
    if (inside(ctx.outputDir, abs)) finalPath = abs;
    else if (inside(ctx.workspaceDir, abs)) {
      finalPath = join(ctx.outputDir, basename(abs));
      renameSync(abs, finalPath);
    } else throw new Error(`refusing to register ${abs}: it is outside the output folder and the workspace`);
  }
  const id = insertRow(ctx.db, "outputs", { run_id: ctx.runId, agent_id: ctx.agentId, path: finalPath, kind: parsed.kind, title: parsed.title });
  return { id, path: finalPath };
}
