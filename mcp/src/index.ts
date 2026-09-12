#!/usr/bin/env bun
// quintet-mcp: MCP server + CLI for Quintet. See CLAUDE.md §6.
//
//   quintet-mcp serve --agent <id> --run <run_id>   MCP stdio server (tools scoped to that run)
//   quintet-mcp doctor                               health check (JSON)
//   quintet-mcp auth google | exec <id> | sync ...   Phase 3

const USAGE = `quintet-mcp <serve|doctor|auth|exec|sync> [...args]`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "serve": return (await import("./cli/serve")).serve(rest);
    case "doctor": return (await import("./cli/doctor")).doctor();
    case "auth":
    case "exec":
    case "sync":
      console.error(`${cmd}: not implemented until Phase 3`);
      return 2;
    case undefined:
    case "-h":
    case "--help":
      console.log(USAGE);
      return cmd === undefined ? 1 : 0;
    default:
      console.error(`unknown subcommand: ${cmd}\n${USAGE}`);
      return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

export {};
