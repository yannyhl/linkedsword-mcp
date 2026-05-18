// ============================================================================
// Linkedsword — Constants
// ============================================================================

export const DEFAULT_PORT = 3003;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 15000;
export const REQUEST_TIMEOUT_MS = 30000;
export const MAX_RESPONSE_CHARS = 100_000;
export const MAX_ITERATIONS = 25;

export const VERSION = "0.5.0";
export const SERVER_NAME = "linkedsword-mcp";
export const MAX_DIFF_QUEUE_SIZE = 50;
export const MAX_DIFF_HISTORY_SIZE = 200;
export const DIFF_CONTEXT_LINES = 3;

/** Tool categories for organization */
export const TOOL_CATEGORIES = {
  NAVIGATION: "navigation",
  SEARCH: "search",
  SCRIPT: "script",
  INSTANCE: "instance",
  PROPERTY: "property",
  ATTRIBUTE: "attribute",
  PLAYTEST: "playtest",
  BUILD: "build",
  DIFF: "diff",
  META: "meta",
} as const;
