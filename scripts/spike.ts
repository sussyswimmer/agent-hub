#!/usr/bin/env bun
// Phase 0 spike: run `claude -p` with stream-json and print one digest line per event.
// Usage: bun run scripts/spike.ts [--cwd DIR] [--stdin "task text"] -- <extra claude args...>
// Raw lines are teed to scripts/out/<timestamp>.jsonl for fixture capture.
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep === -1 ? argv : argv.slice(0, sep);
const extra = sep === -1 ? [] : argv.slice(sep + 1);
const opt = (k: string) => { const i = own.indexOf(k); return i === -1 ? undefined : own[i + 1]; };
const cwd = opt("--cwd") ?? process.cwd();
const stdinText = opt("--stdin");

mkdirSync(`${import.meta.dir}/out`, { recursive: true });
const outPath = `${import.meta.dir}/out/${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
const out = Bun.file(outPath).writer();

const cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose", ...extra];
// Scrub every CLAUDE* / session-ingress variable: a nested run must not inherit the
// parent Claude Code session id, messaging socket, or remote-session plumbing.
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (k === "CLAUDECODE" || k.startsWith("CLAUDE_") || k.startsWith("SESSION_INGRESS")) continue;
  env[k] = v;
}
if (!extra.includes("--resume") && !extra.includes("--session-id")) cmd.push("--session-id", crypto.randomUUID());
const t0 = performance.now();
const proc = Bun.spawn(cmd, { cwd, env, stdin: stdinText === undefined ? "ignore" : new TextEncoder().encode(stdinText), stdout: "pipe", stderr: "pipe" });

const digest = (e: any): string => {
  if (e.type === "system") return `system/${e.subtype} ${e.subtype === "init" ? `model=${e.model} tools=${e.tools?.length} mcp=${JSON.stringify(e.mcp_servers)} skills=${e.skills?.length ?? "-"} plugins=${e.plugins?.length ?? "-"} agents=${e.agents?.length ?? "-"} slash=${e.slash_commands?.length ?? "-"}` : JSON.stringify(e).slice(0, 160)}`;
  if (e.type === "assistant") return `assistant ${e.message.content.map((c: any) => c.type === "text" ? `text(${c.text.length})` : `${c.type}:${c.name ?? ""}(${JSON.stringify(c.input ?? "").slice(0, 60)})`).join(" ")}`;
  if (e.type === "user") return `user ${e.message.content.map((c: any) => typeof c === "string" ? "str" : `${c.type}${c.is_error ? "!" : ""}(${String(c.content?.[0]?.text ?? c.content ?? "").slice(0, 50)})`).join(" ")}`;
  if (e.type === "result") return `result/${e.subtype} is_error=${e.is_error} turns=${e.num_turns} cost=${e.total_cost_usd} session=${e.session_id} denials=${e.permission_denials?.length ?? "-"} ${e.is_error ? String(e.result ?? e.error ?? "").slice(0, 200) : ""}`;
  return `${e.type} ${JSON.stringify(e).slice(0, 120)}`;
};

let n = 0;
for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(new (class extends TransformStream<string, string> { constructor() { let buf = ""; super({ transform(c, ctl) { buf += c; const ls = buf.split("\n"); buf = ls.pop()!; for (const l of ls) if (l.trim()) ctl.enqueue(l); }, flush(ctl) { if (buf.trim()) ctl.enqueue(buf); } }); } })())) {
  out.write(chunk + "\n"); n++;
  try { console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${digest(JSON.parse(chunk))}`); } catch { console.log(`[raw] ${chunk.slice(0, 200)}`); }
}
const stderr = await new Response(proc.stderr).text();
const code = await proc.exited;
out.end();
console.log(`--- exit=${code} events=${n} raw=${outPath}`);
if (stderr.trim()) console.log(`--- stderr:\n${stderr.trim().slice(-2000)}`);
