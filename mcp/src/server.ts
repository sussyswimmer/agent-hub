// Builds the MCP server for one run: only the tools the calling agent may use are registered.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isAllowed } from "./allowlist";
import type { RunContext } from "./context";
import { askUserInput, nowInput, proposeActionInput, saveOutputInput } from "./schemas";
import { askUser, askUserDescription, now, nowDescription, proposeAction, proposeActionDescription, saveOutput, saveOutputDescription } from "./tools";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

export function buildServer(ctx: RunContext): McpServer {
  const server = new McpServer({ name: "quintet", version: "0.1.0" });
  const register = (name: string, fn: () => void) => { if (isAllowed(name, ctx.agentId)) fn(); };

  register("ask_user", () =>
    server.registerTool("ask_user", { description: askUserDescription, inputSchema: askUserInput }, async (args) => {
      try { return text(askUser(ctx, args)); } catch (e) { return fail(e); }
    }),
  );
  register("propose_action", () =>
    server.registerTool("propose_action", { description: proposeActionDescription, inputSchema: proposeActionInput }, async (args) => {
      try { const r = proposeAction(ctx, args); return { content: [{ type: "text", text: r.message }], structuredContent: { action_id: r.action_id } }; } catch (e) { return fail(e); }
    }),
  );
  register("save_output", () =>
    server.registerTool("save_output", { description: saveOutputDescription, inputSchema: saveOutputInput }, async (args) => {
      try { const r = saveOutput(ctx, args); return text(`Registered ${r.path} (output ${r.id}).`); } catch (e) { return fail(e); }
    }),
  );
  register("now", () =>
    server.registerTool("now", { description: nowDescription, inputSchema: nowInput }, async () => {
      const n = now();
      return { content: [{ type: "text", text: `${n.weekday} ${n.date} ${n.time} (${n.tz})` }], structuredContent: n };
    }),
  );
  return server;
}
