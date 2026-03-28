// ============================================================================
// Linkedsword — Core Type Definitions
// ============================================================================

/** Modes the plugin can operate in */
export type LSMode = "full" | "inspector" | "sandbox";

/** Current state of the MCP connection */
export type ConnectionState = "disconnected" | "connected" | "active" | "error" | "playtesting";

/** A pending request waiting for the Studio plugin to process */
export interface PendingRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  timestamp: number;
  resolve: (value: ToolResponse) => void;
  reject: (reason: Error) => void;
}

/** Response from a tool execution in Studio */
export interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  duration?: number;
}

/** A single line in a diff hunk */
export interface DiffLine {
  type: "add" | "del" | "ctx";
  lineOld?: number;
  lineNew?: number;
  content: string;
}

/** A contiguous block of changes */
export interface DiffHunk {
  id: string;
  startOld: number;
  startNew: number;
  lines: DiffLine[];
  status: "pending" | "accepted" | "rejected";
}

/** A staged script diff awaiting review */
export interface ScriptDiff {
  id: string;
  scriptPath: string;
  scriptName: string;
  oldSource: string;
  newSource: string;
  hunks: DiffHunk[];
  timestamp: number;
  toolCallId?: string;
}

/** A resolved (accepted/rejected) diff stored in history */
export interface ResolvedDiff {
  id: string;
  scriptPath: string;
  scriptName: string;
  hunks: DiffHunk[];
  timestamp: number;
  resolvedAt: number;
  outcome: "accepted" | "rejected" | "partial";
  addCount: number;
  delCount: number;
  toolCallId?: string;
}

/** An entry in the activity log */
export interface ActivityEntry {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result: "success" | "error" | "pending";
  message: string;
  duration: number;
  timestamp: number;
}

/** Plugin heartbeat payload */
export interface HeartbeatPayload {
  pluginVersion: string;
  studioVersion: string;
  placeName: string;
  placeId: number;
  mode: LSMode;
  state: ConnectionState;
}

/** The shape of a request the plugin long-polls for */
export interface BridgeRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

/** The shape of a response the plugin posts back */
export interface BridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Configuration for the Linkedsword server */
export interface LSConfig {
  port: number;
  mode: LSMode;
  autoAccept: boolean;
  maxIterations: number;
  requestTimeout: number;
}

/** Studio instance info for multi-instance support */
export interface StudioInstance {
  id: string;
  placeName: string;
  placeId: number;
  pluginVersion: string;
  lastHeartbeat: number;
  active: boolean;
}
