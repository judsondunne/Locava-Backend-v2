/**
 * Spatial helpers for trail-adjacent Locava product rules (peaks, footways, parks).
 */
import { isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import { haversineMeters } from "./pbfCopierV2SupportObjects.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type NamedTrailLine = {
  osmType: string;
  osmId: number;
  displayName: string;
  coordinates: Array<{ lat: number; lng: number }>;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

function hasOsmName(tags: Record<string, string>): boolean {
  return Boolean(tags.name?.trim() || tags["name:en"]?.trim());
}

function pointToSegmentMeters(
  lat: number,
  lng: number,
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return haversineMeters(lat, lng, a.lat, a.lng);
  const t = Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy)));
  const plat = a.lat + t * dy;
  const plng = a.lng + t * dx;
  return haversineMeters(lat, lng, plat, plng);
}

export function minDistanceToPolylineMeters(
  lat: number,
  lng: number,
  coords: Array<{ lat: number; lng: number }> | undefined
): number {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    min = Math.min(min, pointToSegmentMeters(lat, lng, a, b));
  }
  return min;
}

function isPrivateTrailAccess(tags: Record<string, string>): boolean {
  const access = tag(tags, "access");
  if (access === "private" || access === "no") return true;
  if (tag(tags, "foot") === "private" || tag(tags, "motor_vehicle") === "private") return true;
  return false;
}

function isOrdinaryRoadHighway(tags: Record<string, string>): boolean {
  const highway = tag(tags, "highway");
  if (!highway) return false;
  if (["residential", "unclassified", "living_street", "service"].includes(highway)) return true;
  if (highway === "track") {
    const service = tag(tags, "service");
    if (service && ["driveway", "parking_aisle", "alley"].includes(service)) return true;
    const foot = tag(tags, "foot");
    const route = tag(tags, "route");
    if (foot === "designated" || foot === "yes" || foot === "permissive" || route === "hiking") return false;
    if (hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility") || tag(tags, "hiking") === "yes") return false;
    if (hasTag(tags, "piste:type")) return false;
    return true;
  }
  return false;
}

function isPublicTrailGeometry(doc: PbfCopierPreviewDoc, tags: Record<string, string>): boolean {
  if (isPrivateTrailAccess(tags)) return false;
  if (isOrdinaryRoadHighway(tags)) return false;

  const highway = tag(tags, "highway");
  if (highway === "path" || highway === "footway" || highway === "bridleway" || highway === "steps") {
    const footway = tag(tags, "footway");
    if (footway && ["sidewalk", "crossing", "traffic_island", "access_aisle"].includes(footway)) return false;
    return true;
  }

  if (highway === "track") {
    const foot = tag(tags, "foot");
    if (foot === "designated" || foot === "yes" || foot === "permissive" || tag(tags, "hiking") === "yes") {
      return true;
    }
    if (hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) return true;
  }

  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking", "bicycle", "mtb", "ski"].includes(route)) return true;
  if (hasTag(tags, "piste:type")) return true;
  if (doc.warnings?.includes("v2_hiking_trail_merged") || doc.warnings?.includes("v2_unnamed_hiking_trail")) {
    return true;
  }
  if (isHikingTrailPreviewDoc(doc)) return true;

  return false;
}

/** All public trail/route geometries in the batch (named or unnamed) for proximity checks. */
export function collectPublicTrailLines(items: PbfCopierPreviewDoc[]): NamedTrailLine[] {
  const lines: NamedTrailLine[] = [];
  for (const doc of items) {
    const tags = doc.sourceTagSample ?? {};
    if (!isPublicTrailGeometry(doc, tags)) continue;
    const coords = doc.routeLineCoordinates;
    if (!coords || coords.length < 2) continue;
    lines.push({
      osmType: doc.osmType,
      osmId: doc.osmId,
      displayName: doc.displayName || tags.name || tags["name:en"] || "(trail)",
      coordinates: coords,
    });
  }
  return lines;
}

export function minDistanceToPublicTrailMeters(
  lat: number,
  lng: number,
  trails: NamedTrailLine[],
  maxSearchMeters = 500
): number {
  let min = Infinity;
  for (const trail of trails) {
    const d = minDistanceToPolylineMeters(lat, lng, trail.coordinates);
    if (d < min) min = d;
    if (min <= 0) return 0;
  }
  return min > maxSearchMeters ? Infinity : min;
}

export function collectNamedTrailLines(items: PbfCopierPreviewDoc[]): NamedTrailLine[] {
  const lines: NamedTrailLine[] = [];
  for (const doc of items) {
    const tags = doc.sourceTagSample ?? {};
    const named =
      hasOsmName(tags) ||
      doc.warnings?.includes("v2_hiking_trail_merged") ||
      doc.warnings?.includes("v2_unnamed_hiking_trail");
    if (!named) continue;

    const isTrail =
      doc.warnings?.includes("v2_hiking_trail_merged") ||
      isHikingTrailPreviewDoc(doc) ||
      tag(tags, "route") === "hiking" ||
      tag(tags, "route") === "foot" ||
      tag(tags, "route") === "bicycle" ||
      (doc.kind === "unexplored_route" && named);

    if (!isTrail) continue;

    const coords = doc.routeLineCoordinates;
    if (coords && coords.length >= 2) {
      lines.push({
        osmType: doc.osmType,
        osmId: doc.osmId,
        displayName: doc.displayName || tags.name || "(trail)",
        coordinates: coords,
      });
    }
  }
  return lines;
}

export function minDistanceToNamedTrailMeters(
  lat: number,
  lng: number,
  trails: NamedTrailLine[]
): number {
  let min = Infinity;
  for (const trail of trails) {
    min = Math.min(min, minDistanceToPolylineMeters(lat, lng, trail.coordinates));
  }
  return min;
}

export type RecreationAreaPoint = {
  lat: number;
  lng: number;
  name: string;
  tags: Record<string, string>;
  bbox?: PbfCopierPreviewDoc["bbox"];
};

export function collectRecreationAreaPoints(items: PbfCopierPreviewDoc[]): RecreationAreaPoint[] {
  const points: RecreationAreaPoint[] = [];
  for (const doc of items) {
    if (doc.lat == null || doc.lng == null) continue;
    const tags = doc.sourceTagSample ?? {};
    const leisure = tag(tags, "leisure");
    const landuse = tag(tags, "landuse");
    const boundary = tag(tags, "boundary");
    const protect = tag(tags, "protect_class");

    const isPark =
      leisure === "park" ||
      leisure === "nature_reserve" ||
      landuse === "recreation_ground" ||
      boundary === "national_park" ||
      boundary === "protected_area" ||
      protect != null;

    if (!isPark) continue;
    if (!hasOsmName(tags) && !doc.displayName?.trim()) continue;

    points.push({
      lat: doc.lat,
      lng: doc.lng,
      name: doc.displayName || tags.name || "",
      tags,
      bbox: doc.bbox,
    });
  }
  return points;
}

export function bboxDiagonalMeters(bbox: NonNullable<PbfCopierPreviewDoc["bbox"]>): number {
  return haversineMeters(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);
}

const MAX_LARGE_PARK_BBOX_METERS = 1500;

export function isNearRecreationArea(
  lat: number,
  lng: number,
  areas: RecreationAreaPoint[],
  maxPointMeters: number
): boolean {
  for (const area of areas) {
    const pointDist = haversineMeters(lat, lng, area.lat, area.lng);
    if (pointDist <= maxPointMeters) return true;
    if (area.bbox) {
      const diag = bboxDiagonalMeters(area.bbox);
      if (diag > MAX_LARGE_PARK_BBOX_METERS) continue;
      if (
        lat >= area.bbox.minLat &&
        lat <= area.bbox.maxLat &&
        lng >= area.bbox.minLng &&
        lng <= area.bbox.maxLng
      ) {
        return true;
      }
    }
  }
  return false;
}
