# Linkedsword

**Roblox Studio MCP server + plugin** — 73 tools for script editing, bulk operations, playtest automation, and more.

Linkedsword combines the best of [BoshyXD's community MCP](https://github.com/boshyxd/robloxstudio-mcp) (bulk ops, grep, builds library) with [Roblox's official MCP](https://github.com/Roblox/studio-rust-mcp-server) (playtest automation, virtual input, multi-instance) into a single package, then adds script diff review on top.

## Features

- **Script diff review** — GitHub-style inline diffs inside the Studio plugin. Accept or reject individual hunks before they're applied.
- **73 tools** — navigation, search, script editing, instance manipulation, playtest control, spatial ops, and more.
- **Batch operations** — mass create, duplicate, and set properties across multiple instances.
- **Activity feed** — real-time log of every tool call with timing and status.
- **Mode system** — Full (read + write), Inspector (read-only), or auto-accept for unattended workflows.

## Quick start

### Prerequisites

- Node.js 18+
- Roblox Studio

### 1. Install the MCP server

```bash
# Claude Code
claude mcp add linkedsword -- npx -y linkedsword-mcp-server@latest

# Or add to your MCP config (Claude Desktop, Cursor, etc.)
{
  "mcpServers": {
    "linkedsword": {
      "command": "npx",
      "args": ["-y", "linkedsword-mcp-server@latest"]
    }
  }
}
```

### 2. Install the Studio plugin

```bash
# Clone the repo
git clone https://github.com/yannyhl/melo-mcp.git
cd melo-mcp
npm install

# Build and install the plugin
npm run install-plugin --workspace=packages/server
```

This builds `Linkedsword.rbxmx` and copies it to your local plugins folder:
- **macOS**: `~/Documents/Roblox/Plugins/`
- **Windows**: `%LOCALAPPDATA%/Roblox/Plugins/`

### 3. Enable HTTP requests in Studio

In Roblox Studio: **File > Game Settings > Security > Allow HTTP Requests** (enable it).

The plugin communicates with the MCP server over HTTP on `localhost:3003`. This setting is per-place.

### 4. Connect

1. Open a place in Roblox Studio.
2. Click **Linkedsword** in the Plugins toolbar.
3. The widget should show a "Connected" status.
4. Start using tools from your MCP client.

## Architecture

```
MCP Client (Claude Code, Cursor, etc.)
  ── stdio ──>  Linkedsword MCP Server (Node/TypeScript)
                  ├── Diff Engine (Myers' algorithm)
                  └── HTTP Bridge (long-poll, localhost:3003)
                        ── HTTP ──>  Roblox Studio Plugin (Luau)
                                       ├── Tool Handlers
                                       ├── Diff Review UI
                                       └── Activity Feed
```

## Tool registry (73)

### Navigation (6)
`get_file_tree` . `get_project_structure` . `get_place_info` . `get_services` . `list_roblox_studios` . `set_active_studio`

### Search & Inspection (11)
`search_files` . `search_objects` . `search_by_property` . `get_instance_properties` . `get_instance_children` . `get_class_info` . `get_selection` . `grep_scripts` . `mass_get_property` . `set_selection` . `get_descendants`

### Script Editing (9 — with diff staging)
`get_script_source` . `set_script_source` . `patch_script` . `grep_replace` . `execute_luau` . `run_code` . `edit_script_lines` . `insert_script_lines` . `delete_script_lines`

### Instance Manipulation (13)
`create_object` . `delete_object` . `set_property` . `mass_create_objects` . `mass_set_property` . `mass_duplicate` . `smart_duplicate` . `set_calculated_property` . `clone_object` . `reparent_object` . `group_objects` . `ungroup_objects` . `batch_operations`

### Playtest Automation (8)
`start_playtest` . `stop_playtest` . `get_playtest_output` . `get_studio_mode` . `run_script_in_play_mode` . `user_mouse_input` . `user_keyboard_input` . `character_navigation`

### Diff & Meta (21)
`get_diff_queue` . `resolve_diff` . `get_diff_history` . `get_activity_log` . `set_mode` . `rollback` . `redo` . `get_attribute` . `get_attributes` . `set_attribute` . `delete_attribute` . `get_tags` . `get_tagged` . `add_tag` . `remove_tag` . `capture_screenshot` . `export_build` . `import_build` . `list_library` . `insert_model` . `get_console_output`

### Spatial (5)
`create_weld` . `get_bounding_box` . `raycast` . `fill_terrain` . `clear_terrain`

## Development

```bash
git clone https://github.com/yannyhl/melo-mcp.git
cd melo-mcp
npm install

# Build server
npx tsup packages/server/src/index.ts --format cjs --out-dir packages/server/dist --clean

# Build plugin
node packages/plugin/build-rbxmx.js

# Deploy plugin to Studio
cp packages/plugin/Linkedsword.rbxmx ~/Documents/Roblox/Plugins/Linkedsword.rbxmx
```

### Local MCP config

Copy `.mcp.json.example` to `.mcp.json` and adjust the path if needed:

```bash
cp .mcp.json.example .mcp.json
```

### Project structure

```
melo-mcp/
├── packages/
│   ├── server/               # MCP server (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts      # Entry point
│   │   │   ├── services/
│   │   │   │   ├── bridge.ts       # HTTP long-poll bridge
│   │   │   │   └── diff-engine.ts  # Myers' diff computation
│   │   │   └── tools/
│   │   │       ├── navigation.ts   # 6 tools
│   │   │       ├── search.ts       # 11 tools
│   │   │       ├── script.ts       # 9 tools
│   │   │       ├── instance.ts     # 13 tools
│   │   │       ├── playtest.ts     # 8 tools
│   │   │       ├── diff-meta.ts    # 21 tools
│   │   │       └── spatial.ts      # 5 tools
│   │   └── package.json
│   └── plugin/               # Roblox Studio plugin (Luau)
│       └── src/
│           └── plugin.luau   # Single-file plugin (~4700 lines)
├── docs/
│   └── README.md             # Internal handbook (architecture, caveats, LLM guide)
├── .mcp.json.example         # MCP config template
└── README.md
```

## Known limitations

- Heartbeat timeouts on rapid parallel tool calls (retry works).
- MCP server restart requires reloading your editor window.
- `user_mouse_input` and `user_keyboard_input` are not fully implemented in the plugin.
- `capture_screenshot` is not yet available.
- Sandbox mode is declared but not implemented.

See `docs/README.md` for the full caveats list.

## License

MIT
