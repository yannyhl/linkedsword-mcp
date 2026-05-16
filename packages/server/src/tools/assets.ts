// ============================================================================
// Linkedsword — Asset Tools
// Open Cloud asset upload + Creator Store search/details/thumbnails
// ============================================================================

import { z } from "zod";
import { promises as fs } from "fs";
import { basename } from "path";
import { ToolRegistrar, success, error } from "./_helpers.js";
import { requireAuth } from "../services/auth.js";

const ASSET_TYPE_TO_OPEN_CLOUD: Record<string, string> = {
  Decal: "Decal",
  Audio: "Audio",
  Model: "Model",
  MeshPart: "MeshPart",
};

interface OpenCloudOperation {
  done?: boolean;
  response?: { assetId?: string | number };
  error?: { message?: string };
}

async function pollOperation(operationId: string, apiKey: string, timeoutMs: number): Promise<OpenCloudOperation> {
  const start = Date.now();
  const url = `https://apis.roblox.com/assets/v1/operations/${operationId}`;
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!res.ok) {
      throw new Error(`Operation poll failed: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as OpenCloudOperation;
    if (body.done) return body;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Operation polling timed out after 60s");
}

export const registerAssetTools: ToolRegistrar = (server, _bridge) => {
  server.registerTool("upload_asset", {
    title: "Upload asset to Roblox",
    description: `Upload a local file as a Roblox asset via Open Cloud (API key) or, for Decals only, the legacy publish endpoint with a ROBLOSECURITY cookie.

Auth: configure ~/.linkedsword/auth.json with { "apiKey": "..." } (full asset types) or { "cookie": "..." } (Decal only).

Args:
  - filePath (string): Absolute path on disk
  - assetType (enum): "Decal" | "Audio" | "Model" | "MeshPart"
  - name (string): Asset name
  - description (string, optional)
  - creatorId (number, optional): User or group id. Defaults to userId in auth.json.
  - creatorType (enum, default "User"): "User" | "Group"

Returns: { assetId, operationId, status }`,
    inputSchema: {
      filePath: z.string().describe("Absolute path to the file"),
      assetType: z.enum(["Decal", "Audio", "Model", "MeshPart"]).describe("Asset type"),
      name: z.string().min(1).describe("Asset name"),
      description: z.string().optional().describe("Asset description"),
      creatorId: z.number().int().optional().describe("Creator user/group id"),
      creatorType: z.enum(["User", "Group"]).default("User").describe("Creator entity type"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params) => {
    let fileBytes: Buffer;
    try {
      fileBytes = await fs.readFile(params.filePath);
    } catch (err) {
      return error(`Failed to read file: ${(err as Error).message}`);
    }

    let auth;
    try {
      auth = await requireAuth("any");
    } catch (err) {
      return error((err as Error).message);
    }

    if (auth.apiKey) {
      const creatorId = params.creatorId ?? auth.userId;
      if (!creatorId) {
        return error("creatorId not provided and userId is not set in auth.json — pass creatorId or add userId to the auth file.");
      }
      const request = {
        assetType: ASSET_TYPE_TO_OPEN_CLOUD[params.assetType],
        displayName: params.name,
        description: params.description ?? "",
        creationContext: {
          creator: params.creatorType === "Group"
            ? { groupId: creatorId }
            : { userId: creatorId },
        },
      };
      const form = new FormData();
      form.append("request", JSON.stringify(request));
      const filename = basename(params.filePath);
      form.append("fileContent", new Blob([new Uint8Array(fileBytes)]), filename);

      const res = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": auth.apiKey },
        body: form,
      });
      if (!res.ok) {
        return error(`Upload failed: HTTP ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { operationId?: string; path?: string };
      const operationId = body.operationId ?? body.path?.split("/").pop() ?? "";
      if (!operationId) return error(`Upload response missing operationId: ${JSON.stringify(body)}`);

      try {
        const op = await pollOperation(operationId, auth.apiKey, 60_000);
        if (op.error) return error(`Asset creation failed: ${op.error.message ?? "unknown"}`);
        const assetIdRaw = op.response?.assetId;
        const assetId = typeof assetIdRaw === "string" ? Number(assetIdRaw) : assetIdRaw;
        return success({ assetId, operationId, status: "complete" });
      } catch (err) {
        return error((err as Error).message);
      }
    }

    // Cookie path — Decal only, matches boshyXD's v2.7.0 scoping.
    if (params.assetType !== "Decal") {
      return error(`Cookie auth only supports Decal uploads. Add an Open Cloud apiKey to ${"~/.linkedsword/auth.json"} for other asset types.`);
    }
    if (!auth.cookie) {
      return error("No cookie or apiKey set in auth.json.");
    }
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBytes)]), basename(params.filePath));
    form.append("name", params.name);
    form.append("description", params.description ?? "");
    const url = new URL("https://publish.roblox.com/v1/assets/upload");
    url.searchParams.set("assetType", "Decal");
    if (params.creatorId) url.searchParams.set("groupId", String(params.creatorId));

    const res = await fetch(url, {
      method: "POST",
      headers: { Cookie: `.ROBLOSECURITY=${auth.cookie}` },
      body: form,
    });
    if (!res.ok) {
      return error(`Cookie upload failed: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { assetId?: number; AssetId?: number };
    const assetId = body.assetId ?? body.AssetId;
    return success({ assetId, status: "complete", method: "cookie" });
  });

  // Roblox catalog AssetType IDs — needed because the v2 search endpoint
  // rejects string names. Subset that covers the common buckets.
  const ASSET_TYPE_IDS: Record<string, number> = {
    Model: 10,
    Decal: 13,
    Audio: 3,
    Mesh: 40,
    MeshPart: 40,
    Plugin: 38,
  };
  // The endpoint only accepts these exact Limit values.
  const ALLOWED_LIMITS = [10, 28, 30, 60, 120];

  server.registerTool("search_assets", {
    title: "Search Creator Store assets",
    description: `Search the Roblox Creator Store / Catalog. Public endpoint, no auth required.

Args:
  - query (string)
  - assetType (enum, optional): "Model" | "Decal" | "Audio" | "Mesh" | "Plugin"
  - limit (number, default 10): The endpoint accepts only {10, 28, 30, 60, 120}; other values round up to the next allowed.
  - freeOnly (boolean, default false)

Returns: { count, results: Array<...> }`,
    inputSchema: {
      query: z.string().min(1).describe("Search query"),
      assetType: z.enum(["Model", "Decal", "Audio", "Mesh", "Plugin"]).optional().describe("Filter by asset type"),
      limit: z.number().int().min(1).max(120).default(10).describe("Max results (rounded to {10,28,30,60,120})"),
      freeOnly: z.boolean().default(false).describe("Only free assets"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params) => {
    const effectiveLimit = ALLOWED_LIMITS.find((v) => v >= params.limit) ?? 10;
    const url = new URL("https://catalog.roblox.com/v2/search/items/details");
    url.searchParams.set("Keyword", params.query);
    url.searchParams.set("Limit", String(effectiveLimit));
    if (params.assetType) url.searchParams.set("AssetType", String(ASSET_TYPE_IDS[params.assetType]));
    if (params.freeOnly) {
      url.searchParams.set("MinPrice", "0");
      url.searchParams.set("MaxPrice", "0");
    }
    const res = await fetch(url);
    if (!res.ok) return error(`Catalog search failed: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: unknown[] };
    return success({ count: body.data?.length ?? 0, results: body.data ?? [], effectiveLimit });
  });

  server.registerTool("get_asset_details", {
    title: "Get asset details",
    description: `Fetch metadata for a Roblox asset by id. Public endpoint, no auth required.

Args:
  - assetId (number)

Returns: Raw asset details payload.`,
    inputSchema: {
      assetId: z.number().int().describe("Asset id"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params) => {
    const res = await fetch(`https://economy.roblox.com/v2/assets/${params.assetId}/details`);
    if (!res.ok) return error(`Asset details failed: HTTP ${res.status}`);
    return success(await res.json());
  });

  server.registerTool("get_asset_thumbnail", {
    title: "Get asset thumbnail URL",
    description: `Resolve a thumbnail URL for a Roblox asset.

Args:
  - assetId (number)
  - size (enum, default "420x420"): "150x150" | "420x420"

Returns: { url, state }`,
    inputSchema: {
      assetId: z.number().int().describe("Asset id"),
      size: z.enum(["150x150", "420x420"]).default("420x420").describe("Thumbnail size"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params) => {
    const url = new URL("https://thumbnails.roblox.com/v1/assets");
    url.searchParams.set("assetIds", String(params.assetId));
    url.searchParams.set("size", params.size);
    url.searchParams.set("format", "Png");
    const res = await fetch(url);
    if (!res.ok) return error(`Thumbnail fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ imageUrl?: string; state?: string }> };
    const item = body.data?.[0];
    return success({ url: item?.imageUrl ?? null, state: item?.state ?? "Unknown" });
  });
};
