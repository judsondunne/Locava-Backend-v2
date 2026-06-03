#!/usr/bin/env node
/**
 * Audit and backfill unexploredSpots + unexploredRoutes map tile index + unexploredTiles docs.
 * ONLY touches unexploredSpots, unexploredRoutes, and unexploredTiles — never regular posts.
 *
 * Usage:
 *   npx tsx scripts/backfill-unexplored-spot-tiles.mts           # dry-run audit (full collection)
 *   npx tsx scripts/backfill-unexplored-spot-tiles.mts --apply   # write
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import type { UnexploredRoute, UnexploredSpot } from "../src/contracts/entities/osm-national-entities.contract.js";
import { isUndiscoveredFirestoreMapEligible } from "../src/lib/map/undiscoveredFirestoreEligibility.js";
import {
  indexUnexploredSpotsForTiles,
  upsertUnexploredSpotsIntoTileDocs,
} from "../src/services/map/unexploredSpotTileUpsert.service.js";
import {
  indexUnexploredRoutesForTiles,
  upsertUnexploredRoutesIntoTileDocs,
} from "../src/services/map/unexploredRouteTileUpsert.service.js";
import { loadEnv } from "../src/config/env.js";
import { OSM_NATIONAL_PRODUCTION_CONFIRMATION } from "../src/admin/openstreetmap/national/osmNationalWriteGuard.js";

const APPLY = process.argv.includes("--apply");
const PAGE_SIZE = Math.min(500, Math.max(50, Number(process.env.BACKFILL_PAGE_SIZE ?? "500")));
const RUN_ID = `backfill_unexplored_map_tiles_${Date.now()}`;

async function loadAllUnexploredSpots(): Promise<{
  allDocs: number;
  spots: UnexploredSpot[];
  ineligible: number;
  missingCoords: number;
  missingIndexBefore: number;
}> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore client unavailable");

  let allDocs = 0;
  let ineligible = 0;
  let missingCoords = 0;
  let missingIndexBefore = 0;
  const spots: UnexploredSpot[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = db.collection("unexploredSpots").orderBy("__name__").limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      allDocs += 1;
      const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as UnexploredSpot;
      const lat = Number(data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat);
      const lng = Number(
        data.lng ??
          data.long ??
          (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
          (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
      );
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        missingCoords += 1;
        continue;
      }
      if (!isUndiscoveredFirestoreMapEligible(data)) {
        ineligible += 1;
        continue;
      }
      if (!Array.isArray(data.mapTileKeys) || data.mapTileKeys.length === 0) {
        missingIndexBefore += 1;
      }
      spots.push(data);
    }

    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < PAGE_SIZE) break;
    console.log("[backfill-unexplored-map-tiles] spots scan", { allDocs, eligible: spots.length });
  }

  return { allDocs, spots, ineligible, missingCoords, missingIndexBefore };
}

async function loadAllUnexploredRoutes(): Promise<{
  allDocs: number;
  routes: UnexploredRoute[];
  ineligible: number;
  missingCenter: number;
  missingIndexBefore: number;
}> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore client unavailable");

  let allDocs = 0;
  let ineligible = 0;
  let missingCenter = 0;
  let missingIndexBefore = 0;
  const routes: UnexploredRoute[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = db.collection("unexploredRoutes").orderBy("__name__").limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      allDocs += 1;
      const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as UnexploredRoute;
      const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
      const lat = Number(center?.lat);
      const lng = Number(center?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        missingCenter += 1;
        continue;
      }
      if (!isUndiscoveredFirestoreMapEligible(data)) {
        ineligible += 1;
        continue;
      }
      if (!Array.isArray(data.mapTileKeys) || data.mapTileKeys.length === 0) {
        missingIndexBefore += 1;
      }
      routes.push(data);
    }

    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < PAGE_SIZE) break;
    console.log("[backfill-unexplored-map-tiles] routes scan", { allDocs, eligible: routes.length });
  }

  return { allDocs, routes, ineligible, missingCenter, missingIndexBefore };
}

async function countCollection(name: string): Promise<number> {
  const db = getFirestoreSourceClient();
  if (!db) return -1;
  try {
    const agg = await db.collection(name).count().get();
    return agg.data().count;
  } catch {
    return -1;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable");
    process.exit(1);
  }

  const [spotsCount, routesCount, tilesCount] = await Promise.all([
    countCollection("unexploredSpots"),
    countCollection("unexploredRoutes"),
    countCollection("unexploredTiles"),
  ]);

  console.log("[backfill-unexplored-map-tiles] collection counts", {
    unexploredSpots: spotsCount,
    unexploredRoutes: routesCount,
    unexploredTiles: tilesCount,
    apply: APPLY,
    nodeEnv: env.NODE_ENV,
    emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
    project: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "unknown",
  });

  const loadedSpots = await loadAllUnexploredSpots();
  const loadedRoutes = await loadAllUnexploredRoutes();
  const indexedSpots = indexUnexploredSpotsForTiles(loadedSpots.spots);
  const indexedRoutes = indexUnexploredRoutesForTiles(loadedRoutes.routes);

  const tileKeySet = new Set<string>();
  for (const spot of indexedSpots) {
    for (const key of spot.mapTileKeys ?? []) tileKeySet.add(key);
  }
  for (const route of indexedRoutes) {
    for (const key of route.mapTileKeys ?? []) tileKeySet.add(key);
  }

  console.log("[backfill-unexplored-map-tiles] audit", {
    firestoreCountSpots: spotsCount,
    firestoreCountRoutes: routesCount,
    scannedSpotDocs: loadedSpots.allDocs,
    scannedRouteDocs: loadedRoutes.allDocs,
    eligibleSpots: loadedSpots.spots.length,
    eligibleRoutes: loadedRoutes.routes.length,
    spotIneligible: loadedSpots.ineligible,
    routeIneligible: loadedRoutes.ineligible,
    spotMissingCoords: loadedSpots.missingCoords,
    routeMissingCenter: loadedRoutes.missingCenter,
    missingSpotMapTileKeysBefore: loadedSpots.missingIndexBefore,
    missingRouteMapTileKeysBefore: loadedRoutes.missingIndexBefore,
    uniqueTileKeysToUpsert: tileKeySet.size,
    sampleSpots: indexedSpots.slice(0, 3).map((s) => ({
      id: s.id,
      primaryTileKey: s.primaryTileKey,
      mapTileKeys: s.mapTileKeys?.length,
    })),
    sampleRoutes: indexedRoutes.slice(0, 3).map((r) => ({
      id: r.id,
      primaryTileKey: r.primaryTileKey,
      mapTileKeys: r.mapTileKeys?.length,
    })),
  });

  if (!APPLY) {
    console.log("[backfill-unexplored-map-tiles] dry-run complete — pass --apply to write");
    return;
  }

  if (indexedSpots.length === 0 && indexedRoutes.length === 0) {
    console.log("[backfill-unexplored-map-tiles] nothing eligible to write");
    return;
  }

  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const allowProd =
    process.env.ALLOW_UNEXPLORED_SPOT_TILE_BACKFILL === "I_UNDERSTAND_UNEXPLORED_ONLY" &&
    process.env.OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE === "true";
  if (!isEmulator && !allowProd) {
    console.error(
      "Production apply blocked. Set:\n" +
        "  ALLOW_UNEXPLORED_SPOT_TILE_BACKFILL=I_UNDERSTAND_UNEXPLORED_ONLY\n" +
        "  OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE=true",
    );
    process.exit(1);
  }

  const { bulkWriteUnexploredSpots } = await import(
    "../src/repositories/source-of-truth/unexplored-spots-firestore.adapter.js"
  );
  const { bulkWriteUnexploredRoutes } = await import(
    "../src/repositories/source-of-truth/unexplored-routes-firestore.adapter.js"
  );

  const writeTarget = isEmulator ? ("emulator" as const) : ("production" as const);
  const writeOptions = {
    writeTarget,
    operation: "backfill_unexplored_map_tiles",
    confirmProductionWrite: allowProd ? OSM_NATIONAL_PRODUCTION_CONFIRMATION : undefined,
  };

  let spotsWritten = 0;
  const BATCH = 100;
  for (let i = 0; i < indexedSpots.length; i += BATCH) {
    const batch = indexedSpots.slice(i, i + BATCH);
    spotsWritten += await bulkWriteUnexploredSpots(batch, writeOptions);
    console.log("[backfill-unexplored-map-tiles] spots batch", {
      done: Math.min(i + BATCH, indexedSpots.length),
      total: indexedSpots.length,
    });
  }

  let routesWritten = 0;
  for (let i = 0; i < indexedRoutes.length; i += BATCH) {
    const batch = indexedRoutes.slice(i, i + BATCH);
    routesWritten += await bulkWriteUnexploredRoutes(batch, writeOptions);
    console.log("[backfill-unexplored-map-tiles] routes batch", {
      done: Math.min(i + BATCH, indexedRoutes.length),
      total: indexedRoutes.length,
    });
  }

  let tilesWritten = 0;
  const TILE_BATCH = 40;
  for (let i = 0; i < indexedSpots.length; i += TILE_BATCH) {
    const batch = indexedSpots.slice(i, i + TILE_BATCH);
    tilesWritten += await upsertUnexploredSpotsIntoTileDocs({
      spots: batch,
      runId: `${RUN_ID}_spots_${i}`,
      writeOptions,
    });
  }
  for (let i = 0; i < indexedRoutes.length; i += TILE_BATCH) {
    const batch = indexedRoutes.slice(i, i + TILE_BATCH);
    tilesWritten += await upsertUnexploredRoutesIntoTileDocs({
      routes: batch,
      runId: `${RUN_ID}_routes_${i}`,
      writeOptions,
    });
    console.log("[backfill-unexplored-map-tiles] route tiles batch", {
      done: Math.min(i + TILE_BATCH, indexedRoutes.length),
      total: indexedRoutes.length,
      tilesWrittenSoFar: tilesWritten,
    });
  }

  console.log("[backfill-unexplored-map-tiles] apply complete", {
    spotsWritten,
    routesWritten,
    tilesWritten,
    eligibleSpots: indexedSpots.length,
    eligibleRoutes: indexedRoutes.length,
    uniqueTileKeys: tileKeySet.size,
    runId: RUN_ID,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
