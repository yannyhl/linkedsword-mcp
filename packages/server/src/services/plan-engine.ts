// ============================================================================
// Linkedsword — Plan Engine
// Server-side state for Planning Mode. Plans are step lists with optional
// per-step DataModel snapshots ("checkpoints") that revert via the plugin.
// Persisted at ~/.linkedsword/plans/<planId>.json so a server restart
// doesn't lose in-flight work.
// ============================================================================

import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { v4 as uuid } from "uuid";

export type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type VerifyMode = "playtest" | "manual" | "none";

export interface PlanStep {
  id: string;
  description: string;
  rationale?: string;
  verifyWith: VerifyMode;
  status: StepStatus;
  outcome?: string;
  checkpointIds: string[];   // checkpoints associated with this step
  startedAt?: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface Checkpoint {
  id: string;
  planId: string;
  stepId: string | null;     // null = ad-hoc snapshot, not tied to a step
  label: string;
  scope: string[];           // instance paths covered by the snapshot
  snapshotJson: string;      // opaque payload supplied by the plugin handler
  snapshotSizeBytes: number;
  createdAt: number;
}

const PLANS_DIR = join(homedir(), ".linkedsword", "plans");
const CHECKPOINTS_DIR = join(homedir(), ".linkedsword", "checkpoints");
const MAX_PLANS = 50;
const MAX_CHECKPOINTS_PER_PLAN = 10;

export class PlanEngine {
  private plans: Map<string, Plan> = new Map();
  private checkpoints: Map<string, Checkpoint> = new Map();
  private hydrated = false;

  /**
   * Lazy-load all plans and checkpoint metadata on first access. Checkpoint
   * snapshot bodies stay on disk and are read only when revert is requested,
   * since they can be large (megabytes for full DataModel snapshots).
   */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    await fs.mkdir(PLANS_DIR, { recursive: true });
    await fs.mkdir(CHECKPOINTS_DIR, { recursive: true });
    try {
      const planFiles = await fs.readdir(PLANS_DIR);
      for (const f of planFiles) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(join(PLANS_DIR, f), "utf-8");
          const plan = JSON.parse(raw) as Plan;
          this.plans.set(plan.id, plan);
        } catch {
          // Ignore corrupt plan files — leave the rest of the index intact.
        }
      }
      const cpFiles = await fs.readdir(CHECKPOINTS_DIR);
      for (const f of cpFiles) {
        if (!f.endsWith(".meta.json")) continue;
        try {
          const raw = await fs.readFile(join(CHECKPOINTS_DIR, f), "utf-8");
          const cp = JSON.parse(raw) as Omit<Checkpoint, "snapshotJson"> & { snapshotJson?: string };
          // Meta files don't carry the body; load lazily on revert.
          this.checkpoints.set(cp.id, { ...cp, snapshotJson: "" });
        } catch {
          // skip
        }
      }
    } catch {
      // Directories newly created — nothing to load.
    }
    this.hydrated = true;
  }

  private async persistPlan(plan: Plan): Promise<void> {
    const path = join(PLANS_DIR, `${plan.id}.json`);
    await fs.writeFile(path, JSON.stringify(plan, null, 2));
  }

  private async deletePersistedPlan(planId: string): Promise<void> {
    const path = join(PLANS_DIR, `${planId}.json`);
    await fs.rm(path, { force: true });
  }

  private async persistCheckpoint(cp: Checkpoint): Promise<void> {
    const bodyPath = join(CHECKPOINTS_DIR, `${cp.id}.json`);
    const metaPath = join(CHECKPOINTS_DIR, `${cp.id}.meta.json`);
    await fs.writeFile(bodyPath, cp.snapshotJson);
    const { snapshotJson: _drop, ...meta } = cp;
    void _drop;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  private async loadCheckpointBody(cpId: string): Promise<string> {
    const bodyPath = join(CHECKPOINTS_DIR, `${cpId}.json`);
    return await fs.readFile(bodyPath, "utf-8");
  }

  private async deletePersistedCheckpoint(cpId: string): Promise<void> {
    await fs.rm(join(CHECKPOINTS_DIR, `${cpId}.json`), { force: true });
    await fs.rm(join(CHECKPOINTS_DIR, `${cpId}.meta.json`), { force: true });
  }

  async createPlan(input: {
    title: string;
    steps: Array<{ description: string; rationale?: string; verifyWith?: VerifyMode }>;
  }): Promise<Plan> {
    await this.hydrate();
    const active = [...this.plans.values()].filter((p) => !p.archived);
    if (active.length >= MAX_PLANS) {
      throw new Error(`Plan cap reached (${MAX_PLANS} active). Delete or archive a plan first.`);
    }
    const now = Date.now();
    const plan: Plan = {
      id: uuid(),
      title: input.title,
      steps: input.steps.map((s) => ({
        id: uuid(),
        description: s.description,
        rationale: s.rationale,
        verifyWith: s.verifyWith ?? "none",
        status: "pending" as StepStatus,
        checkpointIds: [],
      })),
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    this.plans.set(plan.id, plan);
    await this.persistPlan(plan);
    return plan;
  }

  async getPlan(planId: string): Promise<Plan | null> {
    await this.hydrate();
    return this.plans.get(planId) ?? null;
  }

  async listPlans(activeOnly: boolean): Promise<Plan[]> {
    await this.hydrate();
    const all = [...this.plans.values()];
    return (activeOnly ? all.filter((p) => !p.archived) : all)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async updateStep(planId: string, stepId: string, patch: { status?: StepStatus; outcome?: string }): Promise<Plan> {
    await this.hydrate();
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    if (patch.status !== undefined) {
      step.status = patch.status;
      if (patch.status === "in_progress" && !step.startedAt) step.startedAt = Date.now();
      if (patch.status === "completed" || patch.status === "failed" || patch.status === "skipped") {
        step.completedAt = Date.now();
      }
    }
    if (patch.outcome !== undefined) step.outcome = patch.outcome;
    plan.updatedAt = Date.now();
    await this.persistPlan(plan);
    return plan;
  }

  async deletePlan(planId: string): Promise<void> {
    await this.hydrate();
    const plan = this.plans.get(planId);
    if (!plan) return;
    // Clean up associated checkpoints too — orphans waste disk.
    for (const cpId of [...this.checkpoints.keys()]) {
      const cp = this.checkpoints.get(cpId);
      if (cp && cp.planId === planId) {
        this.checkpoints.delete(cpId);
        await this.deletePersistedCheckpoint(cpId);
      }
    }
    this.plans.delete(planId);
    await this.deletePersistedPlan(planId);
  }

  /**
   * Register a snapshot taken by the plugin. The caller (plan.ts tool) is
   * responsible for invoking the plugin handler to produce snapshotJson;
   * this method records and persists the result.
   */
  async recordCheckpoint(input: {
    planId: string;
    stepId: string | null;
    label: string;
    scope: string[];
    snapshotJson: string;
  }): Promise<Checkpoint> {
    await this.hydrate();
    const plan = this.plans.get(input.planId);
    if (!plan) throw new Error(`Plan not found: ${input.planId}`);

    // Enforce per-plan checkpoint cap; drop oldest.
    const existing = [...this.checkpoints.values()]
      .filter((c) => c.planId === input.planId)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (existing.length >= MAX_CHECKPOINTS_PER_PLAN) {
      const oldest = existing.shift();
      if (oldest) {
        this.checkpoints.delete(oldest.id);
        await this.deletePersistedCheckpoint(oldest.id);
        for (const step of plan.steps) {
          step.checkpointIds = step.checkpointIds.filter((id) => id !== oldest.id);
        }
      }
    }

    const cp: Checkpoint = {
      id: uuid(),
      planId: input.planId,
      stepId: input.stepId,
      label: input.label,
      scope: input.scope,
      snapshotJson: input.snapshotJson,
      snapshotSizeBytes: Buffer.byteLength(input.snapshotJson, "utf-8"),
      createdAt: Date.now(),
    };
    this.checkpoints.set(cp.id, cp);
    if (cp.stepId) {
      const step = plan.steps.find((s) => s.id === cp.stepId);
      if (step) step.checkpointIds.push(cp.id);
    }
    plan.updatedAt = Date.now();
    await this.persistCheckpoint(cp);
    await this.persistPlan(plan);
    return cp;
  }

  async getCheckpoint(cpId: string): Promise<Checkpoint | null> {
    await this.hydrate();
    const cp = this.checkpoints.get(cpId);
    if (!cp) return null;
    // Lazy-load the body if hydrated without it.
    if (cp.snapshotJson.length === 0) {
      cp.snapshotJson = await this.loadCheckpointBody(cpId);
    }
    return cp;
  }

  async deleteCheckpoint(cpId: string): Promise<void> {
    await this.hydrate();
    const cp = this.checkpoints.get(cpId);
    if (!cp) return;
    this.checkpoints.delete(cpId);
    const plan = this.plans.get(cp.planId);
    if (plan) {
      for (const step of plan.steps) {
        step.checkpointIds = step.checkpointIds.filter((id) => id !== cpId);
      }
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
    }
    await this.deletePersistedCheckpoint(cpId);
  }
}
