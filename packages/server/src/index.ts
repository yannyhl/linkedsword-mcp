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

// --------------------------------------------------------------------------
// Parse CLI args
// --------------------------------------------------------------------------

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_PORT;

// --------------------------------------------------------------------------
// Initialize
// --------------------------------------------------------------------------

const mcpServer = new McpServer({
  name: SERVER_NAME,
  version: VERSION,
});

const bridge = new HttpBridge({ port });

// --------------------------------------------------------------------------
// Register all tools
// --------------------------------------------------------------------------

registerNavigationTools(mcpServer, bridge);
registerSearchTools(mcpServer, bridge);
registerScriptTools(mcpServer, bridge);
registerInstanceTools(mcpServer, bridge);
registerPlaytestTools(mcpServer, bridge);
registerDiffTools(mcpServer, bridge);
registerSpatialTools(mcpServer, bridge);

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  // Start the HTTP bridge (plugin connects here)
  await bridge.start();
  console.error(`[ls] MCP server v${VERSION} starting...`);
  console.error(`[ls] HTTP bridge on 127.0.0.1:${port}`);
  console.error(`[ls] 73 tools registered`);
  console.error(`[ls] Waiting for Studio plugin connection...`);

  // Connect MCP over stdio (Claude Code / CLI talks here)
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[ls] MCP stdio transport connected`);
}

main().catch((err) => {
  console.error("[ls] Fatal error:", err);
  process.exit(1);
});
