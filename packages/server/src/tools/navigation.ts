// ============================================================================
// Linkedsword MCP — Navigation Tools
// Project exploration, structure analysis, multi-instance management
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio, success, error } from "./_helpers.js";

export const registerNavigationTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("get_file_tree", {
    title: "Get file tree",
    description: `Get the full hierarchy of the Roblox place — scripts, models, folders, services.
Returns a tree structure showing every instance and its children.
Use this as your first call to understand the project layout.
Tip: Use depth=2 or depth=3 for large places to keep output manageable.

Args:
  - path (string, optional): Root path to start from (default: "game")
  - depth (number, optional): Max depth to traverse (default: -1 for unlimited)

Returns: Nested tree of instance names, types, and children.`,
    inputSchema: {
      path: z.string().default("game").describe("Root path (e.g. 'game.Workspace')"),
      depth: z.number().int().min(-1).max(20).default(-1).describe("Max depth (-1 = unlimited)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_file_tree", params));

  server.registerTool("get_project_structure", {
    title: "Get project structure (compressed)",
    description: `Get a smart-compressed project structure optimized for LLM context.
Collapses deep branches, deduplicates patterns, summarizes large script bodies.
More token-efficient than get_file_tree for initial project understanding.

Returns: Compressed tree with service summaries and script counts.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "get_project_structure", {}));

  server.registerTool("get_place_info", {
    title: "Get place info",
    description: `Get metadata about the currently open place — name, place ID, creator, game settings.

Returns: { name, placeId, creatorId, creatorType, description }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "get_place_info", {}));

  server.registerTool("get_services", {
    title: "Get services",
    description: `List all services in the DataModel (Workspace, ReplicatedStorage, ServerScriptService, etc.).

Returns: Array of service names and their child counts.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "get_services", {}));

  server.registerTool("list_roblox_studios", {
    title: "List connected Studio instances",
    description: `List all Roblox Studio instances currently connected to Linkedsword.
Shows place name, ID, plugin version, and which instance is active.

Returns: Array of { id, placeName, placeId, active, lastHeartbeat }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => success(bridge.getInstances()));

  server.registerTool("set_active_studio", {
    title: "Set active Studio instance",
    description: `Switch the active Studio instance. All subsequent tool calls will target this instance.

Args:
  - instanceId (string): The ID of the instance to activate (from list_roblox_studios)`,
    inputSchema: {
      instanceId: z.string().describe("Instance ID to activate"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const ok = bridge.setActiveInstance(params.instanceId);
    return ok
      ? success({ message: `Switched active instance to ${params.instanceId}` })
      : error("Instance not found. Use list_roblox_studios to see available instances.");
  });
};
