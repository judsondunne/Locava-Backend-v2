import { normalizeLocavaName } from "./inventoryLocavaClassifier.js";
import { buildDisplayName } from "./inventoryDisplayNames.js";
import {
  findChildHighlightsForParent,
  isLargeAreaSpot,
  selectPrimaryAnchor,
  type ChildHighlight,
  type PrimaryAnchor,
  type AnchorQuality,
} from "./inventoryDestinationAnchors.js";
import { buildParentAreaIndex, findParentContext, type ParentContext } from "./inventoryParentContext.js";
import type { LocavaInventorySpot } from "./inventoryLocavaTypes.js";
import type { OsmFeatureListItem } from "../openstreetmap/osmFeatureParse.js";

export type PolishedSpotResult = {
  spots: LocavaInventorySpot[];
};

function bboxFromRawFeature(f: OsmFeatureListItem): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  if (f.coordinates.length >= 3) {
    const lats = f.coordinates.map((c) => c.lat);
    const lngs = f.coordinates.map((c) => c.lng);
    return { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
  }
  return { minLat: f.lat, minLng: f.lng, maxLat: f.lat, maxLng: f.lng };
}

export function polishAcceptedSpots(input: {
  spots: LocavaInventorySpot[];
  rawFeatures: OsmFeatureListItem[];
}): PolishedSpotResult {
  const parentAreas = buildParentAreaIndex(input.rawFeatures);
  const featureById = new Map(input.rawFeatures.map((f) => [f.id, f]));
  const localityName =
    parentAreas.find((p) => p.category === "locality")?.name ??
    parentAreas.find((p) => p.category === "locality")?.name ??
    null;

  const withContext: LocavaInventorySpot[] = input.spots.map((spot) => {
    const preferWater = ["beach", "swimming", "swimming_hole", "picnic_site", "access_point"].includes(spot.category);
    const parentContext = findParentContext(spot.lat, spot.lng, parentAreas, {
      preferWater,
      maxNearbyMeters: preferWater ? 800 : 1200,
    });
    const rawName = spot.rawName ?? spot.name;
    const naming = buildDisplayName({
      rawName,
      category: spot.category,
      parentContext,
      nearestLocality: localityName,
      tags: spot.tags,
    });

    const raw = featureById.get(spot.sourceKey);
    const areaCenter = { lat: spot.lat, lng: spot.lng };
    const bbox = raw && raw.coordinates.length >= 3 ? bboxFromRawFeature(raw) : expandPointBbox(spot.lat, spot.lng, spot.category);

    return {
      ...spot,
      rawName: naming.rawName,
      name: naming.displayName,
      displayName: naming.displayName,
      normalizedName: normalizeLocavaName(naming.displayName) ?? naming.displayName.toLowerCase(),
      nameQuality: naming.nameQuality,
      nameWarnings: naming.nameWarnings,
      displayNameGenerated: naming.displayNameGenerated,
      generatedNameReason: naming.generatedNameReason,
      parentContext,
      areaCenter,
      displayCenter: { ...areaCenter },
      bbox,
      anchorQuality: "area_center_fallback" as AnchorQuality,
      childHighlights: [] as ChildHighlight[],
    };
  });

  const childCandidates = withContext.filter((s) => !isLargeAreaSpot(s) || isHighlightCategory(s.category));
  const parents = withContext.filter((s) => isLargeAreaSpot(s) && isParentDestinationCategory(s.category));

  for (const parent of parents) {
    const highlights = findChildHighlightsForParent(parent, childCandidates);
    parent.childHighlights = highlights;
    const { primaryAnchor, anchorQuality, displayCenter } = selectPrimaryAnchor(parent, highlights);
    parent.primaryAnchor = primaryAnchor;
    parent.anchorQuality = anchorQuality;
    parent.displayCenter = displayCenter;
    parent.lat = displayCenter.lat;
    parent.lng = displayCenter.lng;
  }

  for (const spot of withContext) {
    if (spot.displayCenter) continue;
    spot.displayCenter = spot.areaCenter ?? { lat: spot.lat, lng: spot.lng };
  }

  return { spots: withContext };
}

function isParentDestinationCategory(category: string): boolean {
  return ["park", "nature_reserve", "protected_area", "recreation_area", "natural_feature", "water", "wetland", "beach"].includes(
    category
  );
}

function isHighlightCategory(category: string): boolean {
  return ["viewpoint", "waterfall", "swimming", "swimming_hole", "beach", "peak", "hill", "picnic_site", "trailhead"].includes(
    category
  );
}

function expandPointBbox(lat: number, lng: number, category: string): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const delta = ["park", "nature_reserve", "protected_area"].includes(category) ? 0.015 : 0.005;
  return { minLat: lat - delta, minLng: lng - delta, maxLat: lat + delta, maxLng: lng + delta };
}

export type { ParentContext, PrimaryAnchor, ChildHighlight, AnchorQuality };
