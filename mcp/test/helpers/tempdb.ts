// A temp ~/Quintet with the real schema (db/migrations/*.sql applied exactly like Rust does).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../src/db";
import type { RunContext } from "../../src/context";
import { insertRow } from "../../src/db";

const MIGRATIONS = join(import.meta.dir, "../../../db/migrations");

export function tempHome(): { home: string; dbPath: string } {
  const home = mkdtempSync(join(tmpdir(), "quintet-mcp-"));
  for (const d of ["data", "agents", "outputs", "logs/runs"]) mkdirSync(join(home, d), { recursive: true });
  const dbPath = join(home, "data", "quintet.db");
  const db = openDb(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const version = Number(f.slice(0, 4));
    db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    db.query("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
  }
  db.close();
  return { home, dbPath };
}

/** A run row + workspace + output dir for `agentId`, returning a RunContext like serve builds. */
export function tempContext(agentId = "research"): RunContext {
  const { home, dbPath } = tempHome();
  const db = openDb(dbPath);
  const runId = insertRow(db, "runs", { agent_id: agentId, trigger: "manual", status: "running", session_id: "s", task_title: "test", output_dir: join(home, "outputs", agentId, "2026-09-12-test") });
  const workspaceDir = join(home, "agents", agentId, "workspace");
  const outputDir = join(home, "outputs", agentId, "2026-09-12-test");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  return { agentId, runId, home, dbPath, outputDir, workspaceDir, db };
}
