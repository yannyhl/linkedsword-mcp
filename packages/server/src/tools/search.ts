// ============================================================================
// Linkedsword — Search & Inspection Tools
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio, success } from "./_helpers.js";

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

  server.registerTool("get_stable_id", {
    title: "Get stable instance handle",
    description: `Get a stable text handle (\`ls://<uuid>\`) for an instance. The handle survives rename and reparent — pass it back to any tool that accepts a path. Idempotent: subsequent calls return the same id.

Args:
  - path (string): Current instance path (or an existing ls:// handle)

Returns: { id, path, reused }`,
    inputSchema: {
      path: z.string().describe("Instance path or existing ls:// handle"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_stable_id", params));

  server.registerTool("resolve_stable_id", {
    title: "Resolve stable handle to path",
    description: `Resolve a stable handle (\`ls://<uuid>\`) back to a current instance path and metadata.

Args:
  - id (string): Stable id (the part after \`ls://\`, or the full handle)

Returns: { exists, path?, className?, name? }`,
    inputSchema: {
      id: z.string().describe("Stable id"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const id = params.id.startsWith("ls://") ? params.id.slice(5) : params.id;
    return callStudio(bridge, "resolve_stable_id", { id });
  });

  server.registerTool("compare_instances", {
    title: "Compare two instance subtrees",
    description: `Structural diff of two instance subtrees. Compares a curated set of properties plus child-by-name matching.

Args:
  - pathA (string): First instance
  - pathB (string): Second instance
  - includeChildren (bool, default true): Recurse into children
  - propertyFilter (string[], optional): Restrict to these properties

Returns: { propertyDiffs[], childrenOnlyInA[], childrenOnlyInB[], countA, countB }`,
    inputSchema: {
      pathA: z.string().describe("First instance path"),
      pathB: z.string().describe("Second instance path"),
      includeChildren: z.boolean().default(true).describe("Recurse into children"),
      propertyFilter: z.array(z.string()).optional().describe("Restrict comparison to these property names"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "compare_instances", params));

  server.registerTool("get_connected_instances", {
    title: "Find instances connected via references",
    description: `Returns instances connected to the given one through known Instance-valued properties (Part0/Part1, Attachment0/1, Adornee, ObjectValue.Value, PrimaryPart, etc.).

Args:
  - path (string): Source instance
  - direction (enum "outgoing"|"incoming"|"both", default "both")

Note: \`incoming\` scans the DataModel and is capped at 100 results — large places may report \`capped: true\`.`,
    inputSchema: {
      path: z.string().describe("Source instance path"),
      direction: z.enum(["outgoing", "incoming", "both"]).default("both").describe("Reference direction"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_connected_instances", params));

  server.registerTool("parallel_search", {
    title: "Parallel data-model search",
    description: `Run up to 5 search queries concurrently and return compact summaries. Fan-out is internally batched 3-at-a-time to avoid Studio heartbeat timeouts.

Each query routes to one of:
  - "objects": search_objects
  - "scripts": grep_scripts
  - "property": search_by_property
  - "descendants": get_descendants

Args:
  - queries (array of { type, params, label }), 1-5 entries
  - summaryOnly (boolean, default true): truncate each result body to first 5 items + count

Returns: { results: { [label]: { count, sample, raw? } }, durationMs }`,
    inputSchema: {
      queries: z.array(z.object({
        type: z.enum(["objects", "scripts", "property", "descendants"]),
        params: z.record(z.unknown()),
        label: z.string(),
      })).min(1).max(5).describe("Queries to fan out"),
      summaryOnly: z.boolean().default(true).describe("Truncate result bodies for context efficiency"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const TYPE_TO_TOOL: Record<string, string> = {
      objects: "search_objects",
      scripts: "grep_scripts",
      property: "search_by_property",
      descendants: "get_descendants",
    };
    const start = Date.now();
    const results: Record<string, { count: number; sample: unknown[]; raw?: unknown }> = {};

    // Batch in groups of 3 to stay under the heartbeat-timeout threshold.
    const BATCH = 3;
    for (let i = 0; i < params.queries.length; i += BATCH) {
      const batch = params.queries.slice(i, i + BATCH);
      const responses = await Promise.all(batch.map((q) =>
        bridge.sendToStudio(TYPE_TO_TOOL[q.type], q.params as Record<string, unknown>),
      ));
      batch.forEach((q, idx) => {
        const resp = responses[idx];
        if (!resp.success) {
          results[q.label] = { count: 0, sample: [], raw: { error: resp.error } };
          return;
        }
        const data = resp.data as unknown;
        let items: unknown[] = [];
        if (Array.isArray(data)) items = data;
        else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          for (const key of ["results", "matches", "items", "descendants", "objects", "data"]) {
            if (Array.isArray(obj[key])) { items = obj[key] as unknown[]; break; }
          }
          if (items.length === 0) items = [data];
        }
        const sample = items.slice(0, 5);
        results[q.label] = params.summaryOnly
          ? { count: items.length, sample }
          : { count: items.length, sample, raw: data };
      });
    }

    return success({ results, durationMs: Date.now() - start });
  });
};
