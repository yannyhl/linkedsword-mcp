# Linkedsword internals

Architecture and tool reference. The public README is the right starting point for installing and using the project; this doc is for working on it.

## Stack

Two runtime pieces:

1. Node/TypeScript MCP server in `packages/server`
2. Roblox Studio plugin (single Luau file) in `packages/plugin/src/plugin.luau`

The MCP client talks to the server over stdio. The server holds an Express bridge on `127.0.0.1:3003`. The plugin long-polls the bridge for work and posts results back.

```
MCP client ──stdio──> server (Node) ──HTTP──> plugin (Luau) ──> DataModel
```

## Repo map

```
packages/server/src/
  index.ts                # boot, CLI dispatch, tool registration
  constants.ts            # port, timeouts, version
  types.ts                # bridge + diff shared types
  services/
    bridge.ts             # long-poll HTTP bridge, mode gating
    diff-engine.ts        # hunk diff generation
    auth.ts               # ~/.linkedsword/auth.json loader
    plan-engine.ts        # plan + checkpoint persistence
  tools/
    navigation.ts         # data model traversal
    search.ts             # discovery, compare, connected refs, parallel search
    script.ts             # read, set, patch, line edits, grep-replace
    instance.ts           # create, delete, set, batch, duplicate, group
    playtest.ts           # start/stop, virtual input, character nav, scenario runner
    spatial.ts            # welds, raycast, bounding box, terrain
    assets.ts             # upload, Creator Store search, thumbnails
    plan.ts               # plans + checkpoints
    diff-meta.ts          # diff queue, attributes, tags, build library, console
  cli.ts                  # `install` (Quick Connect), `auth set/show`

packages/plugin/
  src/plugin.luau         # plugin source (monolithic)
  build-rbxmx.js          # CDATA-wraps the Luau into an .rbxmx
  Linkedsword.rbxmx       # built normal plugin
  LinkedswordInspector.rbxmx  # built inspector-only variant
```

## Request lifecycle

1. **Server boot.** `index.ts` creates an `McpServer`, an `HttpBridge`, and runs each `register*Tools(server, bridge)`. The bridge starts listening; the MCP server connects over stdio.
2. **Plugin connect.** The plugin POSTs `/heartbeat` and long-polls `/poll/:instanceId`.
3. **Tool call.** MCP client sends a tool request. The server validates with zod, then either resolves locally (e.g. plan engine state) or pushes the request onto the bridge queue.
4. **Plugin execute.** The poll resolves with `{id, action, params}`. The plugin dispatches to `handlers[action]` and POSTs the response.
5. **Response.** The bridge resolves the pending Promise; the tool handler returns content back through stdio.

## Modes

The bridge enforces a `mode` field (`full` | `inspector`). In inspector mode `handlePoll` rejects any tool not in the read-only allowlist (`isReadOnlyTool` in `bridge.ts`). Inspector mode is also available as a separate plugin build — `node packages/plugin/build-rbxmx.js --inspector` emits `LinkedswordInspector.rbxmx` with the `INSPECTOR_ONLY` flag flipped, which adds a second guard at the plugin dispatch site.

## Script edits

Script-editing tools (`set_script_source`, `patch_script`, `edit_script_lines`, etc.) follow a diff-staging flow:

1. Fetch current source via `get_script_source`.
2. Compute new source (splice lines, find/replace, etc.).
3. If auto-accept is on (global flag or session/next-N budget), write directly via `set_script_source_direct`.
4. Otherwise compute a structured diff in `diff-engine.ts`, push it onto the bridge's `diffQueue`, send a `stage_diff` request to the plugin, and return a summary.
5. The plugin renders the diff in a pop-out window. The user accepts or rejects per file or per hunk; the resolved diff is archived to `diffHistory`.

## Auto-accept budgets

Three modes managed by `bridge.shouldAutoAccept()`:

- `off`: every diff stages and waits for review.
- `next_n`: the next N diffs auto-apply; each accept consumes one budget unit. When it hits zero, the bridge flips back to `off`.
- `session`: every diff auto-applies until the budget is explicitly turned off or the plugin reconnects.

Set via the `set_auto_accept` tool; inspect via `get_auto_accept_status`.

## Planning Mode

`packages/server/src/services/plan-engine.ts` keeps plans and checkpoints in memory and persists them under `~/.linkedsword/`:

```
~/.linkedsword/
  plans/<planId>.json
  checkpoints/<checkpointId>.json       # snapshot body
  checkpoints/<checkpointId>.meta.json  # metadata only (loaded on boot)
```

Bodies are loaded lazily on revert so boot stays cheap. Caps: 50 active plans, 10 checkpoints per plan (oldest evicted, with cascade cleanup if a plan is deleted).

The plugin handlers `snapshot_subtree` and `revert_subtree` do the heavy work. Snapshots include serialized properties (Vector3, Color3, CFrame, EnumItem, UDim2, NumberSequence, ColorSequence, Rect, BrickColor, Instance refs — tagged `{__t: ...}` for type-aware restore), attributes, tags, and script source. Revert destroys the existing instance and rebuilds from the snapshot inside a single `ChangeHistoryService:SetWaypoint` pair so one Ctrl+Z still works.

## Playtest scenarios

`run_playtest_scenario` orchestrates the existing playtest primitives:

1. `start_playtest`.
2. Loop the step list: `wait`, `key`, `mouse`, `navigate`, `execute`, `assert`.
3. Assertions wrap user Luau in a `pcall` plus a sentinel print (`LS_ASSERT_PASS` / `LS_ASSERT_FAIL` / `LS_ASSERT_ERROR:...`) that the server reads off the captured output.
4. `stop_playtest` always runs at the end, even on failure.

Verdicts: `pass`, `fail`, `inconclusive` (max duration hit or loop detected), `error`.

## Assets

`packages/server/src/tools/assets.ts` handles uploads via Open Cloud (`https://apis.roblox.com/assets/v1/assets`) or the legacy publish endpoint with a `ROBLOSECURITY` cookie (Decal only). Credentials live in `~/.linkedsword/auth.json` loaded by `services/auth.ts`; `npx linkedsword-mcp-server auth set` writes the file at mode `0600`.

Creator Store search (`search_assets`, `get_asset_details`, `get_asset_thumbnail`) hits public catalog endpoints — no auth needed. The catalog API only accepts `Limit ∈ {10, 28, 30, 60, 120}`, so the tool clamps the requested limit up to the next allowed value, and string asset names (`Model`, `Decal`, etc.) are mapped to the numeric AssetType IDs the endpoint expects.

## Adding a tool

1. Register the tool in the appropriate `packages/server/src/tools/*.ts` file with a zod schema.
2. If it needs Studio, route it through `bridge.sendToStudio(toolName, params)` and add a matching `handlers[toolName]` in `plugin.luau`. Otherwise resolve it server-side (e.g. plan engine).
3. If it's read-only, add the tool name to `isReadOnlyTool` in `bridge.ts` so inspector mode allows it, and to `READ_ONLY_TOOLS` in `plugin.luau` so the inspector build allows it.
4. Plugin handlers must nil-guard their params on line 1, wrap mutations in `ChangeHistoryService:SetWaypoint("LS:<verb>")` before and after, and return `{success, data?}` or `{success = false, error}`.
5. Build the server (`npx tsup ...`), rebuild the plugin (`node packages/plugin/build-rbxmx.js`), redeploy it, and reload the MCP client to pick up the new schema.

## Tool registry

Source of truth is the code. The current set:

| Category | File | Tools |
|---|---|---|
| Navigation | `tools/navigation.ts` | `get_file_tree`, `get_project_structure`, `get_place_info`, `get_services`, `list_roblox_studios`, `set_active_studio` |
| Search | `tools/search.ts` | `search_files`, `search_objects`, `search_by_property`, `get_instance_properties`, `get_instance_children`, `get_class_info`, `get_selection`, `set_selection`, `grep_scripts`, `mass_get_property`, `get_descendants`, `get_stable_id`, `resolve_stable_id`, `compare_instances`, `get_connected_instances`, `parallel_search` |
| Script | `tools/script.ts` | `get_script_source`, `set_script_source`, `patch_script`, `grep_replace`, `execute_luau`, `run_code`, `edit_script_lines`, `insert_script_lines`, `delete_script_lines` |
| Instance | `tools/instance.ts` | `create_object`, `delete_object`, `set_property`, `mass_create_objects`, `mass_set_property`, `mass_duplicate`, `smart_duplicate`, `set_calculated_property`, `clone_object`, `reparent_object`, `group_objects`, `ungroup_objects`, `batch_operations` |
| Playtest | `tools/playtest.ts` | `start_playtest`, `stop_playtest`, `get_playtest_output`, `get_studio_mode`, `run_script_in_play_mode`, `user_mouse_input`, `user_keyboard_input`, `character_navigation`, `run_playtest_scenario` |
| Spatial | `tools/spatial.ts` | `create_weld`, `get_bounding_box`, `raycast`, `fill_terrain`, `clear_terrain` |
| Assets | `tools/assets.ts` | `upload_asset`, `search_assets`, `get_asset_details`, `get_asset_thumbnail` |
| Plans | `tools/plan.ts` | `create_plan`, `get_plan`, `list_plans`, `update_plan_step`, `delete_plan`, `snapshot_checkpoint`, `revert_to_checkpoint`, `delete_checkpoint` |
| Diff/meta | `tools/diff-meta.ts` | `get_diff_queue`, `resolve_diff`, `get_diff_history`, `get_activity_log`, `set_mode`, `set_auto_accept`, `get_auto_accept_status`, `rollback`, `redo`, `get_attribute`, `get_attributes`, `set_attribute`, `delete_attribute`, `get_tags`, `get_tagged`, `add_tag`, `remove_tag`, `capture_screenshot`, `export_build`, `import_build`, `list_library`, `insert_model`, `get_console_output` |

93 tools total.

## Known limitations

- **Pixel screenshots.** Plugin sandbox doesn't expose viewport pixels; `capture_screenshot` returns camera metadata only.
- **Heartbeat drops.** Rapid parallel calls can drop the long-poll connection. `parallel_search` internally batches 3-at-a-time for that reason; if you're firing N tools by hand, cap at 3 concurrent.
- **MCP server restart.** A schema change requires reloading the MCP client window — the harness reads tool definitions on connect.
- **Procedural Models.** Roblox shipped the `ProceduralModel` instance type in April 2026. A spike confirmed it's plugin-accessible, but `generate_procedural_model` isn't built yet.
- **`get_instance_properties`** returns a curated subset, not every property the instance exposes.
- **`search_by_property`** compares stringified values, so floats and exotic types may not match exactly.

## Source of truth

When docs and code disagree, the code wins. In order:

1. `packages/plugin/src/plugin.luau` — what Roblox Studio can actually do.
2. `packages/server/src/services/bridge.ts` — how requests flow.
3. `packages/server/src/tools/*.ts` — the tool surface.
4. This file, then the public README.
