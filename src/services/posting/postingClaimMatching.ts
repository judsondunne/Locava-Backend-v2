import { haversineMeters } from "../../lib/inventory/inventoryTileGrid.js";
import { nearestPointOnPolyline } from "../../lib/map/routeGeometryMatch.js";
import { extractRouteLineCoordinates } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierRouteGeometry.js";
import type { UnexploredMapMarkerSummary } from "../map/unexploredMapMarkers.service.js";

export type ClaimMatchCandidate = {
  id: string;
  sourceCollection: "unexploredSpots" | "unexploredRoutes";
  itemType: "unexploredSpot" | "unexploredRoute";
  title: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  matchScore: number;
  firstActivity: string | null;
  activities: string[];
  emoji: string | null;
  alreadyCaptured?: boolean;
  capturedByUserId?: string | null;
  matchedBy: "distance" | "distance_activity" | "route_segment" | "name_distance" | "unknown";
};

export const DEFAULT_SPOT_RADIUS_METERS = 75;
export const HARD_MAX_SPOT_RADIUS_METERS = 150;
export const DEFAULT_ROUTE_RADIUS_METERS = 45;
export const HARD_MAX_ROUTE_RADIUS_METERS = 50;
export const MAX_CANDIDATES_EVALUATED = 25;
export const AMBIGUITY_SCORE_DELTA = 0.08;
export const AMBIGUITY_MIN_DISTANCE_GAP_METERS = 20;
export const MIN_ACCEPTABLE_MATCH_SCORE = 0.42;

export function bboxAroundPoint(lat: number, lng: number, radiusMeters: number): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const latDelta = radiusMeters / 111_320;
  const lngScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusMeters / (111_320 * lngScale);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

export function normalizeActivityToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function maxRadiusForMarker(marker: UnexploredMapMarkerSummary): number {
  if (marker.itemType === "unexploredRoute") {
    return DEFAULT_ROUTE_RADIUS_METERS;
  }
  const activity = normalizeActivityToken(marker.firstActivity);
  if (
    activity.includes("beach") ||
    activity.includes("park") ||
    activity.includes("view") ||
    activity.includes("picnic")
  ) {
    return 100;
  }
  if (activity.includes("waterfall") || activity.includes("swim")) {
    return 60;
  }
  return DEFAULT_SPOT_RADIUS_METERS;
}

export function titleSimilarity(a?: string | null, b?: string | null): number {
  const left = String(a ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const right = String(b ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function claimDistanceToMarker(input: {
  marker: UnexploredMapMarkerSummary;
  postLat: number;
  postLng: number;
}): { distanceMeters: number; matchedBy: ClaimMatchCandidate["matchedBy"] } {
  const post = { lat: input.postLat, lng: input.postLng };
  if (input.marker.itemType === "unexploredRoute" && input.marker.routeSummary) {
    const summary = input.marker.routeSummary as Record<string, unknown>;
    const wirePreview = summary.routePreviewCoordinates;
    const previewFromWire = Array.isArray(wirePreview)
      ? wirePreview
          .map((pt) => {
            if (!pt || typeof pt !== "object") return null;
            const row = pt as Record<string, unknown>;
      const lat = Number(row.lat ?? row.latitude);
      const lng = Number(row.lng ?? row.lon ?? row.longitude ?? row.long);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return { lat, lng };
          })
          .filter((p): p is { lat: number; lng: number } => p != null)
      : [];
    const line =
      previewFromWire.length >= 2
        ? previewFromWire
        : extractRouteLineCoordinates({
            encodedPolyline:
              typeof summary.encodedPolyline === "string" ? summary.encodedPolyline : undefined,
            coordinatesPreview: undefined,
            geometry: undefined,
            geometryType: "LineString",
            distanceMeters: 0,
          });
    if (line.length >= 2) {
      const nearest = nearestPointOnPolyline(post, line);
      if (nearest) {
        return { distanceMeters: nearest.distanceMeters, matchedBy: "route_segment" };
      }
    }
  }
  return {
    distanceMeters: haversineMeters(post, { lat: input.marker.lat, lng: input.marker.lng }),
    matchedBy: "distance",
  };
}

export function scoreClaimCandidate(input: {
  marker: UnexploredMapMarkerSummary;
  postLat: number;
  postLng: number;
  postActivities: string[];
  postTitle?: string;
  alreadyCaptured?: boolean;
}): ClaimMatchCandidate | null {
  const { distanceMeters, matchedBy: distanceMatchKind } = claimDistanceToMarker({
    marker: input.marker,
    postLat: input.postLat,
    postLng: input.postLng,
  });
  const maxRadius = Math.min(
    input.marker.itemType === "unexploredRoute" ? HARD_MAX_ROUTE_RADIUS_METERS : HARD_MAX_SPOT_RADIUS_METERS,
    maxRadiusForMarker(input.marker)
  );
  if (distanceMeters > maxRadius) return null;

  const normalizedPostActivities = new Set(input.postActivities.map(normalizeActivityToken).filter(Boolean));
  const markerActivities = [
    input.marker.firstActivity,
    ...(Array.isArray((input.marker as { activities?: string[] }).activities)
      ? ((input.marker as { activities?: string[] }).activities ?? [])
      : [])
  ]
    .map(normalizeActivityToken)
    .filter(Boolean);
  const activityOverlap = markerActivities.some((activity) => normalizedPostActivities.has(activity));
  const distanceScore = Math.max(0, 1 - distanceMeters / maxRadius);
  const titleScore = titleSimilarity(input.postTitle, input.marker.title);
  const activityBoost = activityOverlap ? 0.22 : 0;
  const titleBoost = titleScore * 0.35;
  let matchScore = distanceScore * 0.55 + activityBoost + titleBoost;
  if (input.alreadyCaptured) matchScore *= 0.88;

  let matchedBy: ClaimMatchCandidate["matchedBy"] = distanceMatchKind;
  if (titleScore >= 0.85 && distanceMeters <= maxRadius) matchedBy = "name_distance";
  else if (activityOverlap && distanceMatchKind === "distance") matchedBy = "distance_activity";

  return {
    id: input.marker.id,
    sourceCollection: input.marker.sourceCollection,
    itemType: input.marker.itemType,
    title: input.marker.title,
    lat: input.marker.lat,
    lng: input.marker.lng,
    distanceMeters,
    matchScore,
    firstActivity: input.marker.firstActivity,
    activities: markerActivities,
    emoji: input.marker.emoji,
    alreadyCaptured: input.alreadyCaptured === true,
    capturedByUserId: null,
    matchedBy
  };
}

export function pickBestClaimCandidate(
  scored: ClaimMatchCandidate[],
  options?: { allowAlreadyCaptured?: boolean }
): ClaimMatchCandidate | null {
  const allowAlreadyCaptured = options?.allowAlreadyCaptured === true;
  const eligible = scored
    .filter((row) => row.matchScore >= MIN_ACCEPTABLE_MATCH_SCORE)
    .filter((row) => allowAlreadyCaptured || row.alreadyCaptured !== true)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.distanceMeters - b.distanceMeters;
    });

  if (eligible.length === 0) return null;
  const best = eligible[0]!;
  const second = eligible[1];
  if (
    second &&
    Math.abs(best.matchScore - second.matchScore) <= AMBIGUITY_SCORE_DELTA &&
    Math.abs(best.distanceMeters - second.distanceMeters) >= AMBIGUITY_MIN_DISTANCE_GAP_METERS
  ) {
    return null;
  }
  return best;
}

export function buildCaptureDocId(sourceCollection: string, itemId: string): string {
  return `${sourceCollection}_${itemId}`;
}
