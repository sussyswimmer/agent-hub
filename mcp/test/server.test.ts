// In-process MCP round trip: client ↔ server over InMemoryTransport.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";

import { buildServer } from "../src/server";
import { isAllowed } from "../src/allowlist";
import { tempContext } from "./helpers/tempdb";

async function connect(agentId = "research") {
  const ctx = tempContext(agentId);
  const server = buildServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return { ctx, client };
}

describe("server", () => {
  test("lists the four protocol tools and round-trips each", async () => {
    const { ctx, client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["ask_user", "now", "propose_action", "save_output"]);

    const n = await client.callTool({ name: "now", arguments: {} });
    expect((n.structuredContent as { tz: string }).tz).toBe("Asia/Saigon");

    const q = await client.callTool({ name: "ask_user", arguments: { questions: [{ id: "depth", prompt: "How deep?", type: "single", options: ["quick", "standard"] }] } });
    expect((q.content as { text: string }[])[0]!.text).toContain("Queued 1 question");
    expect(ctx.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM questions WHERE status='pending'").get()?.n).toBe(1);

    const p = await client.callTool({ name: "propose_action", arguments: { type: "drive.create_doc", payload: { title: "Brief", folder: "Quintet/research", content_md: "# Brief" }, preview_md: "Create **Brief** in Drive" } });
    expect((p.structuredContent as { action_id: string }).action_id).toHaveLength(26);

    const s = await client.callTool({ name: "save_output", arguments: { content: "hello", kind: "md", title: "Hello" } });
    expect((s.content as { text: string }[])[0]!.text).toContain("Registered");

    const bad = await client.callTool({ name: "propose_action", arguments: { type: "gmail.send", payload: {}, preview_md: "x" } });
    expect(bad.isError).toBe(true);
  });

  test("allowlist gates registration", async () => {
    expect(isAllowed("ask_user", "anyone")).toBe(true);
    expect(isAllowed("gmail_search", "scout")).toBe(false);
  });
});
