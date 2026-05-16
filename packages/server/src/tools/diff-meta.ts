// ============================================================================
// Linkedsword MCP — Diff & Meta Tools
// Diff queue management, activity log, mode control, rollback
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, success, error, callStudio } from "./_helpers.js";
import { formatDiffSummary, getRejectionContext } from "../services/diff-engine.js";

export const registerDiffTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("get_diff_queue", {
    title: "Get pending diffs",
    description: `Get all script diffs currently staged and awaiting review in the Linkedsword plugin.
Shows diff summaries with hunk counts, addition/removal stats, and status.

Returns: Array of pending diffs with summaries. Empty array if no diffs are pending.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const diffs = bridge.getDiffQueue();
    if (diffs.length === 0) {
      return success({ message: "No pending diffs.", count: 0 });
    }
    return success({
      count: diffs.length,
      diffs: diffs.map((d) => ({
        id: d.id,
        scriptPath: d.scriptPath,
        hunks: d.hunks.length,
        added: d.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0),
        removed: d.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "del").length, 0),
        accepted: d.hunks.filter((h) => h.status === "accepted").length,
        rejected: d.hunks.filter((h) => h.status === "rejected").length,
        pending: d.hunks.filter((h) => h.status === "pending").length,
        summary: formatDiffSummary(d),
      })),
    });
  });

  server.registerTool("resolve_diff", {
    title: "Resolve diff (programmatic)",
    description: `Programmatically accept or reject a diff. Useful for auto-accept workflows.

Args:
  - diffId (string): The diff ID
  - action (string): "accept_all" | "reject_all"

Returns: Resolution summary.`,
    inputSchema: {
      diffId: z.string().describe("Diff ID"),
      action: z.enum(["accept_all", "reject_all"]).describe("Action to take"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const diff = bridge.getDiff(params.diffId);
    if (!diff) return error("Diff not found. Use get_diff_queue to see pending diffs.");

    diff.hunks.forEach((h) => {
      h.status = params.action === "accept_all" ? "accepted" : "rejected";
    });

    if (params.action === "accept_all") {
      // Apply to Studio
      const result = await bridge.sendToStudio("set_script_source_direct", {
        path: diff.scriptPath,
        source: diff.newSource,
      });
      if (!result.success) return error(`Failed to apply diff: ${result.error}`);
    }

    const rejectionCtx = getRejectionContext(diff);

    // Archive and clean up resolved diff from queue
    bridge.archiveAndDeleteDiff(params.diffId);

    return success({
      message: `Diff ${params.action === "accept_all" ? "accepted and applied" : "rejected"}`,
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      rejectionContext: rejectionCtx,
    });
  });

  server.registerTool("get_diff_history", {
    title: "Get resolved diff history",
    description: `Get history of previously resolved script diffs (accepted, rejected, or partial).
Shows what changes were made, which hunks were accepted/rejected, and when.

Args:
  - limit (number, optional): Max entries to return (default: 20, max: 100)

Returns: Array of resolved diffs with outcomes, line stats, and hunk details.`,
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("Max entries to return"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const history = bridge.getDiffHistory(params.limit);
    if (history.length === 0) {
      return success({ message: "No diff history.", count: 0 });
    }
    return success({
      count: history.length,
      diffs: history.map((d) => ({
        id: d.id,
        scriptPath: d.scriptPath,
        outcome: d.outcome,
        added: d.addCount,
        removed: d.delCount,
        hunks: d.hunks.length,
        timestamp: d.timestamp,
        resolvedAt: d.resolvedAt,
      })),
    });
  });

  server.registerTool("get_activity_log", {
    title: "Get activity log",
    description: `Get the structured log of all MCP tool operations — timing, status, and summaries.

Args:
  - limit (number, optional): Number of entries to return (default: 50, max: 200)

Returns: Array of activity entries with tool name, params, result, duration.`,
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Max entries to return"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => success(bridge.getActivityLog(params.limit)));

  server.registerTool("set_mode", {
    title: "Set Linkedsword mode",
    description: `Switch the operating mode of Linkedsword.
- "full": All tools available (read + write)
- "inspector": Read-only tools only — no writes, no script edits, no object creation
- "sandbox": Writes go to a shadow copy (experimental)

Args:
  - mode (string): "full" | "inspector" | "sandbox"

Returns: Confirmation with new mode.`,
    inputSchema: {
      mode: z.enum(["full", "inspector", "sandbox"]).describe("Operating mode"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    bridge.updateConfig({ mode: params.mode });
    return success({ message: `Mode set to "${params.mode}"`, mode: params.mode });
  });

  server.registerTool("rollback", {
    title: "Rollback operations",
    description: `Trigger undo in Studio to rollback the last N operations.

Args:
  - count (number, optional): Number of undo steps (default: 1, max: 50)

Returns: Confirmation of rollback.`,
    inputSchema: {
      count: z.number().int().min(1).max(50).default(1).describe("Undo steps"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "rollback", params));

  // Attribute tools
  server.registerTool("get_attribute", {
    title: "Get attribute",
    description: `Read a single attribute from an instance.

Args:
  - path (string): Instance path
  - name (string): Attribute name

Returns: Attribute value.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      name: z.string().describe("Attribute name"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_attribute", params));

  server.registerTool("get_attributes", {
    title: "Get all attributes",
    description: `Read all attributes on an instance.

Args:
  - path (string): Instance path

Returns: Object of attribute name/value pairs.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_attributes", params));

  server.registerTool("get_tags", {
    title: "Get tags",
    description: `Read CollectionService tags on an instance.

Args:
  - path (string): Instance path

Returns: Array of tag strings.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_tags", params));

  server.registerTool("get_tagged", {
    title: "Get instances by tag",
    description: `Find all instances with a specific CollectionService tag.

Args:
  - tag (string): Tag name

Returns: Array of { name, path, className } for tagged instances.`,
    inputSchema: {
      tag: z.string().describe("Tag name"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_tagged", params));

  server.registerTool("capture_screenshot", {
    title: "Get viewport info",
    description: `Get metadata about the current Studio viewport — camera position, look direction, FOV, and visible objects.
Note: Pixel capture is not available in Studio plugins. This returns camera metadata for spatial reasoning.

Returns: { position, lookVector, fieldOfView, viewportSize, visibleObjects[] }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "capture_screenshot", {}));

  // Build library tools
  server.registerTool("export_build", {
    title: "Export build to library",
    description: `Save a selection of instances as a versioned JSON snapshot in the build library.

Args:
  - path (string): Instance path to export
  - name (string): Name for the build entry
  - description (string, optional): Description

Returns: { buildId, name, instanceCount }`,
    inputSchema: {
      path: z.string().describe("Instance path to export"),
      name: z.string().describe("Build name"),
      description: z.string().optional().describe("Build description"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "export_build", params));

  server.registerTool("import_build", {
    title: "Import build from library",
    description: `Load a saved build from the library into Studio.

Args:
  - name (string): Build name to import
  - parent (string, optional): Parent path (default: "game.Workspace")

Returns: Confirmation with imported instance paths.`,
    inputSchema: {
      name: z.string().describe("Build name"),
      parent: z.string().default("game.Workspace").describe("Parent path"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "import_build", params));

  server.registerTool("list_library", {
    title: "List build library",
    description: `Browse all saved builds in the library.

Returns: Array of { name, description, instanceCount, timestamp }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "list_library", {}));

  server.registerTool("insert_model", {
    title: "Insert model from Creator Store",
    description: `Insert a model from the Roblox Creator Store into the workspace.

Args:
  - assetId (number): The Creator Store asset ID

Returns: { name, path } of the inserted model.`,
    inputSchema: {
      assetId: z.number().int().positive().describe("Creator Store asset ID"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "insert_model", params));

  // Attribute mutation tools
  server.registerTool("set_attribute", {
    title: "Set attribute",
    description: `Set an attribute on an instance.

Args:
  - path (string): Instance path
  - name (string): Attribute name
  - value (any): Attribute value

Returns: Confirmation with old and new values.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      name: z.string().describe("Attribute name"),
      value: z.unknown().describe("Attribute value"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "set_attribute", params as Record<string, unknown>));

  server.registerTool("delete_attribute", {
    title: "Delete attribute",
    description: `Delete an attribute from an instance.

Args:
  - path (string): Instance path
  - name (string): Attribute name

Returns: Confirmation message.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      name: z.string().describe("Attribute name"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "delete_attribute", params));

  server.registerTool("add_tag", {
    title: "Add tag",
    description: `Add a CollectionService tag to an instance.

Args:
  - path (string): Instance path
  - tag (string): Tag name

Returns: Confirmation message.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      tag: z.string().describe("Tag name"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "add_tag", params));

  server.registerTool("remove_tag", {
    title: "Remove tag",
    description: `Remove a CollectionService tag from an instance.

Args:
  - path (string): Instance path
  - tag (string): Tag name

Returns: Confirmation message.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      tag: z.string().describe("Tag name"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "remove_tag", params));

  server.registerTool("redo", {
    title: "Redo operations",
    description: `Trigger redo in Studio to redo the last N operations.

Args:
  - count (number, optional): Number of redo steps (default: 1, max: 50)

Returns: Confirmation of redo.`,
    inputSchema: {
      count: z.number().int().min(1).max(50).default(1).describe("Redo steps"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "redo", params));

  server.registerTool("set_auto_accept", {
    title: "Set auto-accept budget",
    description: `Control how the next staged script diffs are handled. Three scopes:
- "off": Every diff stages and waits for human review (default).
- "next_n": Auto-apply the next N diffs without review, then revert to "off". Pass \`count\`.
- "session": Auto-apply every diff until explicitly turned off or the plugin reconnects.

Args:
  - scope (enum): "off" | "next_n" | "session"
  - count (number, optional): Required for "next_n". Range 1-50.

Returns: { mode, remaining }.`,
    inputSchema: {
      scope: z.enum(["off", "next_n", "session"]).describe("Budget scope"),
      count: z.number().int().min(1).max(50).optional().describe("Diff count for next_n"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    if (params.scope === "next_n" && !params.count) {
      return error("count is required when scope is 'next_n'");
    }
    const budget = bridge.setAutoAcceptBudget(params.scope, params.count);
    return success({ mode: budget.mode, remaining: budget.remaining, setAt: budget.setAt });
  });

  server.registerTool("get_auto_accept_status", {
    title: "Get auto-accept budget status",
    description: `Read the current auto-accept budget state.

Returns: { mode, remaining }. \`remaining\` is null for "session", an integer for "next_n", and 0 for "off".`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const budget = bridge.getAutoAcceptBudget();
    return success({ mode: budget.mode, remaining: budget.remaining, setAt: budget.setAt });
  });

  server.registerTool("get_console_output", {
    title: "Get console output",
    description: `Get console logs (print, warn, error) from Studio's Output panel. Captures continuously from plugin startup — not just during playtest.

Args:
  - since (number, optional): Only return logs after this timestamp
  - limit (number, optional): Max logs to return (default: 100, max: 500)
  - type (enum "all"|"output"|"warning"|"error", default "all"): Filter by log level

Returns: Array of { type, message, timestamp } log entries.`,
    inputSchema: {
      since: z.number().optional().describe("Timestamp to get logs after"),
      limit: z.number().int().min(1).max(500).default(100).describe("Max logs to return"),
      type: z.enum(["all", "output", "warning", "error"]).default("all").describe("Filter by log level"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_console_output", params));
};
