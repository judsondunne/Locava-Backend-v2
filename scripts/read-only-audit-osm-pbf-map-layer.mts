#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Audit PBF copier output vs map-layer readiness (no writes).
 */
import "dotenv/config";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { getUnexploredTilesByKeys } from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { tilesForViewport } from "../src/lib/inventory/inventoryTileGrid.js";
import { routeMapPreviewFromDoc } from "../src/lib/map/unexploredRouteMapGeometry.js";
import { normalizeUnexploredLayerDocs } from "../src/services/map/undiscoveredMapLayer.normalizer.js";

const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;

function isPublic(data: Record<string, unknown>): boolean {
  if (data.publicMapEligible !== true) return false;
  const readiness =
    typeof data.mapReadiness === "string" ? data.mapReadiness : null;
  return readiness !== "hidden";
}

async function main(): Promise<void> {
  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 5000, publicOnly: false });
  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: false });
  const publicSpots = spots.filter(isPublic);
  const publicRoutes = routes.filter(isPublic);
  const tileKeys = tilesForViewport({ bbox, zoom: 14 });
  const tiles = await getUnexploredTilesByKeys(tileKeys);
  let tileItemCount = 0;
  for (const t of tiles) {
    const items = (t as { items?: unknown[] }).items;
    if (Array.isArray(items)) tileItemCount += items.length;
  }

  let routesWithGeom = 0;
  for (const r of publicRoutes) {
    const preview = routeMapPreviewFromDoc(r);
    if (preview.length >= 2) routesWithGeom += 1;
  }

  const normalized = await normalizeUnexploredLayerDocs({
    spots: publicSpots,
    routes: publicRoutes,
  });
  const layerPoints = normalized.features.filter((f) => f.featureKind === "point").length;
  const layerRoutes = normalized.features.filter((f) => f.featureKind === "route").length;
  const layerRouteGeom = normalized.features.filter(
    (f) => f.featureKind === "route" && f.routeSummary.routePreviewCoordinates.length >= 2,
  ).length;
  const payloadEstimate = Buffer.byteLength(JSON.stringify(normalized.features), "utf8");

  console.log("=== OSM/PBF map layer read-only audit (Hartland default bbox) ===");
  console.log({
    bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    firestore: {
      spotsTotal: spots.length,
      spotsPublic: publicSpots.length,
      routesTotal: routes.length,
      routesPublic: publicRoutes.length,
      routesWithRenderableGeometry: routesWithGeom,
      tileDocs: tiles.length,
      tileItemCount,
    },
    normalizedLayer: {
      features: normalized.features.length,
      points: layerPoints,
      routes: layerRoutes,
      routeGeometries: layerRouteGeom,
      dropped: normalized.dropped.length,
      payloadEstimateBytes: payloadEstimate,
    },
    notes: [
      "unexploredTiles is a partial cache — direct collection queries are authoritative for durable bbox layer",
      "preview/write counts in admin may differ from publicMapEligible Firestore counts",
      "enable ENABLE_UNDISCOVERED_MAP_LAYER_V1 + GET /v2/map/layers/undiscovered for lightweight native fetch",
    ],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
