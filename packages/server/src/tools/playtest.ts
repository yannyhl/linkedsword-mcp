// ============================================================================
// Linkedsword — Playtest Automation Tools
// Start/stop playtests, virtual input, console capture, autonomous debugging
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio } from "./_helpers.js";

export const registerPlaytestTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("start_playtest", {
    title: "Start playtest",
    description: `Start a play session in Studio. Begins capturing all print/warn/error output.
Use get_playtest_output to poll logs during the session, and stop_playtest to end it.

Args:
  - mode (string, optional): "play" | "run" | "server" (default: "play")

Returns: Confirmation that playtest started.`,
    inputSchema: {
      mode: z.enum(["play", "run", "server"]).default("play").describe("Playtest mode"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "start_playtest", params));

  server.registerTool("stop_playtest", {
    title: "Stop playtest",
    description: `End the current play session and return all captured output logs.

Returns: { output: string, errors: string[], duration: number }`,
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "stop_playtest", {}));

  server.registerTool("get_playtest_output", {
    title: "Get playtest output",
    description: `Poll captured output logs from the running play session. Call repeatedly to get new output.

Args:
  - since (number, optional): Only return logs after this timestamp

Returns: { logs: Array<{ type, message, timestamp }>, isRunning: boolean }`,
    inputSchema: {
      since: z.number().optional().describe("Timestamp to get logs after"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_playtest_output", params));

  server.registerTool("get_studio_mode", {
    title: "Get Studio mode",
    description: `Get the current Studio mode — edit, play, run, or server.

Returns: { mode: "edit" | "play" | "run" | "server" }`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => callStudio(bridge, "get_studio_mode", {}));

  server.registerTool("run_script_in_play_mode", {
    title: "Run script in play mode",
    description: `Start a playtest, run a script, then automatically stop. Returns all output.
Useful for testing code changes without manual intervention.

Args:
  - code (string): Luau code to execute during play
  - timeout (number, optional): Max seconds before auto-stop (default: 30)

Returns: { output: string, errors: string[], duration: number }`,
    inputSchema: {
      code: z.string().min(1).describe("Luau code to run in play mode"),
      timeout: z.number().int().min(1).max(300).default(30).describe("Timeout in seconds"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "run_script_in_play_mode", params));

  server.registerTool("user_mouse_input", {
    title: "Simulate mouse input",
    description: `Simulate mouse clicks and movements during a playtest. Requires an active play session.

Args:
  - action (string): "click" | "move" | "scroll"
  - x (number): Screen X coordinate
  - y (number): Screen Y coordinate
  - button (string, optional): "left" | "right" | "middle" (default: "left")

Returns: Confirmation of input.`,
    inputSchema: {
      action: z.enum(["click", "move", "scroll"]).describe("Mouse action"),
      x: z.number().describe("Screen X coordinate"),
      y: z.number().describe("Screen Y coordinate"),
      button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "user_mouse_input", params));

  server.registerTool("user_keyboard_input", {
    title: "Simulate keyboard input",
    description: `Simulate keyboard presses during a playtest.

Args:
  - key (string): Key to press (e.g. "W", "Space", "Enter", "Escape")
  - action (string, optional): "press" | "hold" | "release" (default: "press")
  - duration (number, optional): Hold duration in ms (only for "hold")

Returns: Confirmation of input.`,
    inputSchema: {
      key: z.string().describe("Key name"),
      action: z.enum(["press", "hold", "release"]).default("press").describe("Key action"),
      duration: z.number().int().min(0).max(10000).optional().describe("Hold duration (ms)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "user_keyboard_input", params));

  server.registerTool("character_navigation", {
    title: "Navigate character",
    description: `Move a character to a position using pathfinding. Bypasses the input system.

Args:
  - target (string | number[]): Instance path or [x, y, z] coordinates
  - timeout (number, optional): Max seconds to reach target (default: 30)

Returns: { reached: boolean, finalPosition: [x, y, z], duration: number }`,
    inputSchema: {
      target: z.union([z.string(), z.array(z.number()).length(3)]).describe("Target path or coordinates"),
      timeout: z.number().int().min(1).max(120).default(30).describe("Timeout seconds"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "character_navigation", params as Record<string, unknown>));
};
