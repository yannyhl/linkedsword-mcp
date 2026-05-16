// ============================================================================
// Linkedsword — HTTP Bridge
// Long-polling communication layer between MCP server and Studio plugin
// ============================================================================

import express, { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import {
  PendingRequest,
  BridgeRequest,
  BridgeResponse,
  ToolResponse,
  HeartbeatPayload,
  StudioInstance,
  ActivityEntry,
  ScriptDiff,
  ResolvedDiff,
  LSConfig,
  AutoAcceptBudget,
} from "../types.js";
import {
  DEFAULT_PORT,
  HEARTBEAT_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  MAX_DIFF_HISTORY_SIZE,
  VERSION,
} from "../constants.js";

export class HttpBridge {
  private app: express.Application;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private studioInstances: Map<string, StudioInstance> = new Map();
  private activeInstanceId: string | null = null;
  private activityLog: ActivityEntry[] = [];
  private diffQueue: Map<string, ScriptDiff> = new Map();
  private diffHistory: ResolvedDiff[] = [];
  private config: LSConfig;
  private autoAcceptBudget: AutoAcceptBudget = { mode: "off", remaining: 0, setAt: 0 };

  // Long-poll waiters — plugin sits here until we have work
  private pollWaiters: Array<{
    instanceId: string;
    resolve: (req: BridgeRequest | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(config: Partial<LSConfig> = {}) {
    this.config = {
      port: config.port ?? DEFAULT_PORT,
      mode: config.mode ?? "full",
      autoAccept: config.autoAccept ?? false,
      maxIterations: config.maxIterations ?? 25,
      requestTimeout: config.requestTimeout ?? REQUEST_TIMEOUT_MS,
    };

    this.app = express();
    this.app.use(express.json({ limit: "10mb" }));
    this.setupRoutes();
  }

  // --------------------------------------------------------------------------
  // Route setup
  // --------------------------------------------------------------------------

  private setupRoutes(): void {
    // Plugin heartbeat
    this.app.post("/heartbeat", (req, res) => this.handleHeartbeat(req, res));

    // Plugin long-polls for work
    this.app.get("/poll/:instanceId", (req, res) => this.handlePoll(req, res));

    // Plugin posts results back
    this.app.post("/response", (req, res) => this.handleResponse(req, res));

    // Plugin posts diff resolutions
    this.app.post("/diff/resolve", (req, res) => this.handleDiffResolve(req, res));

    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({
        server: "linkedsword-mcp",
        version: VERSION,
        mode: this.config.mode,
        instances: this.studioInstances.size,
        pendingRequests: this.pendingRequests.size,
        pendingDiffs: this.diffQueue.size,
      });
    });

    // Activity log endpoint (for external dashboards)
    this.app.get("/activity", (_req, res) => {
      res.json(this.activityLog.slice(-100));
    });

    // Diff queue endpoint
    this.app.get("/diffs", (_req, res) => {
      res.json(Array.from(this.diffQueue.values()));
    });

    // Diff history endpoint
    this.app.get("/diff/history", (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(this.diffHistory.slice(-limit));
    });
  }

  // --------------------------------------------------------------------------
  // Heartbeat — plugin registers/keeps alive
  // --------------------------------------------------------------------------

  private handleHeartbeat(req: Request, res: Response): void {
    const payload = req.body as HeartbeatPayload & { instanceId?: string };
    const instanceId = payload.instanceId ?? uuid();

    this.studioInstances.set(instanceId, {
      id: instanceId,
      placeName: payload.placeName ?? "Unknown",
      placeId: payload.placeId ?? 0,
      pluginVersion: payload.pluginVersion ?? "0.0.0",
      lastHeartbeat: Date.now(),
      active: this.activeInstanceId === null || this.activeInstanceId === instanceId,
    });

    // Auto-set first instance as active
    if (this.activeInstanceId === null) {
      this.activeInstanceId = instanceId;
    }

    res.json({
      instanceId,
      active: this.activeInstanceId === instanceId,
      mode: this.config.mode,
      serverVersion: VERSION,
    });
  }

  // --------------------------------------------------------------------------
  // Long-poll — plugin waits here for work
  // --------------------------------------------------------------------------

  private handlePoll(req: Request, res: Response): void {
    const instanceId = String(req.params.instanceId);

    if (!this.studioInstances.has(instanceId)) {
      res.status(404).json({ error: "Instance not registered. Send heartbeat first." });
      return;
    }

    // Check if there's already a pending request for this instance
    const pending = this.findPendingForInstance(instanceId);
    if (pending) {
      res.json({
        id: pending.id,
        action: pending.tool,
        params: pending.params,
      } satisfies BridgeRequest);
      return;
    }

    // No work yet — park the connection (long-poll)
    const timeout = setTimeout(() => {
      const idx = this.pollWaiters.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) this.pollWaiters.splice(idx, 1);
      res.json(null); // Empty response, plugin will re-poll
    }, 25000);

    const resolve = (request: BridgeRequest | null) => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.json(request);
      }
    };

    this.pollWaiters.push({ instanceId, resolve, timer: timeout });
  }

  // --------------------------------------------------------------------------
  // Response — plugin sends results back
  // --------------------------------------------------------------------------

  private handleResponse(req: Request, res: Response): void {
    const response = req.body as BridgeResponse;
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      res.status(404).json({ error: "No pending request with that ID" });
      return;
    }

    const duration = Date.now() - pending.timestamp;
    this.pendingRequests.delete(response.id);

    // Log activity
    this.logActivity(pending.tool, pending.params, response.success, duration, response.error);

    // Resolve the promise
    pending.resolve({
      success: response.success,
      data: response.data,
      error: response.error,
      duration,
    });

    res.json({ ok: true });
  }

  // --------------------------------------------------------------------------
  // Diff resolution — plugin reports accept/reject from user
  // --------------------------------------------------------------------------

  private handleDiffResolve(req: Request, res: Response): void {
    const { diffId, hunkId, action, comment } = req.body as {
      diffId: string;
      hunkId?: string;
      action: "accept" | "reject" | "accept_all" | "reject_all";
      comment?: string;
    };

    const diff = this.diffQueue.get(diffId);
    if (!diff) {
      res.status(404).json({ error: "Diff not found" });
      return;
    }

    if (action === "accept_all") {
      diff.hunks.forEach((h) => (h.status = "accepted"));
    } else if (action === "reject_all") {
      diff.hunks.forEach((h) => (h.status = "rejected"));
    } else if (hunkId) {
      const hunk = diff.hunks.find((h) => h.id === hunkId);
      if (hunk) {
        hunk.status = action === "accept" ? "accepted" : "rejected";
      }
    }

    // Check if all hunks are resolved
    const allResolved = diff.hunks.every((h) => h.status !== "pending");
    if (allResolved) {
      this.archiveDiff(diff);
      this.diffQueue.delete(diffId);
    }

    res.json({
      diffId,
      resolved: allResolved,
      accepted: diff.hunks.filter((h) => h.status === "accepted").length,
      rejected: diff.hunks.filter((h) => h.status === "rejected").length,
      pending: diff.hunks.filter((h) => h.status === "pending").length,
    });
  }

  // --------------------------------------------------------------------------
  // Public API — used by MCP tool handlers
  // --------------------------------------------------------------------------

  /** Send a request to the active Studio instance and wait for response */
  async sendToStudio(tool: string, params: Record<string, unknown>): Promise<ToolResponse> {
    const instanceId = this.activeInstanceId;
    if (!instanceId || !this.studioInstances.has(instanceId)) {
      return { success: false, error: "No Studio instance connected. Open Roblox Studio with the Linkedsword plugin." };
    }

    // Check instance freshness
    const instance = this.studioInstances.get(instanceId)!;
    if (Date.now() - instance.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      this.studioInstances.delete(instanceId);
      this.activeInstanceId = null;
      return { success: false, error: "Studio instance heartbeat timed out. Restart the plugin." };
    }

    // Mode check
    if (this.config.mode === "inspector" && !this.isReadOnlyTool(tool)) {
      return { success: false, error: `Tool '${tool}' is write-only. Switch to 'full' mode to use it.` };
    }

    const id = uuid();

    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ success: false, error: `Request timed out after ${this.config.requestTimeout}ms` });
      }, this.config.requestTimeout);

      const request: PendingRequest = {
        id,
        tool,
        params,
        timestamp: Date.now(),
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      };

      this.pendingRequests.set(id, request);

      // Wake up any waiting poll for this instance
      const waiterIdx = this.pollWaiters.findIndex((w) => w.instanceId === instanceId);
      if (waiterIdx !== -1) {
        const waiter = this.pollWaiters.splice(waiterIdx, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve({ id, action: tool, params } satisfies BridgeRequest);
      }
    });
  }

  /** Stage a script diff for review */
  stageDiff(diff: ScriptDiff): void {
    this.diffQueue.set(diff.id, diff);
  }

  /** Get all pending diffs */
  getDiffQueue(): ScriptDiff[] {
    return Array.from(this.diffQueue.values());
  }

  /** Get a specific diff */
  getDiff(id: string): ScriptDiff | undefined {
    return this.diffQueue.get(id);
  }

  /** Remove a diff from the queue */
  deleteDiff(id: string): void {
    this.diffQueue.delete(id);
  }

  /** Archive a diff to history, then remove from queue */
  archiveAndDeleteDiff(id: string): void {
    const diff = this.diffQueue.get(id);
    if (diff) {
      this.archiveDiff(diff);
      this.diffQueue.delete(id);
    }
  }

  /** Get diff history */
  getDiffHistory(limit = 50): ResolvedDiff[] {
    return this.diffHistory.slice(-limit);
  }

  /** Clear diff history */
  clearDiffHistory(): void {
    this.diffHistory = [];
  }

  /** Get activity log */
  getActivityLog(limit = 50): ActivityEntry[] {
    return this.activityLog.slice(-limit);
  }

  /** Get connected Studio instances */
  getInstances(): StudioInstance[] {
    return Array.from(this.studioInstances.values());
  }

  /** Set the active Studio instance */
  setActiveInstance(instanceId: string): boolean {
    if (this.studioInstances.has(instanceId)) {
      this.activeInstanceId = instanceId;
      return true;
    }
    return false;
  }

  /** Get current config */
  getConfig(): LSConfig {
    return { ...this.config };
  }

  /** Update config */
  updateConfig(updates: Partial<LSConfig>): void {
    Object.assign(this.config, updates);
  }

  /** Get current auto-accept budget state */
  getAutoAcceptBudget(): AutoAcceptBudget {
    return { ...this.autoAcceptBudget };
  }

  /** Set the auto-accept budget. `count` required when scope=next_n. */
  setAutoAcceptBudget(scope: "off" | "next_n" | "session", count?: number): AutoAcceptBudget {
    if (scope === "next_n") {
      this.autoAcceptBudget = { mode: "next_n", remaining: count ?? 1, setAt: Date.now() };
    } else if (scope === "session") {
      this.autoAcceptBudget = { mode: "session", remaining: null, setAt: Date.now() };
    } else {
      this.autoAcceptBudget = { mode: "off", remaining: 0, setAt: Date.now() };
    }
    return this.getAutoAcceptBudget();
  }

  /**
   * Decide whether the next staged diff should be auto-applied.
   * Returns true when the global `autoAccept` flag is on OR the session budget
   * is active. For `next_n`, this consumes one unit of budget per call — only
   * invoke this once per staged diff, at the decision point.
   */
  shouldAutoAccept(): boolean {
    if (this.config.autoAccept) return true;
    if (this.autoAcceptBudget.mode === "session") return true;
    if (this.autoAcceptBudget.mode === "next_n" && (this.autoAcceptBudget.remaining ?? 0) > 0) {
      this.autoAcceptBudget.remaining = (this.autoAcceptBudget.remaining ?? 1) - 1;
      if ((this.autoAcceptBudget.remaining ?? 0) <= 0) {
        this.autoAcceptBudget = { mode: "off", remaining: 0, setAt: Date.now() };
      }
      return true;
    }
    return false;
  }

  /** Start the HTTP server */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.port, "127.0.0.1", () => {
        console.error(`[ls] HTTP bridge listening on 127.0.0.1:${this.config.port}`);
        resolve();
      });
    });
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private archiveDiff(diff: ScriptDiff): void {
    const accepted = diff.hunks.filter((h) => h.status === "accepted").length;
    const rejected = diff.hunks.filter((h) => h.status === "rejected").length;
    const outcome = rejected === 0 ? "accepted" : accepted === 0 ? "rejected" : "partial";

    this.diffHistory.push({
      id: diff.id,
      scriptPath: diff.scriptPath,
      scriptName: diff.scriptName,
      hunks: diff.hunks.map((h) => ({ ...h, lines: [...h.lines] })),
      timestamp: diff.timestamp,
      resolvedAt: Date.now(),
      outcome,
      addCount: diff.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0),
      delCount: diff.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "del").length, 0),
      toolCallId: diff.toolCallId,
    });

    if (this.diffHistory.length > MAX_DIFF_HISTORY_SIZE) {
      this.diffHistory = this.diffHistory.slice(-Math.floor(MAX_DIFF_HISTORY_SIZE / 2));
    }
  }

  private findPendingForInstance(_instanceId: string): PendingRequest | undefined {
    // Return the oldest pending request (FIFO)
    for (const [, req] of this.pendingRequests) {
      return req;
    }
    return undefined;
  }

  private isReadOnlyTool(tool: string): boolean {
    const readOnlyTools = new Set([
      "get_file_tree", "search_files", "get_place_info", "get_services",
      "search_objects", "get_instance_properties", "get_instance_children",
      "search_by_property", "get_class_info", "get_project_structure",
      "mass_get_property", "get_script_source", "grep_scripts",
      "get_attribute", "get_attributes", "get_tags", "get_tagged",
      "get_selection", "get_playtest_output", "get_studio_mode",
      "list_roblox_studios", "get_diff_queue", "get_activity_log",
      "get_diff_history", "capture_screenshot", "get_bounding_box",
      "get_descendants", "get_console_output", "raycast",
      // Phase 1+2 parity additions
      "resolve_stable_id", "compare_instances", "get_connected_instances",
      "parallel_search", "get_auto_accept_status",
      "search_assets", "get_asset_details", "get_asset_thumbnail",
    ]);
    return readOnlyTools.has(tool);
  }

  private logActivity(
    tool: string,
    params: Record<string, unknown>,
    success: boolean,
    duration: number,
    error?: string,
  ): void {
    this.activityLog.push({
      id: uuid(),
      tool,
      params,
      result: success ? "success" : "error",
      message: success ? `${tool} completed` : `${tool} failed: ${error}`,
      duration,
      timestamp: Date.now(),
    });

    // Keep log bounded
    if (this.activityLog.length > 500) {
      this.activityLog = this.activityLog.slice(-250);
    }
  }
}
