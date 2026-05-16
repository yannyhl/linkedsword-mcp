// ============================================================================
// Linkedsword — Auth loader
// Reads ~/.linkedsword/auth.json for Roblox API credentials.
// ============================================================================

import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface LSAuth {
  apiKey?: string;        // Open Cloud API key
  cookie?: string;        // ROBLOSECURITY (Decal only by policy)
  userId?: number;        // Default creator id
}

const AUTH_PATH = join(homedir(), ".linkedsword", "auth.json");

let cached: LSAuth | null = null;
let lastRead = 0;
const CACHE_TTL_MS = 30_000;

export async function loadAuth(force = false): Promise<LSAuth | null> {
  if (!force && cached && Date.now() - lastRead < CACHE_TTL_MS) return cached;
  let raw: string;
  try {
    raw = await fs.readFile(AUTH_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as LSAuth;
    cached = parsed;
    lastRead = Date.now();
    return parsed;
  } catch (err) {
    throw new Error(`${AUTH_PATH} is not valid JSON: ${(err as Error).message}`);
  }
}

export function authPath(): string {
  return AUTH_PATH;
}

/**
 * Validate auth presence and return whichever credential is set. Throws with
 * a setup-guidance message when nothing is configured.
 */
export async function requireAuth(needs: "apiKey" | "cookie" | "any"): Promise<LSAuth> {
  const auth = await loadAuth();
  if (!auth) {
    throw new Error(
      `No auth configured. Create ${AUTH_PATH} with { "apiKey": "<open-cloud-key>" } or { "cookie": "<ROBLOSECURITY>" }. Run 'npx linkedsword auth set --api-key=...' or '--cookie=...' to write it automatically.`,
    );
  }
  if (needs === "apiKey" && !auth.apiKey) {
    throw new Error(`This operation requires an Open Cloud API key. Add "apiKey" to ${AUTH_PATH}.`);
  }
  if (needs === "cookie" && !auth.cookie) {
    throw new Error(`This operation requires a ROBLOSECURITY cookie. Add "cookie" to ${AUTH_PATH}.`);
  }
  if (needs === "any" && !auth.apiKey && !auth.cookie) {
    throw new Error(`Auth file exists but has neither apiKey nor cookie. Edit ${AUTH_PATH}.`);
  }
  return auth;
}
