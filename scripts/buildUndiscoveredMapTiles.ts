#!/usr/bin/env node
/**
 * Precompute undiscovered map tile docs from canonical unexplored spots (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/buildUndiscoveredMapTiles.ts
 *   npx tsx scripts/buildUndiscoveredMapTiles.ts --apply
 *   npx tsx scripts/buildUndiscoveredMapTiles.ts --synthetic 1000000
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { formatTileKey, latLngToTileXY } from "../src/lib/inventory/inventoryTileGrid.js";
import { maxUnexploredSpotsPerTile } from "../src/lib/map/unexploredSpotTileZoom.js";
const APPLY = process.argv.includes("--apply");
const syntheticArg = process.argv.find((a) => a.startsWith("--synthetic"));
const SYNTHETIC_COUNT = syntheticArg
  ? Math.max(0, Number(syntheticArg.split("=")[1] ?? process.argv[process.argv.indexOf("--synthetic") + 1]))
  : 0;
const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576;

type SpotInput = { id: string; lat: number; lng: number; rank?: number };

function generateSyntheticSpots(count: number): SpotInput[] {
  const spots: SpotInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const lat = -85 + (170 * (i % 997)) / 997;
    const lng = -175 + (350 * (i % 991)) / 991;
    spots.push({ id: `synth_${i}`, lat, lng, rank: i % 1000 });
  }
  return spots;
}

function loadSpotsFromJson(path: string): SpotInput[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as { spots?: unknown[] }).spots ?? [];
  return arr
    .map((row) => {
      const r = row as Record<string, unknown>;
      const lat = Number(r.lat);
      const lng = Number(r.lng ?? r.long);
      const id = String(r.id ?? "");
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { id, lat, lng, rank: Number(r.rank ?? 0) };
    })
    .filter((s): s is SpotInput => s != null);
}

function buildTileBuckets(spots: SpotInput[], z: number): Map<string, SpotInput[]> {
  const buckets = new Map<string, SpotInput[]>();
  for (const spot of spots) {
    const { x, y } = latLngToTileXY(spot.lat, spot.lng, z);
    const key = formatTileKey(z, x, y);
    const list = buckets.get(key) ?? [];
    list.push(spot);
    buckets.set(key, list);
  }
  return buckets;
}

function estimateTileJsonBytes(spots: SpotInput[]): number {
  return Buffer.byteLength(
    JSON.stringify(
      spots.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        rank: s.rank ?? 0,
      })),
    ),
    "utf8",
  );
}

async function main(): Promise<void> {
  const jsonPath = process.argv.find((a) => a.endsWith(".json"));
  let spots: SpotInput[] = [];
  if (SYNTHETIC_COUNT > 0) {
    spots = generateSyntheticSpots(SYNTHETIC_COUNT);
    console.log("[buildUndiscoveredMapTiles] synthetic spots", { count: spots.length });
  } else if (jsonPath) {
    spots = loadSpotsFromJson(jsonPath);
    console.log("[buildUndiscoveredMapTiles] loaded spots", { path: jsonPath, count: spots.length });
  } else {
    console.log("[buildUndiscoveredMapTiles] dry-run: pass --synthetic N or a .json export path");
    spots = generateSyntheticSpots(10_000);
  }

  const zoomLevels = [13, 14, 15];
  let totalTiles = 0;
  let maxFeatures = 0;
  let totalFeatures = 0;
  let overLimitTiles = 0;
  let overCapTiles = 0;

  for (const z of zoomLevels) {
    const buckets = buildTileBuckets(spots, z);
    totalTiles += buckets.size;
    for (const [tileKey, items] of buckets) {
      const cap = maxUnexploredSpotsPerTile(z);
      const sorted = [...items].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
      const capped = sorted.slice(0, cap);
      if (items.length > cap) overCapTiles += 1;
      maxFeatures = Math.max(maxFeatures, capped.length);
      totalFeatures += capped.length;
      const bytes = estimateTileJsonBytes(capped);
      if (bytes > FIRESTORE_DOC_LIMIT_BYTES) overLimitTiles += 1;
      if (items.length > cap * 4) {
        console.warn("[buildUndiscoveredMapTiles] dense tile", { tileKey, count: items.length, cap });
      }
    }
  }

  const avgFeatures = totalTiles > 0 ? totalFeatures / totalTiles : 0;
  console.log("[buildUndiscoveredMapTiles] stats", {
    totalSpots: spots.length,
    totalTiles,
    maxFeaturesPerTile: maxFeatures,
    avgFeaturesPerTile: Math.round(avgFeatures * 10) / 10,
    tilesOverFirestoreDocLimit: overLimitTiles,
    tilesOverZoomCap: overCapTiles,
    recommendedSubtiles: overLimitTiles + overCapTiles,
    apply: APPLY,
  });

  if (APPLY) {
    console.log(
      "[buildUndiscoveredMapTiles] use scripts/backfill-unexplored-spot-tiles.mts --apply for production Firestore writes",
    );
  }
}

void main();
