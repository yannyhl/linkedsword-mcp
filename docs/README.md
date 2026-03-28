# Linkedsword Docs

This is the central handbook for understanding how Linkedsword works as an MCP-backed Roblox Studio engineering loop.

If you are an LLM, agent, or operator, read this file before making changes. It is intended to connect:

- the repo layout
- the MCP server surface area
- the Roblox Studio plugin behavior
- the real request/response lifecycle
- the current implementation limits

## What Linkedsword Is

Linkedsword is a local Roblox Studio MCP stack with two runtime pieces:

1. A Node/TypeScript MCP server in `packages/server`
2. A Roblox Studio plugin in `packages/plugin/src/plugin.luau`

The MCP server talks to an MCP client over `stdio`, and talks to the Studio plugin over a local HTTP bridge on `127.0.0.1:3003` by default.

In practice, that means:

- Cursor / Claude / another MCP client sends a tool call to Linkedsword
- Linkedsword forwards the request to the connected Studio plugin
- the plugin executes against the live DataModel in Studio
- the result comes back through the bridge and is returned to the LLM

## System Diagram

```text
LLM / MCP Client
  -> stdio
Linkedsword MCP Server (`packages/server/src/index.ts`)
  -> in-memory bridge + request queue
HTTP Bridge (`packages/server/src/services/bridge.ts`)
  -> http://127.0.0.1:3003
Roblox Studio Plugin (`packages/plugin/src/plugin.luau`)
  -> DataModel / ScriptEditorService / Selection / ChangeHistoryService / RunService
Roblox Studio Place
```

## Repo Map

### Top level

- `README.md`: public-facing overview and quick start
- `docs/README.md`: the internal operator + LLM handbook
- `.mcp.json.example`: template for local MCP config (copy to `.mcp.json`)
- `.claude/settings.json`: allowed Linkedsword tools and local permissions for Claude
- `package.json`: root workspace scripts

### Server

- `packages/server/src/index.ts`: boots the MCP server, HTTP bridge, and tool registrars
- `packages/server/src/constants.ts`: port, timeouts, version, limits
- `packages/server/src/types.ts`: shared server-side bridge and diff types
- `packages/server/src/services/bridge.ts`: long-poll bridge between Node and Studio
- `packages/server/src/services/diff-engine.ts`: structured hunk diff generation
- `packages/server/src/tools/*.ts`: MCP tool registration grouped by domain

### Plugin

- `packages/plugin/src/plugin.luau`: single-file plugin containing:
- connection loop
- tool handlers
- diff review UI
- activity feed
- settings UI
- mascot animation

This plugin file is currently monolithic. Most of the "what actually happens in Studio" lives there.

## Runtime Flow

### 1. Server startup

The Node entrypoint creates:

- an `McpServer`
- an `HttpBridge`
- all tool registrars

Then it starts the HTTP bridge and connects the MCP server over stdio.

Relevant files:

- `packages/server/src/index.ts`
- `packages/server/src/services/bridge.ts`

### 2. Plugin connection

The Studio plugin:

- generates an `instanceId`
- POSTs heartbeat messages to `/heartbeat`
- long-polls `/poll/:instanceId`
- executes incoming tool requests
- POSTs results to `/response`

Relevant plugin helpers:

- `httpGet()`
- `httpPost()`
- `mainLoop()`
- `pollForWork()`

All of these live in `packages/plugin/src/plugin.luau`.

### 3. Tool execution

Most server tools are thin wrappers:

- validate input with `zod`
- call `bridge.sendToStudio(...)`
- format the response for MCP

Shared helper:

- `packages/server/src/tools/_helpers.ts`

### 4. Script edit flow

Script editing is different from plain property/object tools:

1. `set_script_source` or `patch_script` first reads the current script
2. the server computes a structured diff using `diff-engine.ts`
3. the diff is staged in the server queue
4. the diff is also sent to the plugin using `stage_diff`
5. the plugin renders a diff review UI
6. the user can accept/reject whole files or individual hunks
7. accepted hunks are applied back into the script

This is the main "agentic engineering" loop in Linkedsword.

## Modes And Safety Model

The server config supports three modes:

- `full`: all tools available
- `inspector`: read-only tools only
- `sandbox`: declared as experimental

Important current behavior:

- `inspector` is actually enforced in `bridge.ts`
- `sandbox` is not implemented as a real shadow-copy execution system yet
- diff-based script editing is the main safety layer for code changes
- many instance/property operations rely on Studio undo via `ChangeHistoryService`

## Tool Registry

The source of truth for registered tools is the server code in `packages/server/src/tools`.

### Navigation

Defined in `packages/server/src/tools/navigation.ts`:

- `get_file_tree`
- `get_project_structure`
- `get_place_info`
- `get_services`
- `list_roblox_studios`
- `set_active_studio`

Use these first when an LLM needs basic project context.

### Search and inspection

Defined in `packages/server/src/tools/search.ts`:

- `search_files`
- `search_objects`
- `search_by_property`
- `get_instance_properties`
- `get_instance_children`
- `get_class_info`
- `get_selection`
- `set_selection`
- `grep_scripts`
- `mass_get_property`
- `get_descendants`

These are mostly read-only discovery tools (except `set_selection`).

### Script tools

Defined in `packages/server/src/tools/script.ts`:

- `get_script_source`
- `set_script_source`
- `patch_script`
- `grep_replace`
- `execute_luau`
- `run_code`
- `edit_script_lines`
- `insert_script_lines`
- `delete_script_lines`

Notes:

- `set_script_source` stages a diff unless auto-accept is enabled
- `patch_script` requires a unique `oldText` match
- `run_code` is an alias of `execute_luau`
- `edit_script_lines`, `insert_script_lines`, `delete_script_lines` operate on line ranges and stage diffs

### Instance tools

Defined in `packages/server/src/tools/instance.ts`:

- `create_object`
- `delete_object`
- `set_property`
- `mass_create_objects`
- `mass_set_property`
- `mass_duplicate`
- `smart_duplicate`
- `set_calculated_property`
- `clone_object`
- `reparent_object`
- `group_objects`
- `ungroup_objects`
- `batch_operations`

These directly mutate the live DataModel through the plugin.

### Playtest tools

Defined in `packages/server/src/tools/playtest.ts`:

- `start_playtest`
- `stop_playtest`
- `get_playtest_output`
- `get_studio_mode`
- `run_script_in_play_mode`
- `user_mouse_input`
- `user_keyboard_input`
- `character_navigation`

These are the most important tools to verify against current implementation before relying on them.

### Diff, meta, attributes, tags, and build tools

Defined in `packages/server/src/tools/diff-meta.ts`:

- `get_diff_queue`
- `resolve_diff`
- `get_diff_history`
- `get_activity_log`
- `set_mode`
- `rollback`
- `redo`
- `get_attribute`
- `get_attributes`
- `set_attribute`
- `delete_attribute`
- `get_tags`
- `get_tagged`
- `add_tag`
- `remove_tag`
- `capture_screenshot`
- `export_build`
- `import_build`
- `list_library`
- `insert_model`
- `get_console_output`

### Spatial tools

Defined in `packages/server/src/tools/spatial.ts`:

- `create_weld`
- `get_bounding_box`
- `raycast`
- `fill_terrain`
- `clear_terrain`

## What The Plugin Actually Implements

The plugin is the runtime truth for what Studio can really do today.

Broad categories implemented inside `packages/plugin/src/plugin.luau` (~4700 lines):

- Explorer/DataModel traversal (file tree, descendants, project structure)
- property reads and writes (single, mass, calculated)
- script reads and writes (full source, line-level edits, grep-replace)
- staged diff rendering and resolution (GitHub-style hunk review UI)
- diff history tracking (accepted/rejected outcomes)
- direct Luau execution (`execute_luau` / `run_code`)
- object creation/deletion/duplication/cloning/reparenting/grouping
- batch operations (sequential multi-tool execution)
- rollback and redo through Studio ChangeHistoryService
- attribute and tag management (get/set/delete/add/remove)
- selection control (get/set Explorer selection)
- simple build library persistence via `plugin:GetSetting`
- insert model by asset ID
- spatial tools: raycast, bounding box, weld creation, terrain fill/clear
- console output capture (print/warn/error logs)
- playtest control (start/stop, mode detection)
- mascot system with 3 skins (cat, robot, dog) and idle/active animations
- activity feed with real-time tool call logging

## Important Current Caveats

This section documents known gaps between tool descriptions and actual implementation.

### Port and local bridge

- the default port in code is `3003`
- `.mcp.json` points at `packages/server/dist/index.js`
- some text in the public README still described `3002` before this doc was added

### Playtest tooling is only partially real

Current plugin handlers show:

- `start_playtest` returns a success stub
- `stop_playtest` returns a success stub
- `get_playtest_output` returns an empty stub payload
- `run_script_in_play_mode` currently just runs code immediately

That means the server interface for playtest automation exists, but the Studio implementation is not yet a full playtest controller.

### Virtual input is not available

Current plugin behavior:

- `user_mouse_input` returns an error saying virtual mouse input is unavailable
- `user_keyboard_input` returns an error saying virtual keyboard input is unavailable

### Screenshot capture is not available

`capture_screenshot` currently returns an unavailable error from the plugin.

### "Sandbox" mode is not implemented

The mode exists in types, config, and tool descriptions, but there is no real sandbox execution path in the bridge or plugin.

### Some tool descriptions are broader than the implementation

Examples:

- `get_instance_properties` returns a curated subset of properties, not every possible property
- `get_class_info` builds a synthetic summary from a temporary instance, not a full Roblox API reference
- `search_by_property` compares stringified property values

### "Transaction-safe" batch ops are not fully transaction-safe yet

The tool descriptions market some batch operations as atomic or rollback-safe.

Current plugin behavior is best described as:

- iterate
- apply per item
- collect errors
- return partial success in many cases

If true all-or-nothing semantics are required, they still need to be implemented.

## LLM Operating Guide

If you are using Linkedsword as an agentic engineering surface, the safest default workflow is:

1. Discover structure with `get_project_structure` or `get_file_tree`
2. Narrow down with `search_files`, `search_objects`, `grep_scripts`, and `get_script_source`
3. Prefer `patch_script` for focused edits
4. Use `set_script_source` for larger script rewrites
5. Review pending diffs with `get_diff_queue`
6. Use `resolve_diff` only when an automated accept/reject flow is truly intended
7. Use `rollback` if the operation was wrong and Studio undo should revert it

For inspection-only sessions:

1. call `set_mode` with `inspector`
2. avoid write tools entirely
3. gather context with search/navigation tools first

For broad one-off Studio queries:

- prefer `run_code` / `execute_luau`
- keep the code small and explicit
- use `print()` for structured output

## Local Config Surface

### MCP config

Copy `.mcp.json.example` to `.mcp.json` to register Linkedsword locally:

- command: `node`
- args: `packages/server/dist/index.js`

This is the simplest local setup for Cursor/Claude-style MCP clients. The `.mcp.json` file is gitignored since it may contain absolute paths.

### Claude permissions

`.claude/settings.json` and `.claude/settings.local.json` whitelist a subset of Linkedsword tools and a few local shell/web operations.

That means the repo already has some local agent-permission intent encoded outside the app code.

## Extension Guide

To add a new MCP tool cleanly:

1. register the MCP tool in the correct file under `packages/server/src/tools`
2. validate inputs with `zod`
3. if it is a Studio-backed tool, send it through `bridge.sendToStudio`
4. add a handler in `packages/plugin/src/plugin.luau`
5. if it mutates scripts, decide whether it should use the staged diff flow
6. update this doc and the public `README.md` if the tool changes the user-facing surface area

If a tool is server-only, it can return directly without going through Studio.

## Suggested Source-Of-Truth Order

When docs and code disagree, trust them in this order:

1. `packages/plugin/src/plugin.luau`
2. `packages/server/src/services/bridge.ts`
3. `packages/server/src/tools/*.ts`
4. `README.md`

The plugin is the final authority on what Roblox Studio can actually execute.

## Quick File Reference

- boot MCP server: `packages/server/src/index.ts`
- bridge transport: `packages/server/src/services/bridge.ts`
- diff logic: `packages/server/src/services/diff-engine.ts`
- tool registration: `packages/server/src/tools`
- Studio runtime truth: `packages/plugin/src/plugin.luau`
- local MCP config: `.mcp.json` (from `.mcp.json.example`)
- Claude permissions: `.claude/settings.json`

## Why This Doc Exists

Linkedsword is trying to be more than a raw tool list. It is trying to be a reliable engineering loop between:

- an LLM
- a local MCP server
- a review-aware editing model
- a live Roblox Studio runtime

That only works well if the docs match the code. This file is the repo's single general-purpose reference for that connection.
