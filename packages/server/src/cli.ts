// ============================================================================
// Linkedsword — CLI
// Quick Connect installer + auth file management
// ============================================================================

import { promises as fs, constants as fsConstants } from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { authPath } from "./services/auth.js";

interface ClientTarget {
  name: string;
  configPath: string;
  serverKey: string;       // top-level key inside the config (e.g. "mcpServers")
  detected: boolean;
}

const HOME = homedir();
const IS_MAC = platform() === "darwin";

function clientCandidates(): ClientTarget[] {
  const candidates: ClientTarget[] = [
    { name: "Claude Code (user)", configPath: join(HOME, ".claude.json"), serverKey: "mcpServers", detected: false },
    { name: "Cursor", configPath: join(HOME, ".cursor", "mcp.json"), serverKey: "mcpServers", detected: false },
    { name: "Codex", configPath: join(HOME, ".codex", "config.json"), serverKey: "mcpServers", detected: false },
    { name: "Gemini CLI", configPath: join(HOME, ".gemini", "settings.json"), serverKey: "mcpServers", detected: false },
  ];
  if (IS_MAC) {
    candidates.push({
      name: "VS Code (user settings)",
      configPath: join(HOME, "Library", "Application Support", "Code", "User", "settings.json"),
      serverKey: "mcp.servers",
      detected: false,
    });
  } else {
    candidates.push({
      name: "VS Code (user settings)",
      configPath: join(HOME, ".config", "Code", "User", "settings.json"),
      serverKey: "mcp.servers",
      detected: false,
    });
  }
  return candidates;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function serverEntry(): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "linkedsword-mcp"],
  };
}

async function patchClientConfig(target: ClientTarget): Promise<"added" | "exists" | "error"> {
  let body: Record<string, unknown> = {};
  if (await fileExists(target.configPath)) {
    try {
      const raw = await fs.readFile(target.configPath, "utf-8");
      body = raw.trim().length > 0 ? JSON.parse(raw) : {};
    } catch (err) {
      console.error(`  failed to parse ${target.configPath}: ${(err as Error).message}`);
      return "error";
    }
  } else {
    await fs.mkdir(dirname(target.configPath), { recursive: true });
  }

  // Walk the nested key path (e.g. "mcp.servers" → body.mcp.servers).
  const keyParts = target.serverKey.split(".");
  let cursor: Record<string, unknown> = body;
  for (let i = 0; i < keyParts.length - 1; i++) {
    const key = keyParts[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leaf = keyParts[keyParts.length - 1];
  if (typeof cursor[leaf] !== "object" || cursor[leaf] === null) {
    cursor[leaf] = {};
  }
  const servers = cursor[leaf] as Record<string, unknown>;
  if (servers["linkedsword"]) return "exists";

  servers["linkedsword"] = serverEntry();
  await fs.writeFile(target.configPath, JSON.stringify(body, null, 2) + "\n", "utf-8");
  return "added";
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function installPluginRbxmx(variant: "standard" | "inspector" = "standard"): Promise<void> {
  // Look in two locations: the bundled `plugin/` folder shipped inside the npm
  // tarball (relative to dist/), and the dev-clone path (relative to
  // packages/server/, two levels up). First hit wins.
  const filename = variant === "inspector" ? "LinkedswordInspector.rbxmx" : "Linkedsword.rbxmx";
  const candidates = [
    join(__dirname, "..", "plugin", filename),                  // npm: dist/../plugin/
    join(__dirname, "..", "..", "..", "plugin", filename),      // dev clone: packages/server/src/../../../plugin/
  ];
  let source: string | null = null;
  for (const c of candidates) {
    if (await fileExists(c)) { source = c; break; }
  }
  if (!source) {
    console.error(`Plugin .rbxmx not found. Searched:`);
    for (const c of candidates) console.error(`  ${c}`);
    console.error(`If running from a dev clone, build it first: \`node packages/plugin/build-rbxmx.js${variant === "inspector" ? " --inspector" : ""}\`.`);
    return;
  }
  const dst = join(HOME, "Documents", "Roblox", "Plugins", filename);
  await fs.mkdir(dirname(dst), { recursive: true });
  await fs.copyFile(source, dst);
  console.log(`Installed plugin → ${dst}`);
}

async function runInstall(args: string[]): Promise<void> {
  const yes = args.includes("--yes") || args.includes("-y");
  const clientArg = args.find((a) => a.startsWith("--client="))?.split("=")[1];
  const alsoPlugin = args.includes("--plugin");
  const inspectorVariant = args.includes("--inspector");

  const targets = clientCandidates();
  for (const t of targets) t.detected = await fileExists(t.configPath) || dirname(t.configPath).endsWith(t.name);

  const filtered = clientArg
    ? targets.filter((t) => t.name.toLowerCase().includes(clientArg.toLowerCase()))
    : targets;

  console.log("\nLinkedsword Quick Connect — MCP client install\n");
  console.log("Detected clients:");
  for (const t of filtered) {
    const exists = await fileExists(t.configPath);
    console.log(`  ${exists ? "✓" : " "} ${t.name}  (${t.configPath})`);
  }
  console.log("");

  for (const t of filtered) {
    let go = yes;
    if (!go) {
      const ans = await prompt(`Add Linkedsword to ${t.name}? [y/N] `);
      go = ans.toLowerCase() === "y" || ans.toLowerCase() === "yes";
    }
    if (!go) { console.log(`  skipped ${t.name}`); continue; }
    const result = await patchClientConfig(t);
    if (result === "added") console.log(`  added → ${t.configPath}`);
    else if (result === "exists") console.log(`  already configured → ${t.configPath}`);
    else console.log(`  failed → ${t.configPath}`);
  }

  if (alsoPlugin) {
    await installPluginRbxmx(inspectorVariant ? "inspector" : "standard");
  }

  console.log("\nDone. Reload the affected client(s) to pick up the new server.");
}

async function runAuth(args: string[]): Promise<void> {
  const sub = args[0];
  const p = authPath();
  if (sub === "show") {
    if (!(await fileExists(p))) {
      console.log(`No auth file at ${p}`);
      return;
    }
    const raw = await fs.readFile(p, "utf-8");
    // Mask the secrets when echoing.
    const parsed = JSON.parse(raw) as Record<string, string | number>;
    if (typeof parsed.apiKey === "string") parsed.apiKey = parsed.apiKey.slice(0, 6) + "…";
    if (typeof parsed.cookie === "string") parsed.cookie = parsed.cookie.slice(0, 6) + "…";
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }
  if (sub === "set") {
    const apiKey = args.find((a) => a.startsWith("--api-key="))?.split("=")[1];
    const cookie = args.find((a) => a.startsWith("--cookie="))?.split("=")[1];
    const userIdRaw = args.find((a) => a.startsWith("--user-id="))?.split("=")[1];
    if (!apiKey && !cookie && !userIdRaw) {
      console.error("Pass --api-key=... or --cookie=... (and optionally --user-id=...)");
      process.exit(1);
    }
    let existing: Record<string, unknown> = {};
    if (await fileExists(p)) {
      try { existing = JSON.parse(await fs.readFile(p, "utf-8")); } catch { /* overwrite on parse failure */ }
    }
    if (apiKey) existing.apiKey = apiKey;
    if (cookie) existing.cookie = cookie;
    if (userIdRaw) existing.userId = Number(userIdRaw);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(existing, null, 2) + "\n", { mode: 0o600 });
    console.log(`Wrote ${p}`);
    return;
  }
  console.error("Usage: linkedsword auth set --api-key=... | --cookie=... | --user-id=...");
  console.error("       linkedsword auth show");
  process.exit(1);
}

export async function runCli(argv: string[]): Promise<boolean> {
  const [cmd, ...rest] = argv;
  if (cmd === "install") { await runInstall(rest); return true; }
  if (cmd === "auth")    { await runAuth(rest); return true; }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log("linkedsword commands:");
    console.log("  install [--client=<name>] [--yes] [--plugin] [--inspector]");
    console.log("      Quick Connect for supported MCP clients. --plugin also copies the");
    console.log("      Studio .rbxmx into your local plugins folder; pair with --inspector");
    console.log("      to install the read-only build.");
    console.log("  auth set --api-key=... | --cookie=...           Write ~/.linkedsword/auth.json");
    console.log("  auth show                                        Print the auth file (masked)");
    return true;
  }
  return false;
}
