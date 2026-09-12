import { describe, expect, test } from "bun:test";

import { openDb, schemaVersion } from "../src/db";
import { loadContext } from "../src/context";
import { tempContext, tempHome } from "./helpers/tempdb";

describe("db", () => {
  test("temp home has the real schema in WAL mode", () => {
    const { dbPath } = tempHome();
    const db = openDb(dbPath);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    expect(schemaVersion(db)).toBe(1);
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of ["runs", "questions", "actions", "outputs", "cards", "weak_spots"]) expect(tables).toContain(t);
  });

  test("loadContext validates run and agent", () => {
    const ctx = tempContext("scout");
    const env = { QUINTET_HOME: ctx.home, QUINTET_OUTPUT_DIR: ctx.outputDir };
    const ok = loadContext(["--agent", "scout", "--run", ctx.runId], env);
    expect(ok.outputDir).toBe(ctx.outputDir);
    expect(ok.workspaceDir).toBe(ctx.workspaceDir);
    expect(() => loadContext(["--agent", "research", "--run", ctx.runId], env)).toThrow(/belongs to agent scout/);
    expect(() => loadContext(["--agent", "scout", "--run", "nope"], env)).toThrow(/does not exist/);
    expect(() => loadContext(["--agent", "scout"], env)).toThrow(/requires/);
    expect(() => loadContext(["--agent", "scout", "--run", ctx.runId], { QUINTET_HOME: "/nonexistent" })).toThrow(/database not found/);
  });
});
