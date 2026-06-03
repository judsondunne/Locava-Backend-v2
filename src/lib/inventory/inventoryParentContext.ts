import { haversineMeters } from "./inventoryTileGrid.js";
import type { OsmFeatureListItem } from "../openstreetmap/osmFeatureParse.js";

export type ParentRelation =
  | "inside_area"
  | "nearby_area"
  | "nearby_water"
  | "nearby_trail"
  | "nearest_locality"
  | "none";

export type ParentContext = {
  parentName?: string;
  parentCategory?: string;
  parentSourceKey?: string;
  relation: ParentRelation;
  distanceMeters?: number;
};

export type ParentAreaCandidate = {
  sourceKey: string;
  name: string;
  category: string;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  lat: number;
  lng: number;
  isLarge: boolean;
  tags: Record<string, string>;
};

const PARENT_CATEGORIES = new Set([
  "park",
  "nature_reserve",
  "protected_area",
  "recreation_area",
  "camp_site",
  "attraction",
  "water",
  "wetland",
  "river",
  "locality",
]);

const LARGE_AREA_CATEGORIES = new Set(["park", "nature_reserve", "protected_area", "recreation_area", "water", "wetland"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function bboxFromFeature(f: OsmFeatureListItem): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  if (f.coordinates.length >= 3) {
    const lats = f.coordinates.map((c) => c.lat);
    const lngs = f.coordinates.map((c) => c.lng);
    return { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
  }
  return { minLat: f.lat, minLng: f.lng, maxLat: f.lat, maxLng: f.lng };
}

function bboxContains(
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  lat: number,
  lng: number
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

function inferAreaCategory(f: OsmFeatureListItem): string | null {
  const t = f.tags;
  if (tag(t, "leisure") === "park") return "park";
  if (tag(t, "leisure") === "nature_reserve") return "nature_reserve";
  if (tag(t, "boundary") === "protected_area") return "protected_area";
  if (tag(t, "landuse") === "recreation_ground" || tag(t, "landuse") === "conservation") return "recreation_area";
  if (tag(t, "tourism") === "camp_site") return "camp_site";
  if (tag(t, "tourism") === "attraction") return "attraction";
  if (tag(t, "natural") === "water" || tag(t, "water")) return "water";
  if (tag(t, "natural") === "wetland") return "wetland";
  if (tag(t, "waterway") === "river" && f.hasRealName) return "river";
  if (tag(t, "place") === "locality" || tag(t, "place") === "hamlet" || tag(t, "place") === "village") return "locality";
  return null;
}

function bboxSpanMeters(bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }): number {
  return haversineMeters({ lat: bbox.minLat, lng: bbox.minLng }, { lat: bbox.maxLat, lng: bbox.maxLng });
}

export function buildParentAreaIndex(features: OsmFeatureListItem[]): ParentAreaCandidate[] {
  const out: ParentAreaCandidate[] = [];
  for (const f of features) {
    const category = inferAreaCategory(f);
    if (!category || !PARENT_CATEGORIES.has(category)) continue;
    const name = f.hasRealName ? f.name!.trim() : null;
    if (!name && category !== "locality") continue;
    const bbox = bboxFromFeature(f);
    out.push({
      sourceKey: f.id,
      name: name ?? category,
      category,
      bbox,
      lat: f.lat,
      lng: f.lng,
      isLarge: LARGE_AREA_CATEGORIES.has(category) || bboxSpanMeters(bbox) > 800,
      tags: f.tags,
    });
  }
  return out;
}

export function findParentContext(
  lat: number,
  lng: number,
  parentAreas: ParentAreaCandidate[],
  opts?: { preferWater?: boolean; maxNearbyMeters?: number }
): ParentContext {
  const maxNearby = opts?.maxNearbyMeters ?? 1200;
  let bestInside: ParentAreaCandidate | null = null;
  let bestInsideDist = Infinity;
  let bestWater: ParentAreaCandidate | null = null;
  let bestWaterDist = Infinity;
  let bestNearby: ParentAreaCandidate | null = null;
  let bestNearbyDist = Infinity;
  let bestLocality: ParentAreaCandidate | null = null;
  let bestLocalityDist = Infinity;

  for (const area of parentAreas) {
    const centerDist = haversineMeters({ lat, lng }, { lat: area.lat, lng: area.lng });
    const inside = bboxContains(area.bbox, lat, lng);
    if (inside && area.category !== "locality") {
      const span = bboxSpanMeters(area.bbox);
      const dist = centerDist;
      if (dist < bestInsideDist) {
        bestInsideDist = dist;
        bestInside = area;
      }
      if (area.category === "river" || area.category === "water") {
        if (centerDist < bestWaterDist) {
          bestWaterDist = centerDist;
          bestWater = area;
        }
      }
      continue;
    }
    if (area.category === "river" || area.category === "water") {
      if (centerDist <= maxNearby && centerDist < bestWaterDist) {
        bestWaterDist = centerDist;
        bestWater = area;
      }
    } else if (area.category === "locality") {
      if (centerDist <= 5000 && centerDist < bestLocalityDist) {
        bestLocalityDist = centerDist;
        bestLocality = area;
      }
    } else if (centerDist <= maxNearby && centerDist < bestNearbyDist) {
      bestNearbyDist = centerDist;
      bestNearby = area;
    }
  }

  if (opts?.preferWater && bestWater) {
    return {
      parentName: bestWater.name,
      parentCategory: bestWater.category,
      parentSourceKey: bestWater.sourceKey,
      relation: bboxContains(bestWater.bbox, lat, lng) ? "inside_area" : "nearby_water",
      distanceMeters: Math.round(bestWaterDist),
    };
  }

  if (bestInside) {
    return {
      parentName: bestInside.name,
      parentCategory: bestInside.category,
      parentSourceKey: bestInside.sourceKey,
      relation: "inside_area",
      distanceMeters: Math.round(bestInsideDist),
    };
  }
  if (bestWater) {
    return {
      parentName: bestWater.name,
      parentCategory: bestWater.category,
      parentSourceKey: bestWater.sourceKey,
      relation: "nearby_water",
      distanceMeters: Math.round(bestWaterDist),
    };
  }
  if (bestNearby) {
    return {
      parentName: bestNearby.name,
      parentCategory: bestNearby.category,
      parentSourceKey: bestNearby.sourceKey,
      relation: "nearby_area",
      distanceMeters: Math.round(bestNearbyDist),
    };
  }
  if (bestLocality) {
    return {
      parentName: bestLocality.name,
      parentCategory: bestLocality.category,
      parentSourceKey: bestLocality.sourceKey,
      relation: "nearest_locality",
      distanceMeters: Math.round(bestLocalityDist),
    };
  }
  return { relation: "none" };
}
