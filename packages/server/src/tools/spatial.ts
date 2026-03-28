// ============================================================================
// Linkedsword — Spatial Tools
// Welds, bounding boxes, raycasting, terrain operations
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio } from "./_helpers.js";

export const registerSpatialTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("create_weld", {
    title: "Create weld",
    description: `Create a WeldConstraint between two parts.

Args:
  - part0 (string): Path to the first part
  - part1 (string): Path to the second part

Returns: Confirmation with weld path.`,
    inputSchema: {
      part0: z.string().describe("First part path"),
      part1: z.string().describe("Second part path"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "create_weld", params));

  server.registerTool("get_bounding_box", {
    title: "Get bounding box",
    description: `Get the axis-aligned bounding box of an instance (and its descendants).

Args:
  - path (string): Instance path

Returns: { center: [x, y, z], size: [x, y, z], min: [x, y, z], max: [x, y, z] }`,
    inputSchema: {
      path: z.string().describe("Instance path"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "get_bounding_box", params));

  server.registerTool("raycast", {
    title: "Raycast",
    description: `Cast a ray in the 3D world and return hit information.

Args:
  - origin (number[]): Ray origin [x, y, z]
  - direction (number[]): Ray direction [x, y, z]
  - filterType (string, optional): "include" or "exclude" filter
  - filterPaths (string[], optional): Instance paths for the filter list

Returns: { hit: boolean, instance?, position?, normal?, distance? }`,
    inputSchema: {
      origin: z.array(z.number()).length(3).describe("Ray origin [x, y, z]"),
      direction: z.array(z.number()).length(3).describe("Ray direction [x, y, z]"),
      filterType: z.enum(["include", "exclude"]).optional().describe("Raycast filter type"),
      filterPaths: z.array(z.string()).optional().describe("Instance paths for filter"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "raycast", params));

  server.registerTool("fill_terrain", {
    title: "Fill terrain",
    description: `Fill a region of terrain with a specific material.

Args:
  - center (number[]): Center of the region [x, y, z]
  - size (number[]): Size of the region [x, y, z]
  - material (string, optional): Terrain material (default: "Grass")

Returns: Confirmation with filled region details.`,
    inputSchema: {
      center: z.array(z.number()).length(3).describe("Region center [x, y, z]"),
      size: z.array(z.number()).length(3).describe("Region size [x, y, z]"),
      material: z.string().default("Grass").describe("Terrain material"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "fill_terrain", params));

  server.registerTool("clear_terrain", {
    title: "Clear terrain",
    description: `Clear terrain in a region, or clear all terrain if no region is specified.

Args:
  - region (object, optional): { center: [x, y, z], size: [x, y, z] } — if omitted, clears all terrain

Returns: Confirmation message.`,
    inputSchema: {
      region: z.object({
        center: z.array(z.number()).length(3).describe("Region center [x, y, z]"),
        size: z.array(z.number()).length(3).describe("Region size [x, y, z]"),
      }).optional().describe("Region to clear (omit to clear all)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "clear_terrain", params));
};
