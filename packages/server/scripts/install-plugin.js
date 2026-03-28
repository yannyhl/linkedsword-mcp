#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const PLUGIN_PKG = path.resolve(__dirname, "..", "..", "plugin");
const RBXMX_PATH = path.join(PLUGIN_PKG, "Linkedsword.rbxmx");
const BUILD_SCRIPT = path.join(PLUGIN_PKG, "build-rbxmx.js");

// 1. Build the .rbxmx if it does not already exist
if (!fs.existsSync(RBXMX_PATH)) {
  console.log("Linkedsword.rbxmx not found — building it now...");
  try {
    execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: "inherit" });
  } catch (err) {
    console.error("Build step failed:", err.message);
    process.exit(1);
  }
}

// 2. Determine the Roblox Studio local plugins folder
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

// 3. Create the plugins directory if it doesn't exist
try {
  fs.mkdirSync(pluginsDir, { recursive: true });
} catch (err) {
  console.error(`Failed to create plugins directory at ${pluginsDir}: ${err.message}`);
  process.exit(1);
}

// 4. Copy the .rbxmx into the plugins folder
const destPath = path.join(pluginsDir, "Linkedsword.rbxmx");
try {
  fs.copyFileSync(RBXMX_PATH, destPath);
} catch (err) {
  console.error(`Failed to copy plugin: ${err.message}`);
  process.exit(1);
}

console.log(`Installed plugin to ${destPath}`);
console.log("");
console.log("Next steps:");
console.log("  1. Open (or restart) Roblox Studio.");
console.log("  2. The Linkedsword plugin will load automatically from your local Plugins folder.");
console.log("  3. If Studio was already open, go to Plugins > Manage Plugins and click");
console.log('     "Reload" to pick up the new version.');
