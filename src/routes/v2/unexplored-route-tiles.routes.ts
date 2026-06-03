import type { FastifyInstance } from "fastify";
import { globalCache } from "../../cache/global-cache.js";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import {
  unexploredRouteTilesBatchContract,
  unexploredRouteTilesContract,
  type UnexploredRouteTileResponse,
} from "../../contracts/surfaces/unexplored-route-tiles.contract.js";
import { formatTileKey, parseTileKey } from "../../lib/inventory/inventoryTileGrid.js";
import { success } from "../../lib/response.js";
import { recordCacheHit, recordCacheMiss, setRouteName } from "../../observability/request-context.js";
import { fetchUnexploredRouteTile } from "../../services/map/unexploredRouteTiles.service.js";

const env = loadEnv();
const TILE_CACHE_TTL_MS = Math.max(env.MAP_MARKERS_CACHE_TTL_MS, 10 * 60_000);

function tileCacheKey(tileKey: string): string {
  return `map:unexplored_routes_tile:v1:${tileKey}`;
}

async function buildTileResponse(input: {
  z: number;
  x: number;
  y: number;
  cacheHit: boolean;
  cacheSource: "hit" | "miss" | "revalidated_304";
  started: number;
}): Promise<UnexploredRouteTileResponse> {
  const fetched = await fetchUnexploredRouteTile(input);
  const generatedAt = Date.now();
  const version = `unexplored-route-tile-v1:${fetched.source}`;
  const etag = `"urt:${fetched.tileKey}:${fetched.routes.length}:${version}"`;
  const payload: UnexploredRouteTileResponse = {
    routeName: "map.unexplored_routes.tile.get",
    tileKey: fetched.tileKey,
    z: input.z,
    x: input.x,
    y: input.y,
    routes: fetched.routes,
    count: fetched.routes.length,
    generatedAt,
    version,
    etag,
    diagnostics: {
      cacheHit: input.cacheHit,
      cacheSource: input.cacheSource,
      payloadBytes: 0,
      fetchMs: Date.now() - input.started,
      dbReads: fetched.dbReads,
      source: fetched.source,
      capped: fetched.capped,
      tileLimit: fetched.tileLimit,
    },
  };
  payload.diagnostics.payloadBytes = Buffer.byteLength(JSON.stringify(payload.routes), "utf8");
  if (env.NODE_ENV === "development") {
    console.log(
      `[UnexploredRouteTile] ${fetched.tileKey} cache=${input.cacheHit ? "hit" : "miss"} count=${payload.count} bytes=${payload.diagnostics.payloadBytes} ms=${payload.diagnostics.fetchMs}`,
    );
  }
  return payload;
}

export async function registerV2UnexploredRouteTilesRoutes(app: FastifyInstance): Promise<void> {
  app.get(unexploredRouteTilesContract.path, async (request, reply) => {
    setRouteName(unexploredRouteTilesContract.routeName);
    buildViewerContext(request);
    const query = unexploredRouteTilesContract.query.parse(request.query);
    const tileKey = formatTileKey(query.z, query.x, query.y);
    const cacheKey = tileCacheKey(tileKey);
    const started = Date.now();
    const ifNoneMatch = request.headers["if-none-match"];
    const cached = await globalCache.get<UnexploredRouteTileResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      if (ifNoneMatch && String(ifNoneMatch).trim() === cached.etag) {
        reply.header("ETag", cached.etag);
        return reply.status(304).send();
      }
      reply.header("ETag", cached.etag);
      reply.header("Cache-Control", "public, max-age=300");
      return success({
        ...cached,
        diagnostics: {
          ...cached.diagnostics,
          cacheHit: true,
          cacheSource: "hit",
          fetchMs: Date.now() - started,
        },
      });
    }
    recordCacheMiss();
    const payload = await buildTileResponse({
      z: query.z,
      x: query.x,
      y: query.y,
      cacheHit: false,
      cacheSource: "miss",
      started,
    });
    await globalCache.set(cacheKey, payload, TILE_CACHE_TTL_MS);
    reply.header("ETag", payload.etag);
    reply.header("Cache-Control", "public, max-age=300");
    return success(payload);
  });

  app.get(unexploredRouteTilesBatchContract.path, async (request, reply) => {
    setRouteName(unexploredRouteTilesBatchContract.routeName);
    buildViewerContext(request);
    const query = unexploredRouteTilesBatchContract.query.parse(request.query);
    const tileKeys = [...new Set(query.tiles.split(",").map((t) => t.trim()).filter(Boolean))].slice(
      0,
      24,
    );
    const started = Date.now();
    let cacheHits = 0;
    let cacheMisses = 0;
    const tiles: Array<Omit<UnexploredRouteTileResponse, "routeName">> = [];

    const payloads = await Promise.all(
      tileKeys.map(async (tileKey) => {
        const parsed = parseTileKey(tileKey);
        if (!parsed) return null;
        const cacheKey = tileCacheKey(tileKey);
        const cached = await globalCache.get<UnexploredRouteTileResponse>(cacheKey);
        if (cached) {
          cacheHits += 1;
          return cached;
        }
        cacheMisses += 1;
        const payload = await buildTileResponse({
          z: parsed.z,
          x: parsed.x,
          y: parsed.y,
          cacheHit: false,
          cacheSource: "miss",
          started,
        });
        await globalCache.set(cacheKey, payload, TILE_CACHE_TTL_MS);
        return payload;
      }),
    );
    for (const payload of payloads) {
      if (payload) tiles.push(payload);
    }

    const generatedAt = Date.now();
    const payloadBytes = Buffer.byteLength(JSON.stringify(tiles), "utf8");
    const etag = `"urtb:${tiles.length}:${generatedAt}"`;
    reply.header("ETag", etag);
    reply.header("Cache-Control", "public, max-age=300");
    return success({
      routeName: "map.unexplored_routes.tiles.get",
      tiles,
      count: tiles.length,
      generatedAt,
      version: `unexplored-route-tiles-batch-v1:${tiles.length}`,
      etag,
      diagnostics: {
        cacheHits,
        cacheMisses,
        payloadBytes,
        fetchMs: Date.now() - started,
      },
    });
  });
}
