#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Compare Firestore Hartland bbox counts vs /v2/map/markers responses.
 *
 * Usage:
 *   LOCAVA_BACKEND_BASE=http://127.0.0.1:8080 npx tsx scripts/read-only-harness-map-markers-undiscovered.mts
 */
import "dotenv/config";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { routeMapPreviewFromDoc } from "../src/lib/map/unexploredRouteMapGeometry.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

const base = process.env.LOCAVA_BACKEND_BASE ?? "http://127.0.0.1:8080";
const viewerId = process.env.VIEWER_UID ?? "anonymous";
const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;

function formatBbox(b: typeof bbox): string {
  return `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`;
}

function innerViewportBboxes(): string[] {
  const { minLat, minLng, maxLat, maxLng } = bbox;
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const qLat = (maxLat - minLat) / 4;
  const qLng = (maxLng - minLng) / 4;
  return [
    formatBbox(bbox),
    `${midLng - qLng},${midLat - qLat},${midLng + qLng},${midLat + qLat}`,
    `${minLng},${minLat},${midLng},${midLat}`,
    `${midLng},${midLat},${maxLng},${maxLat}`,
  ];
}

type MapMarkerRow = {
  id?: string;
  sourceCollection?: string;
  itemType?: string;
  isUnexplored?: boolean;
  isRoute?: boolean;
  routeSummary?: Record<string, unknown> | null;
};

function countEndpointMarkers(markers: MapMarkerRow[]): {
  points: number;
  routes: number;
  routesWithGeometry: number;
} {
  let points = 0;
  let routes = 0;
  let routesWithGeometry = 0;
  for (const m of markers) {
    const isUnexplored =
      m.isUnexplored === true ||
      m.sourceCollection === "unexploredSpots" ||
      m.sourceCollection === "unexploredRoutes";
    if (!isUnexplored) continue;
    const isRoute = m.isRoute === true || m.itemType === "unexploredRoute";
    if (isRoute) {
      routes += 1;
      const summary = m.routeSummary;
      const preview = summary?.routePreviewCoordinates;
      const enc = summary?.encodedPolyline ?? summary?.encodedPolylinePreview;
      const hasGeom =
        (Array.isArray(preview) && preview.length >= 2) ||
        (typeof enc === "string" && enc.length > 8);
      if (hasGeom) routesWithGeometry += 1;
    } else {
      points += 1;
    }
  }
  return { points, routes, routesWithGeometry };
}

async function fetchMapMarkers(bboxStr: string): Promise<MapMarkerRow[]> {
  const params = new URLSearchParams({
    payloadMode: "compact",
    limit: "4000",
    bbox: bboxStr,
    zoom: "13",
  });
  const headers: Record<string, string> = {
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    accept: "application/json",
  };
  const token = process.env.ID_TOKEN ?? process.env.ID_TOKEN_PREVIEW;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/v2/map/markers?${params}`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true) {
    throw new Error(`map.markers failed: http_${res.status} ${JSON.stringify(body?.error ?? body)}`);
  }
  return (body.data?.markers ?? []) as MapMarkerRow[];
}

async function firestoreCounts(): Promise<{
  points: number;
  routes: number;
  routesWithGeometry: number;
}> {
  if (!getFirestoreSourceClient()) {
    return { points: -1, routes: -1, routesWithGeometry: -1 };
  }
  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 4000, publicOnly: true });
  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: true });
  const routesWithGeometry = routes.filter((r) => routeMapPreviewFromDoc(r).length >= 2).length;
  return { points: spots.length, routes: routes.length, routesWithGeometry };
}

async function main(): Promise<void> {
  console.log("=== READ-ONLY map markers undiscovered harness ===");
  console.log("backend:", base);
  console.log("hartland bbox:", formatBbox(bbox));

  const fs = await firestoreCounts();
  console.log("\nFirestore (publicMapEligible, Hartland bbox):");
  console.table(fs);

  const rows: Array<Record<string, string | number>> = [];
  for (const viewportBbox of innerViewportBboxes()) {
    const markers = await fetchMapMarkers(viewportBbox);
    const counts = countEndpointMarkers(markers);
    rows.push({
      viewportBbox: viewportBbox.slice(0, 40) + (viewportBbox.length > 40 ? "…" : ""),
      endpointPoints: counts.points,
      endpointRoutes: counts.routes,
      endpointRoutesWithGeometry: counts.routesWithGeometry,
      firestorePoints: fs.points,
      firestoreRoutes: fs.routes,
      missingVsFirestore:
        fs.points >= 0 ? fs.points + fs.routes - (counts.points + counts.routes) : -1,
      totalEndpointUnexplored: counts.points + counts.routes,
    });
  }

  console.log("\n--- Endpoint vs Firestore (per viewport bbox) ---");
  console.table(rows);

  console.log("\nDone (read-only).");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
