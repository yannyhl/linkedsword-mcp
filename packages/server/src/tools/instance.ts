// ============================================================================
// Linkedsword — Instance & Property Tools
// Create, delete, duplicate, set properties — with transaction-safe batch ops
// ============================================================================

import { z } from "zod";
import { ToolRegistrar, callStudio } from "./_helpers.js";

export const registerInstanceTools: ToolRegistrar = (server, bridge) => {
  server.registerTool("create_object", {
    title: "Create object",
    description: `Create a new instance in the DataModel.

Args:
  - className (string): Roblox class to create (e.g. "Part", "Script", "Folder")
  - parent (string): Parent path (e.g. "game.Workspace")
  - name (string, optional): Name for the new instance
  - properties (object, optional): Initial properties to set

Returns: { path, name, className } of the created instance.`,
    inputSchema: {
      className: z.string().describe("Class to create"),
      parent: z.string().describe("Parent instance path"),
      name: z.string().optional().describe("Instance name"),
      properties: z.record(z.unknown()).optional().describe("Initial properties"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "create_object", params));

  server.registerTool("delete_object", {
    title: "Delete object",
    description: `Delete an instance from the DataModel. This is undoable via Ctrl+Z in Studio.

Args:
  - path (string): Path to the instance to delete

Returns: Confirmation message.`,
    inputSchema: {
      path: z.string().describe("Instance path to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "delete_object", params));

  server.registerTool("set_property", {
    title: "Set property",
    description: `Set a single property on an instance.

Args:
  - path (string): Instance path
  - property (string): Property name
  - value (any): Value to set (supports strings, numbers, booleans, arrays for Vector3/Color3)

Returns: Confirmation with old and new values.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      property: z.string().describe("Property name"),
      value: z.unknown().describe("Value to set"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "set_property", params as Record<string, unknown>));

  server.registerTool("mass_create_objects", {
    title: "Mass create objects (transaction-safe)",
    description: `Create multiple instances in a single atomic operation. If any creation fails, all are rolled back.

Args:
  - objects (array): Array of { className, parent, name?, properties? }

Returns: Array of created instance paths, or error with rollback confirmation.`,
    inputSchema: {
      objects: z.array(z.object({
        className: z.string(),
        parent: z.string(),
        name: z.string().optional(),
        properties: z.record(z.unknown()).optional(),
      })).min(1).max(500).describe("Objects to create"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "mass_create_objects", params));

  server.registerTool("mass_set_property", {
    title: "Mass set property (transaction-safe)",
    description: `Set the same property on multiple instances atomically. All-or-nothing.

Args:
  - paths (string[]): Instance paths
  - property (string): Property name
  - value (any): Value to set

Returns: Count of updated instances.`,
    inputSchema: {
      paths: z.array(z.string()).min(1).max(500).describe("Instance paths"),
      property: z.string().describe("Property name"),
      value: z.unknown().describe("Value to set"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => callStudio(bridge, "mass_set_property", params as Record<string, unknown>));

  server.registerTool("mass_duplicate", {
    title: "Mass duplicate",
    description: `Duplicate instances with automatic naming and optional position offsets.

Args:
  - paths (string[]): Instances to duplicate
  - count (number, optional): Number of copies per instance (default: 1)
  - offset (array, optional): [x, y, z] position offset between copies

Returns: Array of new instance paths.`,
    inputSchema: {
      paths: z.array(z.string()).min(1).max(100).describe("Instance paths to duplicate"),
      count: z.number().int().min(1).max(50).default(1).describe("Copies per instance"),
      offset: z.array(z.number()).length(3).optional().describe("[x, y, z] offset"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "mass_duplicate", params));

  server.registerTool("smart_duplicate", {
    title: "Smart duplicate",
    description: `Duplicate with intelligent positioning — auto-names and spaces copies in a grid.

Args:
  - path (string): Instance to duplicate
  - count (number): Number of copies
  - layout (string, optional): "grid" | "line" | "circle" (default: "grid")
  - spacing (number, optional): Spacing between copies (default: 5)

Returns: Array of new instance paths with their positions.`,
    inputSchema: {
      path: z.string().describe("Instance to duplicate"),
      count: z.number().int().min(1).max(200).describe("Number of copies"),
      layout: z.enum(["grid", "line", "circle"]).default("grid").describe("Layout pattern"),
      spacing: z.number().min(0.1).max(1000).default(5).describe("Spacing between copies"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "smart_duplicate", params));

  server.registerTool("set_calculated_property", {
    title: "Set calculated property",
    description: `Set a property using a formula. The formula can reference the current value.

Args:
  - path (string): Instance path
  - property (string): Property name
  - formula (string): Formula (e.g. "current * 2", "current + 10")

Returns: Old and new values.`,
    inputSchema: {
      path: z.string().describe("Instance path"),
      property: z.string().describe("Property name"),
      formula: z.string().describe("Formula using 'current' as the current value"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "set_calculated_property", params));

  server.registerTool("clone_object", {
    title: "Clone object",
    description: `Clone an instance and all its children.

Args:
  - path (string): Path to the instance to clone
  - parent (string, optional): Parent path for the clone (defaults to same parent)
  - name (string, optional): Name for the cloned instance

Returns: { path, name, className } of the cloned instance.`,
    inputSchema: {
      path: z.string().describe("Instance path to clone"),
      parent: z.string().optional().describe("Parent path for the clone"),
      name: z.string().optional().describe("Name for the clone"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "clone_object", params));

  server.registerTool("reparent_object", {
    title: "Reparent object",
    description: `Move an instance to a new parent.

Args:
  - path (string): Path to the instance to move
  - newParent (string): Path to the new parent instance

Returns: Confirmation with new path.`,
    inputSchema: {
      path: z.string().describe("Instance path to move"),
      newParent: z.string().describe("New parent instance path"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "reparent_object", params));

  server.registerTool("group_objects", {
    title: "Group objects",
    description: `Group multiple instances into a container (Model or Folder).

Args:
  - paths (string[]): Paths to instances to group
  - containerType (string, optional): "Model" or "Folder" (default: "Model")
  - name (string, optional): Name for the group container

Returns: { path, name, className } of the new container.`,
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Instance paths to group"),
      containerType: z.enum(["Model", "Folder"]).default("Model").describe("Container class"),
      name: z.string().optional().describe("Name for the group"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "group_objects", params));

  server.registerTool("ungroup_objects", {
    title: "Ungroup objects",
    description: `Dissolve a group — move all children to the group's parent and delete the container.

Args:
  - path (string): Path to the group to dissolve

Returns: Confirmation with reparented child paths.`,
    inputSchema: {
      path: z.string().describe("Group instance path to dissolve"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "ungroup_objects", params));

  server.registerTool("batch_operations", {
    title: "Batch operations",
    description: `Execute multiple tool operations in a single batch. Operations run sequentially.

Args:
  - operations (array): Array of { tool, params } objects (min 1, max 50)

Returns: Array of results for each operation.`,
    inputSchema: {
      operations: z.array(z.object({
        tool: z.string().describe("Tool name to call"),
        params: z.record(z.unknown()).describe("Parameters for the tool"),
      })).min(1).max(50).describe("Operations to execute"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (params) => callStudio(bridge, "batch_operations", params));
};
