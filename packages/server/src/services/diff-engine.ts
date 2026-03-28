// ============================================================================
// Linkedsword — Diff Engine
// Computes structured, hunk-level diffs for the script review system
// ============================================================================

import { v4 as uuid } from "uuid";
import { diffLines, Change } from "diff";
import { DiffHunk, DiffLine, ScriptDiff } from "../types.js";

/**
 * Compute a structured diff between old and new script sources.
 * Returns a ScriptDiff with hunks that can be individually accepted/rejected.
 */
export function computeDiff(
  scriptPath: string,
  scriptName: string,
  oldSource: string,
  newSource: string,
  toolCallId?: string,
): ScriptDiff {
  const changes = diffLines(oldSource, newSource);
  const hunks = buildHunks(changes);

  return {
    id: uuid(),
    scriptPath,
    scriptName,
    oldSource,
    newSource,
    hunks,
    timestamp: Date.now(),
    toolCallId,
  };
}

/**
 * Apply accepted hunks to produce the final source.
 * Accepted hunks use the new content; rejected hunks keep the old content.
 */
export function applyDiff(diff: ScriptDiff): string {
  const oldLines = diff.oldSource.split("\n");
  const result: string[] = [];
  let oldIdx = 0;

  for (const hunk of diff.hunks) {
    // Add unchanged lines before this hunk
    while (oldIdx < hunk.startOld - 1) {
      result.push(oldLines[oldIdx]);
      oldIdx++;
    }

    if (hunk.status === "accepted") {
      // Use new content
      for (const line of hunk.lines) {
        if (line.type === "add" || line.type === "ctx") {
          result.push(line.content);
        }
        if (line.type === "del" || line.type === "ctx") {
          oldIdx++;
        }
      }
    } else {
      // Keep old content (rejected or pending)
      for (const line of hunk.lines) {
        if (line.type === "del" || line.type === "ctx") {
          result.push(oldLines[oldIdx]);
          oldIdx++;
        }
      }
    }
  }

  // Remaining unchanged lines
  while (oldIdx < oldLines.length) {
    result.push(oldLines[oldIdx]);
    oldIdx++;
  }

  return result.join("\n");
}

/**
 * Format a diff for display as a text summary (sent back to LLM).
 */
export function formatDiffSummary(diff: ScriptDiff): string {
  const added = diff.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "add").length,
    0,
  );
  const removed = diff.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "del").length,
    0,
  );

  let out = `Script: ${diff.scriptPath}\n`;
  out += `Hunks: ${diff.hunks.length} | +${added} -${removed}\n\n`;

  for (const hunk of diff.hunks) {
    out += `--- Hunk ${hunk.id.slice(0, 8)} [${hunk.status}] ---\n`;
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
      out += `${prefix} ${line.content}\n`;
    }
    out += "\n";
  }

  return out;
}

/**
 * Get rejection context — information about rejected hunks to send back to the LLM
 * so it can iterate on its approach.
 */
export function getRejectionContext(diff: ScriptDiff): string | null {
  const rejected = diff.hunks.filter((h) => h.status === "rejected");
  if (rejected.length === 0) return null;

  let ctx = `The user rejected ${rejected.length} hunk(s) in ${diff.scriptPath}:\n\n`;

  for (const hunk of rejected) {
    ctx += `Rejected changes at lines ${hunk.startOld}-${hunk.startOld + hunk.lines.length}:\n`;
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
      ctx += `  ${prefix} ${line.content}\n`;
    }
    ctx += "\n";
  }

  ctx += "Please revise your approach for the rejected sections.";
  return ctx;
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function buildHunks(changes: Change[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentLines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let hunkStartOld = 1;
  let hunkStartNew = 1;
  let inChange = false;
  let contextBefore: DiffLine[] = [];

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");

    if (change.added || change.removed) {
      if (!inChange) {
        // Start of a new hunk — include up to 3 lines of context before
        hunkStartOld = Math.max(1, oldLine - contextBefore.length);
        hunkStartNew = Math.max(1, newLine - contextBefore.length);
        currentLines = [...contextBefore];
        inChange = true;
      }

      for (const line of lines) {
        if (change.added) {
          currentLines.push({ type: "add", lineNew: newLine, content: line });
          newLine++;
        } else {
          currentLines.push({ type: "del", lineOld: oldLine, content: line });
          oldLine++;
        }
      }
    } else {
      // Context lines
      if (inChange) {
        // Add up to 3 lines of context after
        const afterCtx = lines.slice(0, 3);
        for (const line of afterCtx) {
          currentLines.push({ type: "ctx", lineOld: oldLine, lineNew: newLine, content: line });
          oldLine++;
          newLine++;
        }

        // Flush the hunk
        hunks.push({
          id: uuid(),
          startOld: hunkStartOld,
          startNew: hunkStartNew,
          lines: currentLines,
          status: "pending",
        });
        currentLines = [];
        inChange = false;

        // Advance past the context we already consumed
        for (let i = afterCtx.length; i < lines.length; i++) {
          oldLine++;
          newLine++;
        }
      } else {
        oldLine += lines.length;
        newLine += lines.length;
      }

      // Track trailing context for the next hunk
      contextBefore = lines.slice(-3).map((content, i) => ({
        type: "ctx" as const,
        lineOld: oldLine - (3 - i),
        lineNew: newLine - (3 - i),
        content,
      }));
    }
  }

  // Flush any remaining hunk
  if (currentLines.length > 0) {
    hunks.push({
      id: uuid(),
      startOld: hunkStartOld,
      startNew: hunkStartNew,
      lines: currentLines,
      status: "pending",
    });
  }

  return hunks;
}
