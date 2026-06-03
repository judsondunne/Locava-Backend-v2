#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Hartland bbox route/trail geometry audit (all sources).
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
import {
  routeMapPreviewFromDoc,
  routeMapPreviewFromDocResolved,
} from "../src/lib/map/unexploredRouteMapGeometry.js";
import { decodePolyline } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierRouteGeometry.js";

const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;
const NATIVE_SESSION_BBOX = {
  minLng: -72.54131506275002,
  minLat: 43.49939380530688,
  maxLng: -72.24131506275,
  maxLat: 43.71939380530688,
};

function inBbox(lat: number, lng: number, b: typeof bbox): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

function boundingBoxOfLine(points: Array<{ lat: number; lng: number }>) {
  if (points.length === 0) return null;
  let minLat = points[0]!.lat;
  let maxLat = points[0]!.lat;
  let minLng = points[0]!.lng;
  let maxLng = points[0]!.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

function isRouteLikeDoc(data: Record<string, unknown>): boolean {
  const kind = String(data.kind ?? "").toLowerCase();
  const itemType = String(data.itemType ?? "").toLowerCase();
  if (kind.includes("route") || itemType.includes("route")) return true;
  const cat = String(data.category ?? data.primaryActivity ?? "").toLowerCase();
  if (cat.includes("trail") || cat.includes("path") || cat.includes("route")) return true;
  if (typeof data.encodedPolyline === "string" && data.encodedPolyline.length > 4) return true;
  if (Array.isArray(data.coordinatesPreview) && data.coordinatesPreview.length >= 2) return true;
  return false;
}

function summarizeRouteDoc(input: {
  collectionPath: string;
  data: Record<string, unknown>;
}): Record<string, unknown> {
  const data = input.data;
  const id = String(data.id ?? "");
  const preview = routeMapPreviewFromDoc(data);
  const center = data.center as { lat?: number; lng?: number } | undefined;
  const lat = Number(data.lat ?? center?.lat ?? (data.location as { lat?: number } | undefined)?.lat);
  const lng = Number(
    data.lng ??
      data.long ??
      center?.lng ??
      (data.location as { lng?: number; long?: number } | undefined)?.lng,
  );
  const enc =
    typeof data.encodedPolyline === "string"
      ? data.encodedPolyline
      : typeof (data.geometry as { encodedPolyline?: string } | undefined)?.encodedPolyline === "string"
        ? String((data.geometry as { encodedPolyline: string }).encodedPolyline)
        : "";
  const encPreview =
    typeof (data as { encodedPolylinePreview?: string }).encodedPolylinePreview === "string"
      ? (data as { encodedPolylinePreview: string }).encodedPolylinePreview
      : "";
  const decodedLineBbox = boundingBoxOfLine(preview);
  return {
    collectionPath: input.collectionPath,
    id,
    title: data.displayName ?? data.title,
    publicMapEligible: data.publicMapEligible,
    origin: data.origin,
    sourceFamily: data.sourceFamily,
    osmId: (data.source as { osmId?: unknown } | undefined)?.osmId ?? null,
    osmType: (data.source as { osmType?: unknown } | undefined)?.osmType ?? null,
    kind: data.kind,
    itemType: data.itemType,
    category: data.category,
    primaryActivity: data.primaryActivity,
    centroidLat: lat,
    centroidLng: lng,
    geometryFieldPaths: [
      data.encodedPolyline != null ? "encodedPolyline" : null,
      data.coordinatesPreview != null ? "coordinatesPreview" : null,
      data.geometry != null ? "geometry" : null,
      data.bbox != null ? "bbox" : null,
    ].filter(Boolean),
    encodedPolylineLen: enc.length,
    encodedPolylinePreviewLen: encPreview.length,
    coordinatesPreviewLen: Array.isArray(data.coordinatesPreview) ? data.coordinatesPreview.length : 0,
    decodedPointCount: preview.length,
    first3: preview.slice(0, 3),
    last3: preview.slice(-3),
    decodedLineBbox,
    insideHartlandBbox: decodedLineBbox
      ? inBbox(
          (decodedLineBbox.minLat + decodedLineBbox.maxLat) / 2,
          (decodedLineBbox.minLng + decodedLineBbox.maxLng) / 2,
          bbox,
        )
      : inBbox(lat, lng, bbox),
    insideNativeSessionBbox: decodedLineBbox
      ? inBbox(
          (decodedLineBbox.minLat + decodedLineBbox.maxLat) / 2,
          (decodedLineBbox.minLng + decodedLineBbox.maxLng) / 2,
          NATIVE_SESSION_BBOX,
        )
      : inBbox(lat, lng, NATIVE_SESSION_BBOX),
  };
}

async function main(): Promise<void> {
  console.log("=== READ-ONLY Hartland undiscovered ROUTES audit ===");
  console.log("identity:", getFirestoreAdminIdentity().projectId);
  console.log("hartland bbox:", bbox);
  console.log("native session bbox:", NATIVE_SESSION_BBOX);

  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("No Firestore client");
    process.exit(1);
  }

  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: false });
  const routesPublic = routes.filter((r) => r.publicMapEligible === true);
  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 4000, publicOnly: false });
  const routeLikeSpots = spots.filter((s) => isRouteLikeDoc(s));

  const tileKeys = tilesForViewport(
    { minLat: bbox.minLat, minLng: bbox.minLng, maxLat: bbox.maxLat, maxLng: bbox.maxLng },
    13,
  ).map((t) => t.tileKey);
  const tiles = await getUnexploredTilesByKeys(tileKeys);
  const tileRoutes: Array<{ tileKey: string; item: Record<string, unknown> }> = [];
  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      if (item.kind === "unexplored_route") {
        tileRoutes.push({
          tileKey: tile.tileKey,
          item: item as unknown as Record<string, unknown>,
        });
      }
    }
  }

  console.log("\n--- Collection counts ---");
  console.table({
    unexploredRoutesTotal: routes.length,
    unexploredRoutesPublic: routesPublic.length,
    routeLikeUnexploredSpots: routeLikeSpots.length,
    unexploredTileRouteItems: tileRoutes.length,
  });

  console.log("\n--- unexploredRoutes docs (public) ---");
  for (const doc of routesPublic) {
    const resolved = await routeMapPreviewFromDocResolved(doc);
    const row = summarizeRouteDoc({ collectionPath: "unexploredRoutes", data: doc });
    row.resolvedPointCountAfterChunks = resolved.length;
    console.log(JSON.stringify(row, null, 2));
  }

  if (routeLikeSpots.length > 0) {
    console.log("\n--- route-like unexploredSpots ---");
    for (const doc of routeLikeSpots.slice(0, 5)) {
      console.log(JSON.stringify(summarizeRouteDoc({ collectionPath: "unexploredSpots", data: doc }), null, 2));
    }
  }

  console.log("\n--- unexploredTiles route items ---");
  for (const { tileKey, item } of tileRoutes) {
    const enc = typeof item.encodedPolyline === "string" ? item.encodedPolyline : "";
    const decodedFromTile = enc ? decodePolyline(enc) : [];
    console.log(
      JSON.stringify(
        {
          tileKey,
          id: item.id,
          displayName: item.displayName,
          encodedPolylineLen: enc.length,
          decodedFromTileTruncatedPolyline: decodedFromTile.length,
          first3: decodedFromTile.slice(0, 3),
        },
        null,
        2,
      ),
    );
  }

  console.log("\n--- Why unexploredFromRoutesQuery=0 but unexploredRoutesCount=2 ---");
  console.log(
    [
      "fetchUnexploredMapMarkerSummaries fills markers from unexploredTiles first, then unexploredSpots query, then unexploredRoutes query only if markers.length < limit.",
      "When the spots path already returned >= limit (or nearly), fromRoutesQuery stays 0 even though tile pass already added route markers (unexploredRoutesCount in map-markers route counts sourceCollection===unexploredRoutes from merged payload, including tile-sourced routes).",
      `For Hartland: routesPublic=${routesPublic.length}, tileRouteItems=${tileRoutes.length}.`,
    ].join("\n"),
  );

  console.log("\nDone (read-only).");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
