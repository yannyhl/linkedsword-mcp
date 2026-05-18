# Linkedsword

A Roblox Studio MCP server and plugin. Lets you drive Studio from an MCP client (Claude Code, Cursor, VS Code, etc.) — read the data model, edit scripts with a diff review step, run playtests, manage assets.

## Features

- **Diff-reviewed script editing.** Edits stage as hunks inside the plugin widget. Accept or reject each one before it touches the source.
- **Planning Mode.** Multi-step plans with DataModel checkpoints. Snapshot before a risky step, revert if it goes sideways.
- **Playtest automation.** Start/stop play sessions, simulate keyboard/mouse, run end-to-end scenarios with structured pass/fail verdicts.
- **Asset pipeline.** Upload Decals/Audio/Models/Meshes via Open Cloud or a `ROBLOSECURITY` cookie; search the Creator Store; resolve thumbnails.
- **Inspector build.** A separate read-only `.rbxmx` variant for sessions where you don't want any write surface.
- **Stable instance handles.** `ls://<uuid>` handles that survive renames and reparents.
- **Multi-instance Studio.** Connect to multiple Studio windows and route tools to any of them.

93 tools across navigation, search, scripts, instances, playtests, plans, assets, and terrain.

## Install

Requires Node.js 18+ and Roblox Studio.

```bash
# Auto-detect installed MCP clients and add Linkedsword
npx linkedsword-mcp install

# Build and install the Studio plugin
npx linkedsword-mcp install --plugin
```

Or wire it into your MCP client by hand:

```json
{
  "mcpServers": {
    "linkedsword": {
      "command": "npx",
      "args": ["-y", "linkedsword-mcp"]
    }
  }
}
```

In Roblox Studio enable **File → Game Settings → Security → Allow HTTP Requests** (per-place), then click the **Linkedsword** toolbar button to connect.

## Asset uploads

Drop credentials into `~/.linkedsword/auth.json`, or use the CLI:

```bash
# Open Cloud API key (recommended; supports all asset types)
npx linkedsword-mcp auth set --api-key=<key> --user-id=<creator-id>

# Or ROBLOSECURITY cookie (Decal uploads only)
npx linkedsword-mcp auth set --cookie=<cookie>
```

The file is written with mode `0600`. `auth show` prints a masked summary.

## Architecture

```
MCP client  ──stdio──>  Linkedsword server  ──HTTP (127.0.0.1:3003)──>  Studio plugin
```

The server registers MCP tools and runs an Express bridge. The plugin long-polls the bridge for work, executes it against the live DataModel, and posts results back. Script edits go through a diff engine that stages hunks in a pop-out window for review.

## Build from source

```bash
git clone https://github.com/yannyhl/linkedsword-mcp.git
cd linkedsword-mcp
npm install

# Server
npx tsup packages/server/src/index.ts --format cjs --out-dir packages/server/dist --clean

# Plugin (normal + inspector-only variants)
node packages/plugin/build-rbxmx.js
node packages/plugin/build-rbxmx.js --inspector

# Deploy
cp packages/plugin/Linkedsword.rbxmx ~/Documents/Roblox/Plugins/
```

## Known limitations

- Plugin sandbox doesn't expose viewport pixels — `capture_screenshot` returns camera metadata only, not a real image.
- Heartbeat can drop on rapid parallel calls. Retry once if you see a timeout.
- Procedural Models aren't implemented yet (Roblox added the instance type in April 2026; tool support is on the roadmap).

## License

MIT
