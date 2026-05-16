// ============================================================================
// Linkedsword — Planning Mode Tools
// Plans, checkpoints, and revert. Mirrors Roblox's May 2026 Planning Mode.
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, success, error } from "./_helpers.js";
import { PlanEngine } from "../services/plan-engine.js";

const engine = new PlanEngine();

export const registerPlanTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("create_plan", {
    title: "Create a plan",
    description: `Create a Planning Mode plan with up to 20 steps. Returns a planId you reference from update_plan_step and snapshot_checkpoint.

Steps default to verifyWith="none". Set "playtest" to indicate a step requires a playtest before completion, or "manual" for human review.

Args:
  - title (string)
  - steps (array of { description, rationale?, verifyWith? }), 1..20

Returns: full plan object.`,
    inputSchema: {
      title: z.string().min(1).describe("Plan title"),
      steps: z.array(z.object({
        description: z.string().min(1),
        rationale: z.string().optional(),
        verifyWith: z.enum(["playtest", "manual", "none"]).default("none"),
      })).min(1).max(20).describe("Step list (1-20)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    try {
      const plan = await engine.createPlan(params);
      return success({ planId: plan.id, plan });
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("get_plan", {
    title: "Get plan",
    description: `Fetch a plan by id.

Args:
  - planId (string)`,
    inputSchema: {
      planId: z.string().describe("Plan id"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const plan = await engine.getPlan(params.planId);
    if (!plan) return error(`Plan not found: ${params.planId}`);
    return success(plan);
  });

  server.registerTool("list_plans", {
    title: "List plans",
    description: `List plans, newest first.

Args:
  - activeOnly (bool, default true): exclude archived/deleted`,
    inputSchema: {
      activeOnly: z.boolean().default(true).describe("Hide archived plans"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const plans = await engine.listPlans(params.activeOnly);
    return success({ count: plans.length, plans });
  });

  server.registerTool("update_plan_step", {
    title: "Update a plan step",
    description: `Set a step's status and/or outcome. Status transitions: pending → in_progress → completed | failed | skipped.

Args:
  - planId (string)
  - stepId (string)
  - status (enum, optional)
  - outcome (string, optional)`,
    inputSchema: {
      planId: z.string().describe("Plan id"),
      stepId: z.string().describe("Step id"),
      status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]).optional(),
      outcome: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    try {
      const plan = await engine.updateStep(params.planId, params.stepId, {
        status: params.status,
        outcome: params.outcome,
      });
      return success(plan);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("delete_plan", {
    title: "Delete plan",
    description: `Delete a plan and all its checkpoints.

Args:
  - planId (string)`,
    inputSchema: {
      planId: z.string().describe("Plan id"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    await engine.deletePlan(params.planId);
    return success({ deleted: true });
  });

  server.registerTool("snapshot_checkpoint", {
    title: "Snapshot DataModel into a checkpoint",
    description: `Capture the current state of selected DataModel subtrees into a checkpoint. Required: scope (array of instance paths). The plugin serializes those subtrees + their descendant scripts and returns a JSON payload that's stored on disk.

Use BEFORE running a step you might want to roll back. revert_to_checkpoint restores the captured state.

Args:
  - planId (string)
  - stepId (string, optional): associate the checkpoint with a step
  - label (string)
  - scope (string[]): instance paths to snapshot (e.g. ["game.Workspace.Town"])

Returns: { checkpointId, snapshotSizeBytes }`,
    inputSchema: {
      planId: z.string().describe("Plan id"),
      stepId: z.string().optional().describe("Associate with this step"),
      label: z.string().min(1).describe("Human-readable label"),
      scope: z.array(z.string()).min(1).describe("Instance paths to snapshot"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const plan = await engine.getPlan(params.planId);
    if (!plan) return error(`Plan not found: ${params.planId}`);

    const resp = await bridge.sendToStudio("snapshot_subtree", { scope: params.scope });
    if (!resp.success) return error(`Snapshot failed: ${resp.error}`);
    const payload = JSON.stringify(resp.data ?? {});

    try {
      const cp = await engine.recordCheckpoint({
        planId: params.planId,
        stepId: params.stepId ?? null,
        label: params.label,
        scope: params.scope,
        snapshotJson: payload,
      });
      return success({
        checkpointId: cp.id,
        snapshotSizeBytes: cp.snapshotSizeBytes,
        scope: cp.scope,
      });
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("revert_to_checkpoint", {
    title: "Revert DataModel to a checkpoint",
    description: `Restore a previously captured checkpoint. Plugin wraps the restore in a single ChangeHistory waypoint, so a single Ctrl+Z still works as an undo escape hatch.

Args:
  - checkpointId (string)`,
    inputSchema: {
      checkpointId: z.string().describe("Checkpoint id"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const cp = await engine.getCheckpoint(params.checkpointId);
    if (!cp) return error(`Checkpoint not found: ${params.checkpointId}`);
    const parsed = JSON.parse(cp.snapshotJson) as unknown;
    const resp = await bridge.sendToStudio("revert_subtree", { scope: cp.scope, snapshot: parsed });
    if (!resp.success) return error(`Revert failed: ${resp.error}`);
    return success({ reverted: true, scope: cp.scope, ...(resp.data as Record<string, unknown>) });
  });

  server.registerTool("delete_checkpoint", {
    title: "Delete a checkpoint",
    description: `Delete a single checkpoint without touching its plan.

Args:
  - checkpointId (string)`,
    inputSchema: {
      checkpointId: z.string().describe("Checkpoint id"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    await engine.deleteCheckpoint(params.checkpointId);
    return success({ deleted: true });
  });
};
