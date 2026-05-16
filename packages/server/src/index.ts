#!/usr/bin/env node
// ============================================================================
// Linkedsword MCP Server — Main Entry Point
// Agentic Roblox Studio integration with script diffs, bulk ops, and a cat.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpBridge } from "./services/bridge.js";
import { VERSION, SERVER_NAME, DEFAULT_PORT } from "./constants.js";

// Tool registrars
import { registerNavigationTools } from "./tools/navigation.js";
import { registerSearchTools } from "./tools/search.js";
import { registerScriptTools } from "./tools/script.js";
import { registerInstanceTools } from "./tools/instance.js";
import { registerPlaytestTools } from "./tools/playtest.js";
import { registerDiffTools } from "./tools/diff-meta.js";
import { registerSpatialTools } from "./tools/spatial.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerPlanTools } from "./tools/plan.js";

import { runCli } from "./cli.js";

const CLI_SUBCOMMANDS = new Set(["install", "auth", "help", "--help", "-h"]);

async function bootMcp(args: string[]): Promise<void> {
  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_PORT;

  const mcpServer = new McpServer({ name: SERVER_NAME, version: VERSION });
  const bridge = new HttpBridge({ port });

  registerNavigationTools(mcpServer, bridge);
  registerSearchTools(mcpServer, bridge);
  registerScriptTools(mcpServer, bridge);
  registerInstanceTools(mcpServer, bridge);
  registerPlaytestTools(mcpServer, bridge);
  registerDiffTools(mcpServer, bridge);
  registerSpatialTools(mcpServer, bridge);
  registerAssetTools(mcpServer, bridge);
  registerPlanTools(mcpServer, bridge);

  await bridge.start();
  console.error(`[ls] MCP server v${VERSION} starting...`);
  console.error(`[ls] HTTP bridge on 127.0.0.1:${port}`);
  console.error(`[ls] Waiting for Studio plugin connection...`);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[ls] MCP stdio transport connected`);
}

const args = process.argv.slice(2);
if (args[0] && CLI_SUBCOMMANDS.has(args[0])) {
  runCli(args)
    .then((handled) => process.exit(handled ? 0 : 1))
    .catch((err) => { console.error("CLI error:", err); process.exit(1); });
} else {
  bootMcp(args).catch((err) => { console.error("[ls] Fatal error:", err); process.exit(1); });
}
