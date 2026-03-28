// ============================================================================
// Linkedsword — Search & Inspection Tools
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio } from "./_helpers.js";

export const registerSearchTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("search_files", {
    title: "Search files",
    description: `Search for scripts and instances by name pattern. Supports partial matches.

Args:
  - query (string): Name or partial name to search for
  - classFilter (string, optional): Filter by ClassName (e.g. "Script", "ModuleScript", "LocalScript")

Returns: Array of { name, path, className } matches.`,
    inputSchema: {
      query: z.string().min(1).describe("Search query"),
      classFilter: z.string().optional().describe("Filter by ClassName"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "search_files", params));

  server.registerTool("search_objects", {
    title: "Search objects",
    description: `Find any instance in the DataModel by name, class, or both.

Args:
  - name (string, optional): Instance name pattern
  - className (string, optional): Exact ClassName to match
  - parent (string, optional): Scope search under this path (e.g. "game.Workspace")

Returns: Array of { name, path, className } matches.`,
    inputSchema: {
      name: z.string().optional().describe("Name pattern to search"),
      className: z.string().optional().describe("ClassName to match"),
      parent: z.string().optional().describe("Parent path to scope search"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "search_objects", params));

  server.registerTool("search_by_property", {
    title: "Search by property",
    description: `Find instances with a specific property value.

Args:
  - propertyName (string): The property to check (e.g. "BrickColor", "Material", "Anchored")
  - propertyValue (string): The value to match
  - className (string, optional): Filter by class
  - parent (string, optional): Scope under this path

Returns: Array of matching instances with their paths.`,
    inputSchema: {
      propertyName: z.string().describe("Property name"),
      propertyValue: z.string().describe("Value to match"),
      className: z.string().optional().describe("ClassName filter"),
      parent: z.string().optional().describe("Parent path scope"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "search_by_property", params));

  server.registerTool("get_instance_properties", {
    title: "Get instance properties",
    description: `Read all properties of a specific instance.

Args:
  - path (string): Full path to the instance (e.g. "game.Workspace.Part")

Returns: Object with all property name/value pairs.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_instance_properties", params));

  server.registerTool("get_instance_children", {
    title: "Get instance children",
    description: `List immediate children of an instance.

Args:
  - path (string): Instance path

Returns: Array of { name, className } children.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_instance_children", params));

  server.registerTool("get_class_info", {
    title: "Get class info",
    description: `Get API reference information for any Roblox class — properties, methods, events, superclass.

Args:
  - className (string): The class name (e.g. "Part", "Humanoid", "MarketplaceService")

Returns: Class details including properties, methods, events, and inheritance.`,
    inputSchema: {
      className: z.string().describe("Roblox class name"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_class_info", params));

  server.registerTool("get_selection", {
    title: "Get current selection",
    description: `Get the instances currently selected in the Studio Explorer panel.

Returns: Array of selected instance paths and classNames.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "get_selection", {}));

  server.registerTool("grep_scripts", {
    title: "Grep scripts",
    description: `Search across all script sources using patterns. Like ripgrep for your Roblox project.

Args:
  - pattern (string): Search pattern (Lua pattern or regex)
  - useRegex (boolean, optional): Use JavaScript regex instead of Lua patterns (default: false)
  - contextLines (number, optional): Lines of context around matches (default: 2)
  - scriptType (string, optional): Filter to "Script", "LocalScript", or "ModuleScript"

Returns: Array of matches with script path, line number, matching line, and context.`,
    inputSchema: {
      pattern: z.string().min(1).describe("Search pattern"),
      useRegex: z.boolean().default(false).describe("Use regex instead of Lua patterns"),
      contextLines: z.number().int().min(0).max(10).default(2).describe("Context lines around matches"),
      scriptType: z.string().optional().describe("Filter by script type"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "grep_scripts", params));

  server.registerTool("mass_get_property", {
    title: "Mass get property",
    description: `Read the same property from multiple instances at once.

Args:
  - paths (string[]): Array of instance paths
  - propertyName (string): Property to read

Returns: Array of { path, value } results.`,
    inputSchema: {
      paths: z.array(z.string()).min(1).max(200).describe("Instance paths"),
      propertyName: z.string().describe("Property name to read"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "mass_get_property", params));

  server.registerTool("set_selection", {
    title: "Set Explorer selection",
    description: `Set the current selection in the Studio Explorer panel.

Args:
  - paths (string[]): Instance paths to select (min 1, max 100)

Returns: Confirmation with selected paths.`,
    inputSchema: {
      paths: z.array(z.string()).min(1).max(100).describe("Instance paths to select"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "set_selection", params));

  server.registerTool("get_descendants", {
    title: "Get descendants",
    description: `Get all descendants of an instance with optional filters.

Args:
  - path (string, optional): Instance path (default: "game.Workspace")
  - className (string, optional): Filter by ClassName
  - namePattern (string, optional): Filter by name pattern
  - maxDepth (number, optional): Maximum depth to traverse
  - limit (number, optional): Max results to return (default: 500, max: 2000)

Returns: Array of { name, path, className } descendants.`,
    inputSchema: {
      path: z.string().default("game.Workspace").describe("Root instance path"),
      className: z.string().optional().describe("Filter by ClassName"),
      namePattern: z.string().optional().describe("Filter by name pattern"),
      maxDepth: z.number().int().optional().describe("Max depth to traverse"),
      limit: z.number().int().max(2000).default(500).describe("Max results"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_descendants", params));
};
