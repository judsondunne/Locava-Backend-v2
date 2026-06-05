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

function hasOsmName(tags: Record<string, string>): boolean {
  return Boolean(tags.name?.trim() || tags["name:en"]?.trim());
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
    min = Math.min(min, haversineMeters(lat, lng, a.lat, a.lng));
    min = Math.min(min, haversineMeters(lat, lng, b.lat, b.lng));
  }
  return min;
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
