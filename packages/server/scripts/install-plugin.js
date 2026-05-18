#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// Try the bundled location first (npm install), then fall back to the dev
// clone's sibling packages/plugin/ directory.
const PKG_ROOT = path.resolve(__dirname, "..");
const BUNDLED_RBXMX = path.join(PKG_ROOT, "plugin", "Linkedsword.rbxmx");
const DEV_PLUGIN_DIR = path.resolve(PKG_ROOT, "..", "plugin");
const DEV_RBXMX = path.join(DEV_PLUGIN_DIR, "Linkedsword.rbxmx");
const DEV_BUILD_SCRIPT = path.join(DEV_PLUGIN_DIR, "build-rbxmx.js");

let sourceRbxmx;
if (fs.existsSync(BUNDLED_RBXMX)) {
  sourceRbxmx = BUNDLED_RBXMX;
} else if (fs.existsSync(DEV_RBXMX)) {
  sourceRbxmx = DEV_RBXMX;
} else if (fs.existsSync(DEV_BUILD_SCRIPT)) {
  console.log("Linkedsword.rbxmx not found — building it now...");
  try {
    execFileSync(process.execPath, [DEV_BUILD_SCRIPT], { stdio: "inherit" });
    sourceRbxmx = DEV_RBXMX;
  } catch (err) {
    console.error("Build step failed:", err.message);
    process.exit(1);
  }
} else {
  console.error("Cannot locate Linkedsword.rbxmx. Tried:");
  console.error(`  ${BUNDLED_RBXMX}`);
  console.error(`  ${DEV_RBXMX}`);
  process.exit(1);
}

let pluginsDir;
if (process.platform === "darwin") {
  pluginsDir = path.join(os.homedir(), "Documents", "Roblox", "Plugins");
} else if (process.platform === "win32") {
  pluginsDir = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "Roblox",
    "Plugins"
  );
} else {
  console.error(
    "Unsupported platform. Please copy Linkedsword.rbxmx to your Roblox Studio Plugins folder manually."
  );
  process.exit(1);
}

try {
  fs.mkdirSync(pluginsDir, { recursive: true });
} catch (err) {
  console.error(`Failed to create plugins directory at ${pluginsDir}: ${err.message}`);
  process.exit(1);
}

const destPath = path.join(pluginsDir, "Linkedsword.rbxmx");
try {
  fs.copyFileSync(sourceRbxmx, destPath);
} catch (err) {
  console.error(`Failed to copy plugin: ${err.message}`);
  process.exit(1);
}

console.log(`Installed plugin to ${destPath}`);
console.log("");
console.log("Next steps:");
console.log("  1. Open (or restart) Roblox Studio.");
console.log("  2. The Linkedsword plugin will load automatically from your local Plugins folder.");
console.log("  3. If Studio was already open, click Disconnect/Connect in the plugin widget,");
console.log("     or reload the plugin via Plugins > Manage Plugins.");
