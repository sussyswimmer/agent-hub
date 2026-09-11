#!/usr/bin/env bun
// Copy selected raw Phase 0 captures into the Rust test fixtures, with local paths scrubbed.
// Usage: bun run scripts/fixtures-sanitize.ts <mapping.json>   (or edit MAP below)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const DEST = `${import.meta.dir}/../crates/quintet-core/tests/fixtures/stream`;
const MAP: Record<string, string> = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : {};

const scrub = (s: string) =>
  s
    .replaceAll(/\/tmp\/claude-0\/[^"\\\s]*?\/scratchpad\/[a-z0-9]+/g, "/HOME/Quintet/agents/test/workspace")
    .replaceAll(/\/home\/user\/agent-hub/g, "/REPO")
    .replaceAll(/\/root\b/g, "/HOME")
    .replaceAll(/\/Users\/[A-Za-z0-9._-]+/g, "/HOME");

mkdirSync(DEST, { recursive: true });
for (const [dest, src] of Object.entries(MAP)) {
  const raw = readFileSync(src, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  // Drop `signature` blobs from thinking blocks: large, opaque, and irrelevant to parsing.
  const cleaned = lines.map((l) => {
    try {
      const e = JSON.parse(l);
      if (e.type === "assistant" && Array.isArray(e.message?.content)) {
        for (const c of e.message.content) if (c.type === "thinking" && "signature" in c) c.signature = "<redacted>";
      }
      return JSON.stringify(e);
    } catch {
      return l;
    }
  });
  writeFileSync(`${DEST}/${dest}`, scrub(cleaned.join("\n")) + "\n");
  console.log(`${dest} <- ${src} (${lines.length} events)`);
}
