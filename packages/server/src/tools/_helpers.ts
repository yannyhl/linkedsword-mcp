// ============================================================================
// Linkedsword — Tool Helpers
// Shared utilities for tool registration and response formatting
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HttpBridge } from "../services/bridge.js";
import { MAX_RESPONSE_CHARS } from "../constants.js";

export type ToolRegistrar = (server: McpServer, bridge: HttpBridge) => void;

/** Format a successful tool response for the MCP protocol */
export function success(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const truncated =
    text.length > MAX_RESPONSE_CHARS
      ? text.slice(0, MAX_RESPONSE_CHARS) + "\n\n... [truncated — use more specific queries to reduce output]"
      : text;
  return { content: [{ type: "text", text: truncated }] };
}

/** Format a warning response (non-fatal issue) */
export function warning(message: string, data?: unknown): { content: Array<{ type: "text"; text: string }> } {
  const payload = data ? `\n\n${JSON.stringify(data, null, 2)}` : "";
  return { content: [{ type: "text", text: `Warning: ${message}${payload}` }] };
}

/** Format an error tool response */
export function error(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Send a tool request to Studio via the bridge and return formatted response */
export async function callStudio(
  bridge: HttpBridge,
  tool: string,
  params: Record<string, unknown>,
): Promise<ReturnType<typeof success> | ReturnType<typeof error>> {
  const result = await bridge.sendToStudio(tool, params);
  if (result.success) {
    return success(result.data);
  }
  return error(result.error ?? "Unknown error from Studio");
}
