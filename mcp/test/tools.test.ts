import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { askUser, now, proposeAction, saveOutput } from "../src/tools";
import { tempContext } from "./helpers/tempdb";

describe("ask_user", () => {
  test("queues questions and tells the agent to stop", () => {
    const ctx = tempContext();
    const msg = askUser(ctx, { questions: [{ id: "style", prompt: "Citation style?", type: "single", options: ["APA", "Chicago"] }, { id: "notes", prompt: "Anything else?", type: "text" }] });
    expect(msg).toBe("Queued 2 questions. End your turn now with a one-line status.");
    const row = ctx.db.query<{ status: string; json: string; agent_id: string }, []>("SELECT status, json, agent_id FROM questions").get()!;
    expect(row.status).toBe("pending");
    expect(row.agent_id).toBe("research");
    expect(JSON.parse(row.json)).toHaveLength(2);
    expect(() => askUser(ctx, { questions: [{ id: "x", prompt: "?", type: "single" }] })).toThrow(/options/);
    expect(() => askUser(ctx, { questions: [{ id: "a", prompt: "?", type: "text" }, { id: "a", prompt: "?", type: "text" }] })).toThrow(/duplicate/);
    expect(() => askUser(ctx, { questions: [{ id: "Bad-Id", prompt: "?", type: "text" }] })).toThrow();
  });
});

describe("propose_action", () => {
  test("stores a pending action and never claims execution", () => {
    const ctx = tempContext("school");
    const r = proposeAction(ctx, { type: "calendar.create_events", payload: [{ title: "Study", start: "2026-09-13T19:00:00+07:00", end: "2026-09-13T20:00:00+07:00" }], preview_md: "- Study 19:00–20:00", reason: "Physics test Friday" });
    expect(r.action_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(r.message).toContain('say "proposed", never "done"');
    const row = ctx.db.query<{ status: string; type: string; payload_json: string; reason: string }, []>("SELECT status, type, payload_json, reason FROM actions").get()!;
    expect(row.status).toBe("pending");
    expect(row.type).toBe("calendar.create_events");
    expect(JSON.parse(row.payload_json)).toHaveLength(1);
    expect(row.reason).toBe("Physics test Friday");
    expect(() => proposeAction(ctx, { type: "gmail.send", payload: {}, preview_md: "x" })).toThrow();
  });
});

describe("save_output", () => {
  test("content form writes into the output folder", () => {
    const ctx = tempContext();
    const r = saveOutput(ctx, { content: "# Feedback\n\nGood hook.", kind: "feedback", title: "Essay feedback: Common App #1" });
    expect(r.path).toBe(join(ctx.outputDir, "essay-feedback-common-app-1.md"));
    expect(readFileSync(r.path, "utf8")).toContain("Good hook");
    const row = ctx.db.query<{ kind: string; title: string; path: string }, []>("SELECT kind, title, path FROM outputs").get()!;
    expect(row.kind).toBe("feedback");
    expect(row.path).toBe(r.path);
  });

  test("path form registers files in the output dir and moves workspace files", () => {
    const ctx = tempContext();
    writeFileSync(join(ctx.outputDir, "brief.md"), "brief");
    expect(saveOutput(ctx, { path: "brief.md", kind: "md", title: "Brief" }).path).toBe(join(ctx.outputDir, "brief.md"));
    writeFileSync(join(ctx.workspaceDir, "data.csv"), "a,b");
    const moved = saveOutput(ctx, { path: join(ctx.workspaceDir, "data.csv"), kind: "csv", title: "Data" });
    expect(moved.path).toBe(join(ctx.outputDir, "data.csv"));
    expect(existsSync(join(ctx.workspaceDir, "data.csv"))).toBe(false);
    expect(existsSync(moved.path)).toBe(true);
    expect(() => saveOutput(ctx, { path: "/etc/hostname", kind: "md", title: "x" })).toThrow(/outside/);
    expect(() => saveOutput(ctx, { path: "missing.md", kind: "md", title: "x" })).toThrow(/not found/);
    expect(() => saveOutput(ctx, { kind: "md", title: "x" })).toThrow(/exactly one/);
    expect(() => saveOutput(ctx, { path: "brief.md", content: "y", kind: "md", title: "x" })).toThrow(/exactly one/);
    expect(ctx.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM outputs").get()?.n).toBe(2);
  });
});

describe("now", () => {
  test("renders Saigon time", () => {
    const n = now(new Date("2026-09-11T03:05:09Z"));
    expect(n).toEqual({ iso: "2026-09-11T10:05:09+07:00", date: "2026-09-11", time: "10:05", weekday: "Friday", tz: "Asia/Saigon" });
    const midnight = now(new Date("2026-09-11T17:00:00Z"));
    expect(midnight.time).toBe("00:00");
    expect(midnight.date).toBe("2026-09-12");
  });
});
