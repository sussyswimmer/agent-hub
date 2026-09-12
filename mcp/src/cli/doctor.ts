import { existsSync } from "node:fs";
import { join } from "node:path";

import { openDb, schemaVersion } from "../db";

async function run(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !(k === "CLAUDECODE" || k.startsWith("CLAUDE_") || k.startsWith("SESSION_INGRESS"))));
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    return { ok: code === 0, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e) };
  }
}

export async function doctor(): Promise<number> {
  const home = process.env["QUINTET_HOME"] ?? join(process.env["HOME"] ?? "", "Quintet");
  const dbPath = join(home, "data", "quintet.db");
  const report: Record<string, unknown> = { bun: Bun.version, home, db: dbPath, db_exists: existsSync(dbPath) };
  let ok = true;
  if (existsSync(dbPath)) {
    try {
      const db = openDb(dbPath);
      report["journal_mode"] = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode;
      report["schema_version"] = schemaVersion(db);
      db.close();
    } catch (e) { report["db_error"] = String(e); ok = false; }
  } else ok = false;
  const v = await run(["claude", "--version"]);
  report["claude_version"] = v.out;
  ok &&= v.ok;
  const a = await run(["claude", "auth", "status"]);
  try { const j = JSON.parse(a.out) as { loggedIn?: boolean; authMethod?: string }; report["logged_in"] = j.loggedIn ?? false; report["auth_method"] = j.authMethod; ok &&= j.loggedIn === true; } catch { report["auth"] = a.out; ok = false; }
  report["ok"] = ok;
  console.log(JSON.stringify(report, null, 2));
  return ok ? 0 : 1;
}
