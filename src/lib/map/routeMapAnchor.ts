import { resolveRoutePostAnchor } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierRouteGeometry.js";
import type { RouteMapLonLat } from "./unexploredRouteMapGeometry.js";

export type RouteAnchorReason =
  | "trailhead"
  | "parking"
  | "line_start"
  | "line_end_near_road"
  | "centroid_fallback";

export type RouteMapAnchor = {
  lat: number;
  lng: number;
  reason: RouteAnchorReason;
};

function readLatLng(obj: unknown): { lat: number; lng: number } | null {
  if (!obj || typeof obj !== "object") return null;
  const row = obj as Record<string, unknown>;
  const lat = Number(row.lat ?? row.latitude);
  const lng = Number(row.lng ?? row.longitude ?? row.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Prefer trailhead / parking / line start over geometric centroid for map pins.
 */
export function resolveRouteMapAnchorFromDoc(
  data: Record<string, unknown>,
  line: RouteMapLonLat[],
): RouteMapAnchor {
  const routeMarker = readLatLng(data.routeMarkerCoordinate);
  if (routeMarker) return { ...routeMarker, reason: "line_start" };

  const trailhead = readLatLng(data.selectedTrailhead);
  if (trailhead) return { ...trailhead, reason: "trailhead" };

  const parking = readLatLng(data.selectedParking);
  if (parking) return { ...parking, reason: "parking" };

  if (line.length >= 2) {
    const anchor = resolveRoutePostAnchor(
      {
        center: readLatLng(data.center) ?? readLatLng(data.location) ?? line[0]!,
        encodedPolyline: typeof data.encodedPolyline === "string" ? data.encodedPolyline : undefined,
        coordinatesPreview: line,
        geometry: data.geometry as { encodedPolyline?: string; previewPoints?: RouteMapLonLat[] } | undefined,
        geometryType: typeof data.geometryType === "string" ? data.geometryType : "LineString",
        distanceMeters: typeof data.distanceMeters === "number" ? data.distanceMeters : 0,
      },
      line,
    );
    return { lat: anchor.lat, lng: anchor.lng, reason: "line_start" };
  }

  const center = readLatLng(data.center) ?? readLatLng(data.location);
  if (center) return { ...center, reason: "centroid_fallback" };

  return { lat: 0, lng: 0, reason: "centroid_fallback" };
}
