import type { FastifyInstance } from "fastify";
import { globalCache } from "../../cache/global-cache.js";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import {
  unexploredSpotTilesBatchContract,
  unexploredSpotTilesContract,
  type UnexploredSpotTileResponse,
} from "../../contracts/surfaces/unexplored-spot-tiles.contract.js";
import { formatTileKey, parseTileKey } from "../../lib/inventory/inventoryTileGrid.js";
import { success } from "../../lib/response.js";
import { recordCacheHit, recordCacheMiss, setRouteName } from "../../observability/request-context.js";
import { fetchUnexploredSpotTile } from "../../services/map/unexploredSpotTiles.service.js";

const env = loadEnv();
const TILE_CACHE_TTL_MS = Math.max(env.MAP_MARKERS_CACHE_TTL_MS, 10 * 60_000);

function tileCacheKey(tileKey: string): string {
  return `map:unexplored_spots_tile:v1:${tileKey}`;
}

async function buildTileResponse(input: {
  z: number;
  x: number;
  y: number;
  cacheHit: boolean;
  cacheSource: "hit" | "miss" | "revalidated_304";
  started: number;
}): Promise<UnexploredSpotTileResponse> {
  const fetched = await fetchUnexploredSpotTile(input);
  const generatedAt = Date.now();
  const version = `unexplored-spot-tile-v1:${fetched.source}`;
  const etag = `"ust:${fetched.tileKey}:${fetched.spots.length}:${version}"`;
  const payload: UnexploredSpotTileResponse = {
    routeName: "map.unexplored_spots.tile.get",
    tileKey: fetched.tileKey,
    z: input.z,
    x: input.x,
    y: input.y,
    spots: fetched.spots,
    count: fetched.spots.length,
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
  payload.diagnostics.payloadBytes = Buffer.byteLength(JSON.stringify(payload.spots), "utf8");
  if (env.NODE_ENV === "development") {
    console.log(
      `[UnexploredTile] ${fetched.tileKey} cache=${input.cacheHit ? "hit" : "miss"} count=${payload.count} bytes=${payload.diagnostics.payloadBytes} ms=${payload.diagnostics.fetchMs}`,
    );
  }
  return payload;
}

export async function registerV2UnexploredSpotTilesRoutes(app: FastifyInstance): Promise<void> {
  app.get(unexploredSpotTilesContract.path, async (request, reply) => {
    setRouteName(unexploredSpotTilesContract.routeName);
    buildViewerContext(request);
    const query = unexploredSpotTilesContract.query.parse(request.query);
    const tileKey = formatTileKey(query.z, query.x, query.y);
    const cacheKey = tileCacheKey(tileKey);
    const started = Date.now();
    const ifNoneMatch = request.headers["if-none-match"];
    const cached = await globalCache.get<UnexploredSpotTileResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      if (ifNoneMatch && String(ifNoneMatch).trim() === cached.etag) {
        reply.header("ETag", cached.etag);
        return reply.status(304).send();
      }
      request.log.info(
        {
          event: "UnexploredTile",
          tileKey,
          cache: "hit",
          count: cached.count,
          bytes: cached.diagnostics.payloadBytes,
          ms: Date.now() - started,
        },
        "unexplored spot tile cache hit",
      );
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

  app.get(unexploredSpotTilesBatchContract.path, async (request, reply) => {
    setRouteName(unexploredSpotTilesBatchContract.routeName);
    buildViewerContext(request);
    const query = unexploredSpotTilesBatchContract.query.parse(request.query);
    const tileKeys = [...new Set(query.tiles.split(",").map((t) => t.trim()).filter(Boolean))].slice(
      0,
      24,
    );
    const started = Date.now();
    let cacheHits = 0;
    let cacheMisses = 0;
    const tiles: Array<Omit<UnexploredSpotTileResponse, "routeName">> = [];

    const payloads = await Promise.all(
      tileKeys.map(async (tileKey) => {
        const parsed = parseTileKey(tileKey);
        if (!parsed) return null;
        const cacheKey = tileCacheKey(tileKey);
        const cached = await globalCache.get<UnexploredSpotTileResponse>(cacheKey);
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
    const version = `unexplored-spot-tiles-batch-v1:${tiles.length}`;
    const etag = `"ustb:${tiles.length}:${generatedAt}"`;
    reply.header("ETag", etag);
    reply.header("Cache-Control", "public, max-age=300");
    return success({
      routeName: "map.unexplored_spots.tiles.get",
      tiles,
      count: tiles.length,
      generatedAt,
      version,
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
