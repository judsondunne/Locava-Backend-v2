#!/usr/bin/env npx tsx
/**
 * READ-ONLY — route geometry in /v2/map/markers responses (compact vs full).
 */
import "dotenv/config";
import { routeMapPreviewFromDoc } from "../src/lib/map/unexploredRouteMapGeometry.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";

const base = process.env.LOCAVA_BACKEND_BASE ?? "http://127.0.0.1:8080";
const viewerId = process.env.VIEWER_UID ?? "anonymous";

const NATIVE_BBOX = "-72.54131506275002,43.49939380530688,-72.24131506275,43.71939380530688";
const HARTLAND_BBOX = `${INVENTORY_MVP_DEFAULT_VIEWPORT.bbox.minLng},${INVENTORY_MVP_DEFAULT_VIEWPORT.bbox.minLat},${INVENTORY_MVP_DEFAULT_VIEWPORT.bbox.maxLng},${INVENTORY_MVP_DEFAULT_VIEWPORT.bbox.maxLat}`;

type MarkerRow = Record<string, unknown>;

function isRouteLike(m: MarkerRow): boolean {
  return (
    m.isRoute === true ||
    m.itemType === "unexploredRoute" ||
    m.sourceCollection === "unexploredRoutes"
  );
}

function coordCountFromSummary(rs: Record<string, unknown> | null): number {
  if (!rs) return 0;
  const prev = rs.routePreviewCoordinates;
  if (Array.isArray(prev) && prev.length >= 2) return prev.length;
  const enc = rs.encodedPolyline ?? rs.encodedPolylinePreview;
  if (typeof enc === "string" && enc.trim()) {
    return routeMapPreviewFromDoc({ encodedPolyline: enc }).length;
  }
  return 0;
}

function analyzeMarker(m: MarkerRow): Record<string, unknown> {
  const rs = (m.routeSummary as Record<string, unknown> | null) ?? null;
  const prev = rs?.routePreviewCoordinates;
  const first = Array.isArray(prev) && prev[0] && typeof prev[0] === "object" ? (prev[0] as Record<string, unknown>) : null;
  const coordCount = coordCountFromSummary(rs);
  return {
    id: m.id,
    title: m.title,
    isRoute: m.isRoute,
    itemType: m.itemType,
    sourceCollection: m.sourceCollection,
    topLevelKeys: Object.keys(m).sort(),
    hasRouteSummary: rs != null,
    routeSummaryKeys: rs ? Object.keys(rs).sort() : [],
    routePreviewCoordinateCount: Array.isArray(prev) ? prev.length : 0,
    encodedPolylineLen:
      typeof rs?.encodedPolyline === "string"
        ? rs.encodedPolyline.length
        : typeof rs?.encodedPolylinePreview === "string"
          ? rs.encodedPolylinePreview.length
          : 0,
    renderableCoordinateCount: coordCount,
    firstPreviewPoint: first,
    lastPreviewPoint:
      Array.isArray(prev) && prev.length > 0 ? prev[prev.length - 1] : null,
    lat: m.lat,
    lng: m.lng,
  };
}

async function fetchMarkers(label: string, query: string): Promise<MarkerRow[]> {
  const headers: Record<string, string> = {
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    "x-locava-surface": "map_open",
    accept: "application/json",
  };
  const res = await fetch(`${base}/v2/map/markers?${query}`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true) {
    throw new Error(`${label} failed http_${res.status}: ${JSON.stringify(body?.error ?? body)}`);
  }
  return (body.data?.markers ?? []) as MarkerRow[];
}

async function main(): Promise<void> {
  console.log("=== READ-ONLY map markers route payload harness ===");
  console.log("backend:", base);

  const scenarios: Array<{ label: string; query: string }> = [
    {
      label: "native_compact",
      query: `payloadMode=compact&limit=5000&bbox=${NATIVE_BBOX}&zoom=14`,
    },
    {
      label: "native_no_payload_mode",
      query: `limit=5000&bbox=${NATIVE_BBOX}&zoom=14`,
    },
    {
      label: "native_full",
      query: `payloadMode=full&limit=5000&bbox=${NATIVE_BBOX}&zoom=14`,
    },
    {
      label: "hartland_compact",
      query: `payloadMode=compact&limit=5000&bbox=${HARTLAND_BBOX}&zoom=13`,
    },
  ];

  const summaries: Array<Record<string, unknown>> = [];

  for (const s of scenarios) {
    const markers = await fetchMarkers(s.label, s.query);
    const routes = markers.filter(isRouteLike);
    const withGeom = routes.filter((r) => coordCountFromSummary((r.routeSummary as Record<string, unknown>) ?? null) >= 2);
    summaries.push({
      scenario: s.label,
      totalMarkers: markers.length,
      routeLikeCount: routes.length,
      routesWithRenderableGeometry: withGeom.length,
      missingGeometry: routes.length - withGeom.length,
    });
    console.log(`\n--- ${s.label} ---`);
    for (const r of routes) {
      console.log(JSON.stringify(analyzeMarker(r), null, 2));
    }
  }

  console.log("\n--- Summary ---");
  console.table(summaries);

  const compact = summaries.find((r) => r.scenario === "native_compact");
  const noMode = summaries.find((r) => r.scenario === "native_no_payload_mode");
  if (
    typeof compact?.routeLikeCount === "number" &&
    compact.routeLikeCount > 0 &&
    compact.routesWithRenderableGeometry === 0
  ) {
    console.error("\nFAIL: compact has routes but none with renderable geometry");
    process.exit(2);
  }
  if (
    typeof compact?.routesWithRenderableGeometry === "number" &&
    typeof noMode?.routesWithRenderableGeometry === "number" &&
    compact.routesWithRenderableGeometry < (noMode.routesWithRenderableGeometry as number)
  ) {
    console.error("\nFAIL: compact lost geometry vs no payloadMode");
    process.exit(2);
  }

  console.log("\nDone (read-only).");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
