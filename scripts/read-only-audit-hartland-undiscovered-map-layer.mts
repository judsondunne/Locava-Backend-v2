#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Hartland / default MVP bbox undiscovered map inventory audit.
 * No Firestore writes.
 *
 * Usage (from Locava Backendv2):
 *   npx tsx scripts/read-only-audit-hartland-undiscovered-map-layer.mts
 */
import "dotenv/config";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";
import { tilesForViewport } from "../src/lib/inventory/inventoryTileGrid.js";
import {
  getUnexploredTilesByKeys,
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { routeMapPreviewFromDoc } from "../src/lib/map/unexploredRouteMapGeometry.js";

const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;

function lngInBbox(lng: number): boolean {
  return lng >= bbox.minLng && lng <= bbox.maxLng;
}

function summarizeDoc(data: Record<string, unknown>): Record<string, unknown> {
  const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(data.lat ?? center?.lat ?? (data.location as { lat?: unknown } | undefined)?.lat);
  const lng = Number(
    data.lng ??
      data.long ??
      center?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  const preview = routeMapPreviewFromDoc(data);
  const encodedLen =
    typeof data.encodedPolyline === "string"
      ? data.encodedPolyline.length
      : typeof (data.geometry as { encodedPolyline?: unknown } | undefined)?.encodedPolyline === "string"
        ? String((data.geometry as { encodedPolyline: string }).encodedPolyline).length
        : 0;
  return {
    id: data.id,
    displayName: data.displayName ?? data.title,
    sourceFamily: data.sourceFamily,
    origin: data.origin,
    publicMapEligible: data.publicMapEligible,
    mapReadiness: data.mapReadiness,
    lat,
    lng,
    hasCenter: Boolean(center?.lat != null && center?.lng != null),
    encodedPolylineLen: encodedLen,
    coordinatesPreviewLen: Array.isArray(data.coordinatesPreview) ? data.coordinatesPreview.length : 0,
    geometryPointCount: (data.geometry as { pointCount?: number } | undefined)?.pointCount ?? null,
    geometryStorageMode: (data.geometryStorage as { mode?: string } | undefined)?.mode ?? null,
    renderablePolylinePoints: preview.length,
    importRunId: (data.import as { runId?: string } | undefined)?.runId ?? null,
  };
}

async function main(): Promise<void> {
  const identity = getFirestoreAdminIdentity();
  console.log("=== READ-ONLY Hartland undiscovered map layer audit ===");
  console.log("project:", identity.projectId);
  console.log("bbox:", bbox);
  console.log("label:", INVENTORY_MVP_DEFAULT_VIEWPORT.label);

  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable — set credentials and retry.");
    process.exit(1);
  }

  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 4000, publicOnly: false });
  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: false });

  const spotsPublic = spots.filter((s) => s.publicMapEligible === true);
  const routesPublic = routes.filter((r) => r.publicMapEligible === true);

  const routesWithGeometry = routes.filter((r) => routeMapPreviewFromDoc(r).length >= 2);
  const routesWithoutGeometry = routes.filter((r) => routeMapPreviewFromDoc(r).length < 2);

  const spotsHidden = spots.filter((s) => s.mapReadiness === "hidden");
  const routesHidden = routes.filter((r) => r.mapReadiness === "hidden");

  const tileKeys = tilesForViewport(
    { minLat: bbox.minLat, minLng: bbox.minLng, maxLat: bbox.maxLat, maxLng: bbox.maxLng },
    13,
  ).map((t) => t.tileKey);
  const tiles = await getUnexploredTilesByKeys(tileKeys);
  let tileItemCount = 0;
  let tileRouteCount = 0;
  let tileSpotCount = 0;
  const tileIds = new Set<string>();
  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      tileItemCount += 1;
      if (tileIds.has(item.id)) continue;
      tileIds.add(item.id);
      if (item.kind === "unexplored_route") tileRouteCount += 1;
      else tileSpotCount += 1;
    }
  }

  console.log("\n--- Counts ---");
  console.table({
    spotsTotal: spots.length,
    spotsPublicMapEligible: spotsPublic.length,
    spotsHidden,
    routesTotal: routes.length,
    routesPublicMapEligible: routesPublic.length,
    routesHidden,
    routesRenderableGeometry: routesWithGeometry.length,
    routesMissingGeometry: routesWithoutGeometry.length,
    combinedInventory: spots.length + routes.length,
    unexploredTileDocs: tiles.length,
    unexploredTileItemsRaw: tileItemCount,
    unexploredTileItemsUnique: tileIds.size,
    unexploredTileSpotsUnique: tileSpotCount,
    unexploredTileRoutesUnique: tileRouteCount,
  });

  const byOrigin = new Map<string, number>();
  for (const row of [...spots, ...routes]) {
    const key = String(row.origin ?? row.sourceFamily ?? "unknown");
    byOrigin.set(key, (byOrigin.get(key) ?? 0) + 1);
  }
  console.log("\n--- By origin / sourceFamily ---");
  for (const [k, v] of [...byOrigin.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const exampleSpot = spotsPublic[0] ?? spots[0];
  const exampleRouteGeom = routesWithGeometry[0];
  const exampleRouteNoGeom = routesWithoutGeometry[0];

  console.log("\n--- Example: undiscovered point spot ---");
  console.log(JSON.stringify(exampleSpot ? summarizeDoc(exampleSpot) : null, null, 2));

  console.log("\n--- Example: route WITH renderable geometry ---");
  console.log(JSON.stringify(exampleRouteGeom ? summarizeDoc(exampleRouteGeom) : null, null, 2));

  console.log("\n--- Example: route WITHOUT geometry ---");
  console.log(JSON.stringify(exampleRouteNoGeom ? summarizeDoc(exampleRouteNoGeom) : null, null, 2));

  const likelyFiltered = [...spots, ...routes].filter((row) => {
    const lat = Number((row as { lat?: number }).lat ?? (row.center as { lat?: number } | undefined)?.lat);
    const lng = Number(
      (row as { lng?: number }).lng ??
        (row.center as { lng?: number } | undefined)?.lng,
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
    if (!lngInBbox(lng)) return true;
    if (row.publicMapEligible !== true) return true;
    if (row.mapReadiness === "hidden") return true;
    return false;
  });

  console.log("\n--- Likely filtered from native public map layer ---", likelyFiltered.length);
  if (likelyFiltered[0]) {
    console.log(JSON.stringify(summarizeDoc(likelyFiltered[0] as Record<string, unknown>), null, 2));
  }

  console.log("\nDone (read-only).");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
