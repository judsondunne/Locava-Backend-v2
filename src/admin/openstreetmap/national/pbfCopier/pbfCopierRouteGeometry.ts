import type { UnexploredRoute } from "../../../../contracts/entities/osm-national-entities.contract.js";

export type RouteLinePoint = { lat: number; lng: number };

const PREVIEW_LINE_POINT_CAP = 2000;

function decodeSigned(index: { i: number }, encoded: string): number {
  let result = 0;
  let shift = 0;
  let b: number;
  do {
    b = encoded.charCodeAt(index.i++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);
  return result & 1 ? ~(result >> 1) : result >> 1;
}

/** Decode a Google-encoded polyline into lat/lng points. */
export function decodePolyline(encoded: string): RouteLinePoint[] {
  if (!encoded?.trim()) return [];
  const points: RouteLinePoint[] = [];
  const index = { i: 0 };
  let lat = 0;
  let lng = 0;
  while (index.i < encoded.length) {
    lat += decodeSigned(index, encoded);
    lng += decodeSigned(index, encoded);
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function downsampleLine(points: RouteLinePoint[], maxPoints: number): RouteLinePoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: RouteLinePoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Resolve displayable trail line coordinates for preview/map (from polyline or preview points). */
export function extractRouteLineCoordinates(
  route: Pick<
    UnexploredRoute,
    "encodedPolyline" | "coordinatesPreview" | "geometry" | "geometryType" | "distanceMeters"
  >,
  maxPoints = PREVIEW_LINE_POINT_CAP
): RouteLinePoint[] {
  const polyline = route.encodedPolyline ?? route.geometry?.encodedPolyline;
  if (polyline) {
    const decoded = decodePolyline(polyline);
    if (decoded.length >= 2) return downsampleLine(decoded, maxPoints);
  }
  const preview = route.coordinatesPreview ?? route.geometry?.previewPoints;
  if (preview && preview.length >= 2) return downsampleLine(preview, maxPoints);
  return [];
}

export function routeHasDisplayableGeometry(
  route: Pick<
    UnexploredRoute,
    "encodedPolyline" | "coordinatesPreview" | "geometry" | "distanceMeters" | "geometryType"
  >
): boolean {
  return extractRouteLineCoordinates(route, 2).length >= 2;
}

function readAccessPoint(
  value: unknown
): RouteLinePoint | null {
  if (!value || typeof value !== "object") return null;
  const o = value as { lat?: number; lng?: number };
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
  return { lat: o.lat!, lng: o.lng! };
}

/** Post/map emoji anchor — parking near trailhead, then trailhead, then trail start (not junction). */
export function resolveRoutePostAnchor(
  route: Pick<
    UnexploredRoute,
    | "center"
    | "encodedPolyline"
    | "coordinatesPreview"
    | "geometry"
    | "geometryType"
    | "distanceMeters"
    | "selectedTrailhead"
    | "selectedParking"
  >,
  routeLineCoordinates?: RouteLinePoint[]
): RouteLinePoint {
  const parking = readAccessPoint(route.selectedParking);
  if (parking) return parking;
  const trailhead = readAccessPoint(route.selectedTrailhead);
  if (trailhead) return trailhead;
  const line = routeLineCoordinates ?? extractRouteLineCoordinates(route, 2);
  if (line.length > 0) return line[0]!;
  return route.center;
}
