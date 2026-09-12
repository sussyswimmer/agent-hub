// Per-run context: who is calling (agent, run) and where things live. Built from `serve --agent --run`
// plus the environment the Rust side puts in the per-run MCP config.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { type Database } from "bun:sqlite";

import { openDb } from "./db";

export interface RunContext {
  agentId: string;
  runId: string;
  home: string;
  dbPath: string;
  outputDir: string;
  workspaceDir: string;
  db: Database;
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = "true";
    }
  }
  return out;
}

export class ContextError extends Error {}

export function loadContext(argv: string[], env: NodeJS.ProcessEnv = process.env): RunContext {
  const args = parseArgs(argv);
  const agentId = args["agent"];
  const runId = args["run"];
  if (!agentId || !runId) throw new ContextError("serve requires --agent <id> --run <run_id>");
  const home = env["QUINTET_HOME"] ?? join(env["HOME"] ?? "", "Quintet");
  const dbPath = join(home, "data", "quintet.db");
  if (!existsSync(dbPath)) throw new ContextError(`database not found at ${dbPath} (QUINTET_HOME=${home})`);
  const db = openDb(dbPath);
  const run = db.query<{ agent_id: string; output_dir: string | null }, [string]>("SELECT agent_id, output_dir FROM runs WHERE id = ?").get(runId);
  if (!run) throw new ContextError(`run ${runId} does not exist`);
  if (run.agent_id !== agentId) throw new ContextError(`run ${runId} belongs to agent ${run.agent_id}, not ${agentId}`);
  const outputDir = env["QUINTET_OUTPUT_DIR"] ?? run.output_dir ?? join(home, "outputs", agentId);
  const workspaceDir = join(home, "agents", agentId, "workspace");
  return { agentId, runId, home, dbPath, outputDir, workspaceDir, db };
}
