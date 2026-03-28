// ============================================================================
// Linkedsword MCP — Script Tools
// Script reading, editing with diff staging, grep-replace, Luau execution
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio, success, error } from "./_helpers.js";
import { computeDiff, formatDiffSummary } from "../services/diff-engine.js";

export const registerScriptTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("get_script_source", {
    title: "Get script source",
    description: `Read the source code of a script with line numbers.

Args:
  - path (string): Path to the script (e.g. "game.ServerScriptService.Main")

Returns: { source: string, numberedSource: string, lineCount: number }
The numberedSource field has "N: code" format for accurate line identification.`,
    inputSchema: {
      path: z.string().describe("Script path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_script_source", params));

  server.registerTool("set_script_source", {
    title: "Set script source (staged)",
    description: `Write new source code to a script. The change is NOT applied immediately — it is staged
as a diff in the review queue. The user can accept or reject individual hunks in the Linkedsword plugin.

If auto-accept is enabled (for unattended agentic loops), changes apply immediately.

Args:
  - path (string): Script path
  - source (string): Complete new source code

Returns: Diff summary showing what changed, with hunk count and line additions/removals.
If any hunks are rejected, the rejection context will be included in subsequent tool responses.`,
    inputSchema: {
      path: z.string().describe("Script path"),
      source: z.string().describe("Complete new source code"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    // First, get the current source
    const currentResult = await bridge.sendToStudio("get_script_source", { path: params.path });
    if (!currentResult.success) {
      return error(currentResult.error ?? "Failed to read current script source");
    }

    const currentSource = (currentResult.data as { source: string }).source ?? "";
    const config = bridge.getConfig();

    // If auto-accept is on, write directly
    if (config.autoAccept) {
      const writeResult = await bridge.sendToStudio("set_script_source_direct", {
        path: params.path,
        source: params.source,
      });
      return writeResult.success
        ? success({ message: `Script updated (auto-accepted): ${params.path}`, linesChanged: params.source.split("\n").length })
        : error(writeResult.error ?? "Failed to write script");
    }

    // Compute diff and stage it
    const scriptName = params.path.split(".").pop() ?? params.path;
    const diff = computeDiff(params.path, scriptName, currentSource, params.source);

    if (diff.hunks.length === 0) {
      return success({ message: "No changes detected — source is identical.", path: params.path });
    }

    // Stage the diff for review
    bridge.stageDiff(diff);

    // Also send diff data to plugin for rendering
    await bridge.sendToStudio("stage_diff", {
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks,
    });

    return success({
      message: `Diff staged for review in Linkedsword plugin`,
      diffId: diff.id,
      scriptPath: params.path,
      hunks: diff.hunks.length,
      added: diff.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0),
      removed: diff.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "del").length, 0),
      summary: formatDiffSummary(diff),
    });
  });

  server.registerTool("patch_script", {
    title: "Patch script (targeted edit)",
    description: `Apply a targeted edit to a script — replace a specific section of code.
The change is staged as a diff for review (unless auto-accept is on).

Args:
  - path (string): Script path
  - oldText (string): The exact text to find and replace (must match uniquely)
  - newText (string): Replacement text

Returns: Diff summary of the targeted change.`,
    inputSchema: {
      path: z.string().describe("Script path"),
      oldText: z.string().describe("Exact text to find"),
      newText: z.string().describe("Replacement text"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const currentResult = await bridge.sendToStudio("get_script_source", { path: params.path });
    if (!currentResult.success) {
      return error(currentResult.error ?? "Failed to read current script source");
    }

    const currentSource = (currentResult.data as { source: string }).source ?? "";
    const occurrences = currentSource.split(params.oldText).length - 1;

    if (occurrences === 0) {
      return error(`Text not found in ${params.path}. Use get_script_source to see the current code.`);
    }
    if (occurrences > 1) {
      return error(`Text matches ${occurrences} locations in ${params.path}. Be more specific to ensure a unique match.`);
    }

    const newSource = currentSource.replace(params.oldText, params.newText);
    const scriptName = params.path.split(".").pop() ?? params.path;
    const diff = computeDiff(params.path, scriptName, currentSource, newSource);

    if (diff.hunks.length === 0) {
      return success({ message: "No changes detected.", path: params.path });
    }

    const config = bridge.getConfig();
    if (config.autoAccept) {
      const writeResult = await bridge.sendToStudio("set_script_source_direct", {
        path: params.path,
        source: newSource,
      });
      return writeResult.success
        ? success({ message: `Patch applied (auto-accepted): ${params.path}` })
        : error(writeResult.error ?? "Failed to write script");
    }

    bridge.stageDiff(diff);
    await bridge.sendToStudio("stage_diff", {
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks,
    });

    return success({
      message: `Patch staged for review`,
      diffId: diff.id,
      scriptPath: params.path,
      summary: formatDiffSummary(diff),
    });
  });

  server.registerTool("grep_replace", {
    title: "Grep and replace across scripts",
    description: `Find and replace text across all scripts. Changes are staged as diffs for review.

Args:
  - find (string): Text or pattern to find
  - replace (string): Replacement text
  - useRegex (boolean, optional): Use regex matching (default: false)
  - scriptType (string, optional): Filter by script type
  - dryRun (boolean, optional): Preview changes without staging (default: false)

Returns: Summary of all scripts affected with diff previews.`,
    inputSchema: {
      find: z.string().min(1).describe("Text to find"),
      replace: z.string().describe("Replacement text"),
      useRegex: z.boolean().default(false).describe("Use regex"),
      scriptType: z.string().optional().describe("Filter script type"),
      dryRun: z.boolean().default(false).describe("Preview only"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "grep_replace", params));

  server.registerTool("execute_luau", {
    title: "Execute Luau code",
    description: `Run arbitrary Luau code directly in Studio's edit context.
Useful for one-off queries, batch operations, or anything the built-in tools don't cover.
The code runs synchronously and returns whatever is printed via print().

Args:
  - code (string): Luau code to execute

Returns: { output: string } — captured print() output.`,
    inputSchema: {
      code: z.string().min(1).describe("Luau code to execute"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "execute_luau", params));

  server.registerTool("run_code", {
    title: "Run code",
    description: `Execute Luau code in Studio and return printed output. Alias for execute_luau.

Args:
  - code (string): Luau code to execute

Returns: Captured print output.`,
    inputSchema: {
      code: z.string().min(1).describe("Luau code"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "run_code", params));

  server.registerTool("edit_script_lines", {
    title: "Edit script lines",
    description: `Replace a range of lines in a script. The change is staged as a diff for review (unless auto-accept is on).

Args:
  - path (string): Script path
  - startLine (number): First line to replace (1-based)
  - endLine (number): Last line to replace (1-based)
  - newContent (string): Replacement content for the line range

Returns: Diff summary of the change.`,
    inputSchema: {
      path: z.string().describe("Script path"),
      startLine: z.number().int().min(1).describe("Start line (1-based)"),
      endLine: z.number().int().min(1).describe("End line (1-based)"),
      newContent: z.string().describe("Replacement content"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const currentResult = await bridge.sendToStudio("get_script_source", { path: params.path });
    if (!currentResult.success) {
      return error(currentResult.error ?? "Failed to read current script source");
    }

    const currentSource = (currentResult.data as { source: string }).source ?? "";
    const lines = currentSource.split("\n");

    if (params.startLine > lines.length || params.endLine > lines.length) {
      return error(`Line range ${params.startLine}-${params.endLine} is out of bounds (script has ${lines.length} lines).`);
    }
    if (params.startLine > params.endLine) {
      return error(`startLine (${params.startLine}) must be <= endLine (${params.endLine}).`);
    }

    const newLines = [...lines];
    const replacementLines = params.newContent.split("\n");
    newLines.splice(params.startLine - 1, params.endLine - params.startLine + 1, ...replacementLines);
    const newSource = newLines.join("\n");

    const scriptName = params.path.split(".").pop() ?? params.path;
    const diff = computeDiff(params.path, scriptName, currentSource, newSource);

    if (diff.hunks.length === 0) {
      return success({ message: "No changes detected.", path: params.path });
    }

    const config = bridge.getConfig();
    if (config.autoAccept) {
      const writeResult = await bridge.sendToStudio("set_script_source_direct", {
        path: params.path,
        source: newSource,
      });
      return writeResult.success
        ? success({ message: `Lines ${params.startLine}-${params.endLine} replaced (auto-accepted): ${params.path}` })
        : error(writeResult.error ?? "Failed to write script");
    }

    bridge.stageDiff(diff);
    await bridge.sendToStudio("stage_diff", {
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks,
    });

    return success({
      message: `Edit staged for review`,
      diffId: diff.id,
      scriptPath: params.path,
      summary: formatDiffSummary(diff),
    });
  });

  server.registerTool("insert_script_lines", {
    title: "Insert script lines",
    description: `Insert new lines into a script after a given line. The change is staged as a diff for review (unless auto-accept is on).

Args:
  - path (string): Script path
  - afterLine (number): Insert after this line (0 = insert at top)
  - content (string): Content to insert

Returns: Diff summary of the change.`,
    inputSchema: {
      path: z.string().describe("Script path"),
      afterLine: z.number().int().min(0).describe("Insert after this line (0 = top)"),
      content: z.string().describe("Content to insert"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const currentResult = await bridge.sendToStudio("get_script_source", { path: params.path });
    if (!currentResult.success) {
      return error(currentResult.error ?? "Failed to read current script source");
    }

    const currentSource = (currentResult.data as { source: string }).source ?? "";
    const lines = currentSource.split("\n");

    if (params.afterLine > lines.length) {
      return error(`afterLine (${params.afterLine}) is out of bounds (script has ${lines.length} lines).`);
    }

    const insertLines = params.content.split("\n");
    const newLines = [...lines];
    newLines.splice(params.afterLine, 0, ...insertLines);
    const newSource = newLines.join("\n");

    const scriptName = params.path.split(".").pop() ?? params.path;
    const diff = computeDiff(params.path, scriptName, currentSource, newSource);

    if (diff.hunks.length === 0) {
      return success({ message: "No changes detected.", path: params.path });
    }

    const config = bridge.getConfig();
    if (config.autoAccept) {
      const writeResult = await bridge.sendToStudio("set_script_source_direct", {
        path: params.path,
        source: newSource,
      });
      return writeResult.success
        ? success({ message: `Lines inserted after line ${params.afterLine} (auto-accepted): ${params.path}` })
        : error(writeResult.error ?? "Failed to write script");
    }

    bridge.stageDiff(diff);
    await bridge.sendToStudio("stage_diff", {
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks,
    });

    return success({
      message: `Insert staged for review`,
      diffId: diff.id,
      scriptPath: params.path,
      summary: formatDiffSummary(diff),
    });
  });

  server.registerTool("delete_script_lines", {
    title: "Delete script lines",
    description: `Delete a range of lines from a script. The change is staged as a diff for review (unless auto-accept is on).

Args:
  - path (string): Script path
  - startLine (number): First line to delete (1-based)
  - endLine (number): Last line to delete (1-based)

Returns: Diff summary of the change.`,
    inputSchema: {
      path: z.string().describe("Script path"),
      startLine: z.number().int().min(1).describe("Start line (1-based)"),
      endLine: z.number().int().min(1).describe("End line (1-based)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const currentResult = await bridge.sendToStudio("get_script_source", { path: params.path });
    if (!currentResult.success) {
      return error(currentResult.error ?? "Failed to read current script source");
    }

    const currentSource = (currentResult.data as { source: string }).source ?? "";
    const lines = currentSource.split("\n");

    if (params.startLine > lines.length || params.endLine > lines.length) {
      return error(`Line range ${params.startLine}-${params.endLine} is out of bounds (script has ${lines.length} lines).`);
    }
    if (params.startLine > params.endLine) {
      return error(`startLine (${params.startLine}) must be <= endLine (${params.endLine}).`);
    }

    const newLines = [...lines];
    newLines.splice(params.startLine - 1, params.endLine - params.startLine + 1);
    const newSource = newLines.join("\n");

    const scriptName = params.path.split(".").pop() ?? params.path;
    const diff = computeDiff(params.path, scriptName, currentSource, newSource);

    if (diff.hunks.length === 0) {
      return success({ message: "No changes detected.", path: params.path });
    }

    const config = bridge.getConfig();
    if (config.autoAccept) {
      const writeResult = await bridge.sendToStudio("set_script_source_direct", {
        path: params.path,
        source: newSource,
      });
      return writeResult.success
        ? success({ message: `Lines ${params.startLine}-${params.endLine} deleted (auto-accepted): ${params.path}` })
        : error(writeResult.error ?? "Failed to write script");
    }

    bridge.stageDiff(diff);
    await bridge.sendToStudio("stage_diff", {
      diffId: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks,
    });

    return success({
      message: `Deletion staged for review`,
      diffId: diff.id,
      scriptPath: params.path,
      summary: formatDiffSummary(diff),
    });
  });
};
