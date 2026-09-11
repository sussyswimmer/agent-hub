#!/usr/bin/env bun
// Phase 0 stub MCP server: one tool, `ping` -> "pong". Used to verify that
// `claude -p --mcp-config` lists `mcp__quintet__ping` in the system/init event.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "quintet", version: "0.0.0-stub" });
server.registerTool("ping", { description: "Health check. Replies with pong." }, async () => ({
  content: [{ type: "text", text: "pong" }],
}));
await server.connect(new StdioServerTransport());
