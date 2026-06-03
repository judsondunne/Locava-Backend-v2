import type {
  MapLayerFeature,
  MapLayerPointFeature,
  MapLayerRouteFeature,
} from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import { resolveRouteMapAnchorFromDoc } from "../../lib/map/routeMapAnchor.js";
import { readConfidence } from "../../lib/map/undiscoveredMapVisibility.js";
import {
  routeMapPreviewFromDoc,
  routeMapPreviewFromDocResolved,
  type RouteMapLonLat,
} from "../../lib/map/unexploredRouteMapGeometry.js";
import {
  emojiCandidatesFromDoc,
  resolveMapLayerEmoji,
} from "../../lib/map/mapLayerActivityEmoji.js";
import { isUndiscoveredFirestoreMapEligible } from "../../lib/map/undiscoveredFirestoreEligibility.js";
import { resolveRouteMapPresentation } from "../../lib/map/pbfCopierDashboardMapPresentation.js";
const ROUTE_WIRE_POINT_CAP = 500;

export type NormalizeDropReason =
  | "missing_id"
  | "hidden"
  | "not_public"
  | "missing_coords"
  | "invalid_coords"
  | "route_missing_geometry"
  | "duplicate";

export type NormalizeLayerResult = {
  features: MapLayerFeature[];
  dropped: Array<{ id: string; reason: NormalizeDropReason }>;
};

function readActivities(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof data.primaryActivity === "string" && data.primaryActivity.trim()) {
    out.push(data.primaryActivity.trim());
  }
  const activities = data.activities;
  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (typeof a === "string" && a.trim()) out.push(a.trim());
    }
  }
  return [...new Set(out)];
}

function readUpdatedAt(data: Record<string, unknown>): string | number | undefined {
  const audit = data.audit as { updatedAt?: unknown } | undefined;
  if (typeof audit?.updatedAt === "string") return audit.updatedAt;
  if (typeof data.updatedAt === "string" || typeof data.updatedAt === "number") {
    return data.updatedAt;
  }
  return undefined;
}

function isPublicEligible(data: Record<string, unknown>): boolean {
  return isUndiscoveredFirestoreMapEligible(data);
}

function downsampleLine(points: RouteMapLonLat[], maxPoints: number): RouteMapLonLat[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: RouteMapLonLat[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function toWireCoordinates(points: RouteMapLonLat[]): Array<{ latitude: number; longitude: number }> {
  return points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}

function readOsmMeta(data: Record<string, unknown>) {
  const source = data.source as { osmId?: unknown; osmType?: unknown; tags?: unknown } | undefined;
  const tags =
    source?.tags && typeof source.tags === "object"
      ? (source.tags as Record<string, string>)
      : (data.sourceTags as Record<string, string> | undefined);
  const tagsSummary: Record<string, string> = {};
  if (tags && typeof tags === "object") {
    for (const [k, v] of Object.entries(tags).slice(0, 12)) {
      if (typeof v === "string") tagsSummary[k] = v;
    }
  }
  return {
    id: source?.osmId != null ? String(source.osmId) : undefined,
    type: source?.osmType != null ? String(source.osmType) : undefined,
    tagsSummary: Object.keys(tagsSummary).length > 0 ? tagsSummary : undefined,
  };
}

function isRouteLikeSpot(data: Record<string, unknown>): boolean {
  const kind = String(data.kind ?? "").toLowerCase();
  const itemType = String(data.itemType ?? "").toLowerCase();
  if (kind.includes("route") || itemType.includes("route")) return true;
  if (typeof data.encodedPolyline === "string" && data.encodedPolyline.length > 4) return true;
  return false;
}

export function normalizeUnexploredSpotDoc(
  data: Record<string, unknown>,
): { feature: MapLayerPointFeature | null; reason: NormalizeDropReason | null } {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return { feature: null, reason: "missing_id" };
  if (!isPublicEligible(data)) {
    return {
      feature: null,
      reason: data.publicMapEligible !== true ? "not_public" : "hidden",
    };
  }
  if (isRouteLikeSpot(data)) {
    return { feature: null, reason: "missing_coords" };
  }
  const lat = Number(
    data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat,
  );
  const lng = Number(
    data.lng ??
      data.long ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { feature: null, reason: "missing_coords" };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { feature: null, reason: "invalid_coords" };
  }
  const activities = readActivities(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  const feature: MapLayerPointFeature = {
    id,
    layerKind: "undiscovered",
    featureKind: "point",
    source: typeof data.sourceFamily === "string" ? data.sourceFamily : "osm",
    title,
    subtitle: typeof data.subtitle === "string" ? data.subtitle : undefined,
    latitude: lat,
    longitude: lng,
    emoji: resolveMapLayerEmoji(emojiCandidatesFromDoc(data)),
    iconKey: activities[0] ?? undefined,
    category: typeof data.category === "string" ? data.category : activities[0],
    activities,
    publicMapEligible: true,
    osm: readOsmMeta(data),
    detailRef: { type: "unexploredSpot", id },
    updatedAt: readUpdatedAt(data),
  };
  return { feature, reason: null };
}

export async function normalizeUnexploredRouteDoc(
  data: Record<string, unknown>,
): Promise<{ feature: MapLayerRouteFeature | null; reason: NormalizeDropReason | null }> {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return { feature: null, reason: "missing_id" };
  if (!isPublicEligible(data)) {
    return {
      feature: null,
      reason: data.publicMapEligible !== true ? "not_public" : "hidden",
    };
  }
  let preview = routeMapPreviewFromDoc(data);
  let geometrySource = preview.length >= 2 ? "encodedPolyline_or_preview" : "none";
  if (preview.length < 2) {
    preview = await routeMapPreviewFromDocResolved(data);
    geometrySource = preview.length >= 2 ? "geometry_chunks_or_inline" : "none";
  }
  if (preview.length < 2) {
    return { feature: null, reason: "route_missing_geometry" };
  }
  const simplified = downsampleLine(preview, ROUTE_WIRE_POINT_CAP);
  const simplifiedLevel: "low" | "medium" | "full" =
    preview.length > ROUTE_WIRE_POINT_CAP ? "medium" : "full";
  const routeAnchor = resolveRouteMapAnchorFromDoc(data, preview);
  const activities = readActivities(data);
  const confidence = readConfidence(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  const encodedPolyline =
    typeof data.encodedPolyline === "string" && data.encodedPolyline.trim()
      ? data.encodedPolyline.trim()
      : undefined;
  const presentation = resolveRouteMapPresentation(data);
  const feature: MapLayerRouteFeature = {
    id,
    layerKind: "undiscovered",
    featureKind: "route",
    source: typeof data.sourceFamily === "string" ? data.sourceFamily : "osm",
    title,
    subtitle: typeof data.subtitle === "string" ? data.subtitle : undefined,
    centroid: { latitude: routeAnchor.lat, longitude: routeAnchor.lng },
    routeAnchor: {
      latitude: routeAnchor.lat,
      longitude: routeAnchor.lng,
      reason: routeAnchor.reason,
    },
    routeLengthMeters:
      typeof data.distanceMeters === "number" && Number.isFinite(data.distanceMeters)
        ? data.distanceMeters
        : undefined,
    routeConfidence: confidence,
    emoji: resolveMapLayerEmoji(emojiCandidatesFromDoc(data)),
    iconKey: activities[0] ?? undefined,
    category: typeof data.category === "string" ? data.category : activities[0],
    activities,
    publicMapEligible: true,
    routeSummary: {
      pointCount: simplified.length,
      geometrySource,
      routePreviewCoordinates: toWireCoordinates(simplified),
      encodedPolyline,
      simplifiedLevel,
      routeLineColor: presentation.routeLineColor,
      trailLike: presentation.trailLike,
      lineWidth: presentation.lineWidth,
      lineOpacity: presentation.lineOpacity,
      showTrailStartDot: presentation.showTrailStartDot,
    },
    osm: readOsmMeta(data),
    detailRef: { type: "unexploredRoute", id },
    updatedAt: readUpdatedAt(data),
  };
  return { feature, reason: null };
}

export async function normalizeUnexploredLayerDocs(input: {
  spots: Record<string, unknown>[];
  routes: Record<string, unknown>[];
}): Promise<NormalizeLayerResult> {
  const features: MapLayerFeature[] = [];
  const dropped: Array<{ id: string; reason: NormalizeDropReason }> = [];
  const seen = new Set<string>();

  for (const doc of input.spots) {
    const id = typeof doc.id === "string" ? doc.id : "";
    if (isRouteLikeSpot(doc)) {
      const routeNorm = await normalizeUnexploredRouteDoc(doc);
      if (!routeNorm.feature) {
        if (id && routeNorm.reason) dropped.push({ id, reason: routeNorm.reason });
        continue;
      }
      const key = `route:${routeNorm.feature.id}`;
      if (seen.has(key)) {
        dropped.push({ id: routeNorm.feature.id, reason: "duplicate" });
        continue;
      }
      seen.add(key);
      features.push(routeNorm.feature);
      continue;
    }
    const { feature, reason } = normalizeUnexploredSpotDoc(doc);
    if (!feature) {
      if (id && reason) dropped.push({ id, reason });
      continue;
    }
    const key = `spot:${feature.id}`;
    if (seen.has(key)) {
      dropped.push({ id: feature.id, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    features.push(feature);
  }

  for (const doc of input.routes) {
    const id = typeof doc.id === "string" ? doc.id : "";
    const { feature, reason } = await normalizeUnexploredRouteDoc(doc);
    if (!feature) {
      if (id && reason) dropped.push({ id, reason });
      continue;
    }
    const key = `route:${feature.id}`;
    if (seen.has(key)) {
      dropped.push({ id: feature.id, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    features.push(feature);
  }

  return { features, dropped };
}
