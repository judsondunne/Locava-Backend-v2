import { haversineMeters } from "./inventoryTileGrid.js";
import type { OsmFeatureListItem } from "../openstreetmap/osmFeatureParse.js";

/** Viewpoint within this distance suppresses a separate bare peak/hill spot. */
export const VIEWPOINT_SUPPRESSES_HILL_PEAK_METERS = 80;

/** Hiking trail geometry within this distance qualifies a bare peak/hill. */
export const HIKING_TRAIL_NEAR_HILL_PEAK_METERS = 200;

/** Sample interval along trail polylines when indexing. */
const TRAIL_SAMPLE_INTERVAL_METERS = 75;

/** ~200 m grid cells for spatial lookups. */
const GRID_CELL_DEG = 0.0018;

export type HillPeakSpatialGateResult =
  | { accept: true; reason: "near_hiking_trail" }
  | { accept: false; reason: "suppressed_by_nearby_viewpoint" | "no_hiking_trail_or_viewpoint" };

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function isOsmViewpointTags(tags: Record<string, string>): boolean {
  return tag(tags, "tourism") === "viewpoint";
}

/** Observation deck / interpretive platform (man_made=tower + tower:type=observation). */
export function isOsmObservationTowerTags(tags: Record<string, string>): boolean {
  const manMade = tag(tags, "man_made");
  if (manMade === "observation_tower") return true;
  if (manMade !== "tower") return false;
  const towerType = tag(tags, "tower:type") ?? tag(tags, "tower_type");
  return towerType === "observation" || towerType === "watchtower";
}

export function isOsmBareHillOrPeakTags(tags: Record<string, string>): boolean {
  const natural = tag(tags, "natural");
  if (natural !== "hill" && natural !== "peak") return false;
  if (isOsmViewpointTags(tags)) return false;
  return true;
}

/** On-element trail/summit signals (no geometry required). */
export function hillOrPeakHasOnTagTrailContext(tags: Record<string, string>): boolean {
  if (isOsmViewpointTags(tags)) return true;
  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking"].includes(route)) return true;
  if (tag(tags, "hiking") === "yes" || tag(tags, "hiking") === "designated") return true;
  if (tag(tags, "foot") === "yes" || tag(tags, "foot") === "designated") return true;
  if (tag(tags, "sac_scale")) return true;
  if (tag(tags, "trail_visibility")) return true;
  if (tag(tags, "summit") === "yes") return true;
  if (tag(tags, "mountain_pass") === "yes") return true;
  return false;
}

function isSidewalkFootway(tags: Record<string, string>): boolean {
  const footway = tag(tags, "footway");
  if (footway && ["sidewalk", "crossing", "traffic_island", "access_aisle"].includes(footway)) {
    return true;
  }
  const highway = tag(tags, "highway");
  return highway === "crossing" || highway === "traffic_isle";
}

function isPrivateTrailAccess(tags: Record<string, string>): boolean {
  const access = tag(tags, "access");
  return access === "private" || access === "no" || tag(tags, "private") === "yes";
}

export function isOsmHikingTrailTags(tags: Record<string, string>): boolean {
  if (isPrivateTrailAccess(tags)) return false;
  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking"].includes(route)) return true;
  const highway = tag(tags, "highway");
  if (highway === "path") return true;
  if (highway === "footway" && !isSidewalkFootway(tags)) return true;
  if (highway === "track" || highway === "bridleway" || highway === "steps") return true;
  if (tag(tags, "hiking") === "yes" || tag(tags, "hiking") === "designated") return true;
  if (tag(tags, "sac_scale")) return true;
  return false;
}

function gridKey(lat: number, lng: number): string {
  const gx = Math.floor(lat / GRID_CELL_DEG);
  const gy = Math.floor(lng / GRID_CELL_DEG);
  return `${gx}:${gy}`;
}

function sampleTrailPoints(coords: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [coords[0]!];
  const out: Array<{ lat: number; lng: number }> = [coords[0]!];
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1]!;
    const cur = coords[i]!;
    const segLen = haversineMeters(prev, cur);
    if (segLen < TRAIL_SAMPLE_INTERVAL_METERS) {
      out.push(cur);
      continue;
    }
    const steps = Math.max(1, Math.ceil(segLen / TRAIL_SAMPLE_INTERVAL_METERS));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push({
        lat: prev.lat + (cur.lat - prev.lat) * t,
        lng: prev.lng + (cur.lng - prev.lng) * t,
      });
    }
  }
  return out;
}

export type HillPeakTrailSpatialIndex = {
  trailCells: Map<string, Array<{ lat: number; lng: number }>>;
  viewpoints: Array<{ lat: number; lng: number }>;
};

export function createHillPeakTrailSpatialIndex(): HillPeakTrailSpatialIndex {
  return { trailCells: new Map(), viewpoints: [] };
}

function addTrailPoint(index: HillPeakTrailSpatialIndex, lat: number, lng: number): void {
  const key = gridKey(lat, lng);
  const bucket = index.trailCells.get(key);
  if (bucket) bucket.push({ lat, lng });
  else index.trailCells.set(key, [{ lat, lng }]);
}

export function registerHikingTrailOnSpatialIndex(
  index: HillPeakTrailSpatialIndex,
  feature: Pick<OsmFeatureListItem, "coordinates" | "lat" | "lng" | "geometryKind" | "tags">
): void {
  if (!isOsmHikingTrailTags(feature.tags)) return;
  if (feature.geometryKind === "line" && feature.coordinates.length >= 2) {
    for (const p of sampleTrailPoints(feature.coordinates)) {
      addTrailPoint(index, p.lat, p.lng);
    }
    return;
  }
  if (Number.isFinite(feature.lat) && Number.isFinite(feature.lng)) {
    addTrailPoint(index, feature.lat, feature.lng);
  }
}

export function registerViewpointOnSpatialIndex(
  index: HillPeakTrailSpatialIndex,
  lat: number,
  lng: number
): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  index.viewpoints.push({ lat, lng });
}

function nearestInRadius(
  origin: { lat: number; lng: number },
  points: Array<{ lat: number; lng: number }>,
  radiusMeters: number
): boolean {
  for (const p of points) {
    if (haversineMeters(origin, p) <= radiusMeters) return true;
  }
  return false;
}

function trailPointsNear(index: HillPeakTrailSpatialIndex, lat: number, lng: number, radiusMeters: number): boolean {
  const gx = Math.floor(lat / GRID_CELL_DEG);
  const gy = Math.floor(lng / GRID_CELL_DEG);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = index.trailCells.get(`${gx + dx}:${gy + dy}`);
      if (!bucket) continue;
      if (nearestInRadius({ lat, lng }, bucket, radiusMeters)) return true;
    }
  }
  return false;
}

export function evaluateHillPeakSpatialGate(
  index: HillPeakTrailSpatialIndex,
  lat: number,
  lng: number
): HillPeakSpatialGateResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { accept: false, reason: "no_hiking_trail_or_viewpoint" };
  }
  if (nearestInRadius({ lat, lng }, index.viewpoints, VIEWPOINT_SUPPRESSES_HILL_PEAK_METERS)) {
    return { accept: false, reason: "suppressed_by_nearby_viewpoint" };
  }
  if (trailPointsNear(index, lat, lng, HIKING_TRAIL_NEAR_HILL_PEAK_METERS)) {
    return { accept: true, reason: "near_hiking_trail" };
  }
  return { accept: false, reason: "no_hiking_trail_or_viewpoint" };
}
