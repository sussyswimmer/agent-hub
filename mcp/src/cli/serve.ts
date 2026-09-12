import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ContextError, loadContext } from "../context";
import { buildServer } from "../server";

export async function serve(argv: string[]): Promise<number> {
  let ctx;
  try {
    ctx = loadContext(argv);
  } catch (e) {
    console.error(`quintet-mcp serve: ${e instanceof ContextError ? e.message : String(e)}`);
    return 1;
  }
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => { process.stdin.on("close", resolve); process.stdin.on("end", resolve); });
  ctx.db.close();
  return 0;
}
