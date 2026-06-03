#!/usr/bin/env node
/**
 * Simulates a user opening the map over Hartland VT — fetches spot + route tiles in parallel.
 *
 * Usage:
 *   npx tsx scripts/simulate-map-open-tile-load.mts
 *   BACKEND_URL=http://127.0.0.1:8080 npx tsx scripts/simulate-map-open-tile-load.mts
 */
import "dotenv/config";
import { tilesForBboxAtZoom } from "../src/lib/inventory/inventoryTileGrid.js";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

function unexploredSpotDataZoomFromLatitudeDelta(latitudeDelta: number): number | null {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return null;
  const z = Math.max(1, Math.min(20, Math.round(Math.log2(360 / latitudeDelta))));
  if (z <= 10) return null;
  if (z <= 12) return 11;
  if (z <= 15) return z;
  return 15;
}

/** Hartland / Ascutney default viewport (matches undiscovered audit bbox). */
const REGION = {
  latitude: 43.441,
  longitude: -72.458,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

function regionToBbox(region: typeof REGION): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} {
  const latHalf = region.latitudeDelta / 2;
  const lngHalf = region.longitudeDelta / 2;
  return {
    minLat: region.latitude - latHalf,
    minLng: region.longitude - lngHalf,
    maxLat: region.latitude + latHalf,
    maxLng: region.longitude + lngHalf,
  };
}

function visibleTiles(region: typeof REGION): string[] {
  const dataZoom = unexploredSpotDataZoomFromLatitudeDelta(
    Math.max(region.latitudeDelta, region.longitudeDelta),
  );
  if (dataZoom == null) return [];
  const bbox = regionToBbox(region);
  const visible = tilesForBboxAtZoom(bbox, dataZoom);
  const seen = new Set(visible.map((t) => t.tileKey));
  const out = [...visible];
  for (const tile of visible) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const key = `${dataZoom}/${tile.x + dx}/${tile.y + dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ z: dataZoom, x: tile.x + dx, y: tile.y + dy, tileKey: key });
      }
    }
  }
  return out.map((t) => t.tileKey).slice(0, 24);
}

async function fetchBatch(path: string, tileKeys: string[]): Promise<{
  ms: number;
  bytes: number;
  count: number;
  diagnostics: Record<string, unknown> | null;
}> {
  const started = Date.now();
  const url = `${BACKEND_URL}${path}?tiles=${encodeURIComponent(tileKeys.join(","))}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-viewer-id": "simulate-map-open",
      "x-viewer-roles": "internal",
      "x-locava-surface": "map_open",
    },
  });
  const text = await res.text();
  const ms = Date.now() - started;
  const bytes = Buffer.byteLength(text, "utf8");
  let count = 0;
  let diagnostics: Record<string, unknown> | null = null;
  try {
    const body = JSON.parse(text) as { ok?: boolean; data?: Record<string, unknown> };
    if (body.ok && body.data) {
      diagnostics = (body.data.diagnostics as Record<string, unknown>) ?? null;
      const tiles = body.data.tiles as Array<{ spots?: unknown[]; routes?: unknown[] }> | undefined;
      if (Array.isArray(tiles)) {
        count = tiles.reduce((sum, t) => {
          const spots = Array.isArray(t.spots) ? t.spots.length : 0;
          const routes = Array.isArray(t.routes) ? t.routes.length : 0;
          return sum + spots + routes;
        }, 0);
      }
    }
  } catch {
    // ignore parse errors
  }
  if (!res.ok) {
    throw new Error(`${path} http_${res.status} ${text.slice(0, 200)}`);
  }
  return { ms, bytes, count, diagnostics };
}

async function main(): Promise<void> {
  const tileKeys = visibleTiles(REGION);
  console.log("[simulate-map-open] config", {
    backend: BACKEND_URL,
    region: REGION,
    tileCount: tileKeys.length,
    tiles: tileKeys,
  });

  const coldStarted = Date.now();
  const [spotsCold, routesCold] = await Promise.all([
    fetchBatch("/v2/map/unexplored-spots/tiles", tileKeys),
    fetchBatch("/v2/map/unexplored-routes/tiles", tileKeys),
  ]);
  const coldParallelMs = Date.now() - coldStarted;

  const warmStarted = Date.now();
  const [spotsWarm, routesWarm] = await Promise.all([
    fetchBatch("/v2/map/unexplored-spots/tiles", tileKeys),
    fetchBatch("/v2/map/unexplored-routes/tiles", tileKeys),
  ]);
  const warmParallelMs = Date.now() - warmStarted;

  console.log("[simulate-map-open] cold (parallel spots + routes)", {
    parallelMs: coldParallelMs,
    spotsMs: spotsCold.ms,
    routesMs: routesCold.ms,
    spotsBytes: spotsCold.bytes,
    routesBytes: routesCold.bytes,
    spotMarkers: spotsCold.count,
    routeMarkers: routesCold.count,
    spotsDiagnostics: spotsCold.diagnostics,
    routesDiagnostics: routesCold.diagnostics,
  });

  console.log("[simulate-map-open] warm cache (parallel)", {
    parallelMs: warmParallelMs,
    spotsMs: spotsWarm.ms,
    routesMs: routesWarm.ms,
    spotsBytes: spotsWarm.bytes,
    routesBytes: routesWarm.bytes,
    spotMarkers: spotsWarm.count,
    routeMarkers: routesWarm.count,
  });

  const totalColdBytes = spotsCold.bytes + routesCold.bytes;
  const totalWarmBytes = spotsWarm.bytes + routesWarm.bytes;
  console.log("[simulate-map-open] summary", {
    tileKeys: tileKeys.length,
    coldParallelMs: coldParallelMs,
    warmParallelMs: warmParallelMs,
    coldTotalBytes: totalColdBytes,
    warmTotalBytes: totalWarmBytes,
    verdict:
      coldParallelMs < 2000
        ? "FAST — map-open tile load under 2s"
        : coldParallelMs < 5000
          ? "OK — acceptable for first paint"
          : "SLOW — investigate tile cache / Firestore reads",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
