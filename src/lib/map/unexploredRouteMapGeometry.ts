import { extractRouteLineCoordinates } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierRouteGeometry.js";
import { getUnexploredRouteGeometryChunks } from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";

export type RouteMapLonLat = { lat: number; lng: number };

const MAP_ROUTE_PREVIEW_POINT_CAP = 2000;

/** Native map polylines use { lat, lon } — keep lng in wire field name for GeoJSON parity. */
export type RouteMapLonLatNative = { lat: number; lon: number };

function lineFromCoordinateFields(data: Record<string, unknown>): RouteMapLonLat[] {
  const candidates = [data.routeCoordinates, data.routeLineCoordinates];
  for (const raw of candidates) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const out: RouteMapLonLat[] = [];
    for (const pt of raw) {
      if (!pt || typeof pt !== "object") continue;
      const row = pt as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
      const lat = Number(row.lat ?? row.latitude);
      const lng = Number(row.lng ?? row.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
    if (out.length >= 2) return out;
  }
  return [];
}

export function routeMapPreviewFromDoc(data: Record<string, unknown>): RouteMapLonLat[] {
  const fromCoordinateFields = lineFromCoordinateFields(data);
  if (fromCoordinateFields.length >= 2) return fromCoordinateFields;

  const geometryBlock = data.geometry as
    | {
        encodedPolyline?: string;
        previewPoints?: Array<{ lat: number; lng: number }>;
        pointCount?: number;
        geometryChunked?: boolean;
      }
    | undefined;
  const line = extractRouteLineCoordinates(
    {
      encodedPolyline:
        typeof data.encodedPolyline === "string"
          ? data.encodedPolyline
          : typeof geometryBlock?.encodedPolyline === "string"
            ? geometryBlock.encodedPolyline
            : undefined,
      coordinatesPreview: data.coordinatesPreview as Array<{ lat: number; lng: number }> | undefined,
      geometry: geometryBlock
        ? {
            pointCount: geometryBlock.pointCount ?? 0,
            geometryChunked: geometryBlock.geometryChunked ?? false,
            encodedPolyline: geometryBlock.encodedPolyline,
            previewPoints: geometryBlock.previewPoints,
          }
        : undefined,
      geometryType: typeof data.geometryType === "string" ? data.geometryType : "LineString",
      distanceMeters: typeof data.distanceMeters === "number" ? data.distanceMeters : 0,
    },
    MAP_ROUTE_PREVIEW_POINT_CAP,
  );
  return line;
}

export async function routeMapPreviewFromDocResolved(
  data: Record<string, unknown>,
): Promise<RouteMapLonLat[]> {
  let line = routeMapPreviewFromDoc(data);
  if (line.length >= 2) return line;

  const storage = data.geometryStorage as { mode?: string } | undefined;
  const routeId = typeof data.id === "string" ? data.id : "";
  if (routeId && storage?.mode === "chunked_subcollection") {
    const chunks = await getUnexploredRouteGeometryChunks(routeId);
    if (chunks.length >= 2) {
      line = chunks.map((c) => ({ lat: c.latitude, lng: c.longitude }));
    }
  }
  return line;
}

export function routeMapPreviewToNativeCoords(points: RouteMapLonLat[]): RouteMapLonLatNative[] {
  return points.map((p) => ({ lat: p.lat, lon: p.lng }));
}

export function buildRouteSummaryForMapMarker(input: {
  data: Record<string, unknown>;
  preview: RouteMapLonLat[];
}): Record<string, unknown> {
  const encodedPolyline =
    typeof input.data.encodedPolyline === "string" && input.data.encodedPolyline.trim()
      ? input.data.encodedPolyline.trim()
      : typeof (input.data.geometry as { encodedPolyline?: unknown } | undefined)?.encodedPolyline === "string"
        ? String((input.data.geometry as { encodedPolyline: string }).encodedPolyline).trim()
        : null;
  return {
    encodedPolyline,
    /** @deprecated prefer routePreviewCoordinates — kept for older native decoders */
    encodedPolylinePreview: encodedPolyline,
    routePreviewCoordinates: routeMapPreviewToNativeCoords(input.preview),
    bbox: input.data.bbox ?? null,
    geometryPointCount:
      typeof (input.data.geometry as { pointCount?: unknown } | undefined)?.pointCount === "number"
        ? (input.data.geometry as { pointCount: number }).pointCount
        : input.preview.length,
    geometryStorageMode:
      typeof (input.data.geometryStorage as { mode?: unknown } | undefined)?.mode === "string"
        ? (input.data.geometryStorage as { mode: string }).mode
        : null,
  };
}
