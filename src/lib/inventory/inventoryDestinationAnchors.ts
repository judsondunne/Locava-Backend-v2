import { haversineMeters } from "./inventoryTileGrid.js";
import type { LocavaInventorySpot } from "./inventoryLocavaTypes.js";

export type AnchorType =
  | "viewpoint"
  | "waterfall"
  | "swimming"
  | "beach"
  | "peak"
  | "trailhead"
  | "parking"
  | "picnic"
  | "access_point"
  | "area_center";

export type PrimaryAnchor = {
  anchorType: AnchorType;
  name?: string;
  sourceKey?: string;
  lat: number;
  lng: number;
  distanceFromAreaCenterMeters?: number;
  reason: string;
};

export type ChildHighlight = {
  sourceKey: string;
  type: AnchorType;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  distanceFromDisplayCenterMeters?: number;
};

export type AnchorQuality = "exact" | "bbox_match" | "nearby_match" | "area_center_fallback";

const AREA_PARENT_CATEGORIES = new Set([
  "park",
  "nature_reserve",
  "protected_area",
  "recreation_area",
  "natural_feature",
  "beach",
  "water",
  "wetland",
]);

const ANCHOR_PRIORITY: AnchorType[] = [
  "viewpoint",
  "waterfall",
  "swimming",
  "beach",
  "peak",
  "trailhead",
  "parking",
  "picnic",
  "access_point",
  "area_center",
];

function anchorTypeFromSpot(spot: LocavaInventorySpot): AnchorType | null {
  const cat = spot.category;
  if (cat === "viewpoint") return "viewpoint";
  if (cat === "waterfall") return "waterfall";
  if (cat === "swimming" || cat === "swimming_hole") return "swimming";
  if (cat === "beach") return "beach";
  if (cat === "peak" || cat === "hill") return "peak";
  if (cat === "picnic_site") return "picnic";
  if (spot.tags.highway === "trailhead") return "trailhead";
  if (spot.tags.amenity === "parking") return "parking";
  if (cat === "access_point") return "access_point";
  return null;
}

function maxAnchorDistanceMeters(parent: LocavaInventorySpot): number {
  const span =
    haversineMeters({ lat: parent.bbox.minLat, lng: parent.bbox.minLng }, { lat: parent.bbox.maxLat, lng: parent.bbox.maxLng }) / 2;
  if (["nature_reserve", "protected_area", "park", "recreation_area"].includes(parent.category)) {
    return Math.min(2414, Math.max(400, span * 1.5));
  }
  if (["beach", "water", "wetland"].includes(parent.category)) {
    return Math.min(805, Math.max(200, span));
  }
  return 805;
}

function pointInBbox(
  lat: number,
  lng: number,
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

export function findChildHighlightsForParent(
  parent: LocavaInventorySpot,
  candidates: LocavaInventorySpot[]
): ChildHighlight[] {
  const maxDist = maxAnchorDistanceMeters(parent);
  const out: ChildHighlight[] = [];
  for (const c of candidates) {
    if (c.sourceKey === parent.sourceKey) continue;
    const type = anchorTypeFromSpot(c);
    if (!type || type === "area_center") continue;
    const inBbox = pointInBbox(c.lat, c.lng, parent.bbox);
    const dist = haversineMeters({ lat: parent.lat, lng: parent.lng }, { lat: c.lat, lng: c.lng });
    if (!inBbox && dist > maxDist) continue;
    out.push({
      sourceKey: c.sourceKey,
      type,
      name: c.rawName ?? c.name,
      displayName: c.displayName ?? c.name,
      lat: c.lat,
      lng: c.lng,
      distanceFromDisplayCenterMeters: Math.round(dist),
    });
  }
  return out.sort((a, b) => ANCHOR_PRIORITY.indexOf(a.type) - ANCHOR_PRIORITY.indexOf(b.type));
}

export function selectPrimaryAnchor(
  parent: LocavaInventorySpot,
  childHighlights: ChildHighlight[]
): { primaryAnchor: PrimaryAnchor; anchorQuality: AnchorQuality; displayCenter: { lat: number; lng: number } } {
  const areaCenter = { lat: parent.areaCenter?.lat ?? parent.lat, lng: parent.areaCenter?.lng ?? parent.lng };

  for (const anchorType of ANCHOR_PRIORITY) {
    if (anchorType === "area_center") break;
    const match = childHighlights.find((c) => c.type === anchorType);
    if (match) {
      const dist = haversineMeters(areaCenter, { lat: match.lat, lng: match.lng });
      return {
        primaryAnchor: {
          anchorType,
          name: match.displayName,
          sourceKey: match.sourceKey,
          lat: match.lat,
          lng: match.lng,
          distanceFromAreaCenterMeters: Math.round(dist),
          reason: `child_${anchorType}_inside_or_near_parent`,
        },
        anchorQuality: pointInBbox(match.lat, match.lng, parent.bbox) ? "bbox_match" : "nearby_match",
        displayCenter: { lat: match.lat, lng: match.lng },
      };
    }
  }

  return {
    primaryAnchor: {
      anchorType: "area_center",
      lat: areaCenter.lat,
      lng: areaCenter.lng,
      distanceFromAreaCenterMeters: 0,
      reason: "no_child_anchor_found",
    },
    anchorQuality: "area_center_fallback",
    displayCenter: areaCenter,
  };
}

export function isLargeAreaSpot(spot: LocavaInventorySpot): boolean {
  if (AREA_PARENT_CATEGORIES.has(spot.category)) return true;
  const span = haversineMeters({ lat: spot.bbox.minLat, lng: spot.bbox.minLng }, { lat: spot.bbox.maxLat, lng: spot.bbox.maxLng });
  return span > 300 || spot.sourceType === "way" || spot.sourceType === "relation";
}
