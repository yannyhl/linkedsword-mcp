// ============================================================================
// Linkedsword — Playtest Automation Tools
// Start/stop playtests, virtual input, console capture, autonomous debugging
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio, success, error } from "./_helpers.js";

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

  // --------------------------------------------------------------------------
  // P3.2 — run_playtest_scenario: orchestrate the existing playtest primitives
  // (start, virtual input, assertions, stop) into a single autonomous loop
  // and return a structured Pass/Fail/Inconclusive/Error verdict.
  // --------------------------------------------------------------------------
  const StepSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("wait"), seconds: z.number().min(0).max(60) }),
    z.object({
      kind: z.literal("key"),
      key: z.string(),
      action: z.enum(["press", "hold", "release"]).default("press"),
      duration: z.number().int().min(0).max(10000).optional(),
    }),
    z.object({
      kind: z.literal("mouse"),
      action: z.enum(["click", "move", "scroll"]),
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "right", "middle"]).default("left"),
    }),
    z.object({
      kind: z.literal("navigate"),
      target: z.union([z.string(), z.array(z.number()).length(3)]),
      timeout: z.number().int().min(1).max(120).default(30),
    }),
    z.object({ kind: z.literal("execute"), code: z.string().min(1) }),
    z.object({ kind: z.literal("assert"), code: z.string().min(1), description: z.string() }),
  ]);

  server.registerTool("run_playtest_scenario", {
    title: "Run an end-to-end playtest scenario",
    description: `Orchestrate a sequence of playtest steps and return a structured verdict. Steps run in order; the run aborts on the first failing assertion or unhandled error. Always calls stop_playtest at the end, even on failure.

Step kinds:
  - wait { seconds }
  - key  { key, action ("press"|"hold"|"release"), duration? }
  - mouse { action ("click"|"move"|"scroll"), x, y, button? }
  - navigate { target (path or [x,y,z]), timeout? }
  - execute { code } — Luau, output captured
  - assert { code, description } — Luau that returns truthy → pass, falsy → fail

Verdict: "pass" | "fail" | "inconclusive" | "error".`,
    inputSchema: {
      mode: z.enum(["play", "run"]).default("play").describe("Playtest mode"),
      steps: z.array(StepSchema).min(1).max(50).describe("Ordered step list (1-50)"),
      maxDurationSeconds: z.number().int().min(1).max(300).default(60).describe("Hard wall clock cap"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => {
    const startedAt = Date.now();
    const deadline = startedAt + params.maxDurationSeconds * 1000;

    const startResult = await bridge.sendToStudio("start_playtest", { mode: params.mode });
    if (!startResult.success) {
      return error(`start_playtest failed: ${startResult.error}`);
    }

    let verdict: "pass" | "fail" | "inconclusive" | "error" = "pass";
    let failedAssertion: { description: string; index: number } | null = null;
    let firstError: string | null = null;

    for (let i = 0; i < params.steps.length; i++) {
      if (Date.now() > deadline) {
        verdict = "inconclusive";
        break;
      }
      const step = params.steps[i];
      try {
        if (step.kind === "wait") {
          await new Promise((r) => setTimeout(r, step.seconds * 1000));
        } else if (step.kind === "key") {
          const resp = await bridge.sendToStudio("user_keyboard_input", {
            key: step.key,
            action: step.action,
            duration: step.duration,
          });
          if (!resp.success) throw new Error(resp.error ?? "user_keyboard_input failed");
        } else if (step.kind === "mouse") {
          const resp = await bridge.sendToStudio("user_mouse_input", {
            action: step.action,
            x: step.x,
            y: step.y,
            button: step.button,
          });
          if (!resp.success) throw new Error(resp.error ?? "user_mouse_input failed");
        } else if (step.kind === "navigate") {
          const resp = await bridge.sendToStudio("character_navigation", {
            target: step.target,
            timeout: step.timeout,
          });
          if (!resp.success) throw new Error(resp.error ?? "character_navigation failed");
        } else if (step.kind === "execute") {
          const resp = await bridge.sendToStudio("execute_luau", { code: step.code });
          if (!resp.success) throw new Error(resp.error ?? "execute_luau failed");
        } else if (step.kind === "assert") {
          // Wrap the assertion source so the runner sees a single boolean.
          const wrapped = `local __ls_ok, __ls_val = pcall(function()\n${step.code}\nend)\nprint(__ls_ok and (__ls_val and "LS_ASSERT_PASS" or "LS_ASSERT_FAIL") or ("LS_ASSERT_ERROR:" .. tostring(__ls_val)))`;
          const resp = await bridge.sendToStudio("execute_luau", { code: wrapped });
          if (!resp.success) throw new Error(resp.error ?? "assertion execute failed");
          const data = resp.data as { output?: string } | undefined;
          const out = (data?.output ?? "").trim();
          if (out.includes("LS_ASSERT_PASS")) {
            // pass
          } else if (out.includes("LS_ASSERT_FAIL")) {
            verdict = "fail";
            failedAssertion = { description: step.description, index: i };
            break;
          } else {
            verdict = "error";
            firstError = `Assertion errored: ${out}`;
            break;
          }
        }
      } catch (err) {
        verdict = "error";
        firstError = (err as Error).message;
        break;
      }
    }

    // Always stop, even on error — cleanup beats consistency of result shape.
    const stopResult = await bridge.sendToStudio("stop_playtest", {});
    const stopData = (stopResult.data ?? {}) as { output?: unknown[]; errors?: string[]; duration?: number };

    return success({
      verdict,
      failedAssertion,
      firstError,
      stepsExecuted: params.steps.length,
      output: stopData.output ?? [],
      errors: stopData.errors ?? [],
      durationMs: Date.now() - startedAt,
    });
  });
};
