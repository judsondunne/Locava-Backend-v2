import { haversineMeters } from "./inventoryTileGrid.js";
import { normalizeLocavaName } from "./inventoryLocavaClassifier.js";
import type {
  LocavaClassificationResult,
  LocavaDedupeResult,
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "./inventoryLocavaTypes.js";

const NEAR_DUPLICATE_METERS = 75;

function spotGeometryRank(spot: LocavaInventorySpot): number {
  if (spot.sourceType === "node") return 3;
  if (spot.sourceType === "way" && spot.tags.building) return 2;
  if (spot.sourceType === "relation") return 1;
  return 0;
}

function routeGeometryRank(route: LocavaInventoryRoute): number {
  if (route.sourceType === "relation") return 3;
  if (route.tags.route) return 2;
  return 1;
}

export function buildLocavaInventorySpot(
  classification: LocavaClassificationResult,
  feature: {
    lat: number;
    lng: number;
    tags: Record<string, string>;
    sourceType: string;
    sourceId: string;
  }
): LocavaInventorySpot {
  const name = classification.name ?? classification.primaryCategory ?? "Unnamed spot";
  const normalizedName = classification.normalizedName ?? normalizeLocavaName(name) ?? name.toLowerCase();
  const category = classification.primaryCategory ?? "natural_feature";
  const bbox = {
    minLat: feature.lat,
    minLng: feature.lng,
    maxLat: feature.lat,
    maxLng: feature.lng,
  };
  return {
    id: `spot:${classification.sourceKey}`,
    kind: "inventory_spot",
    name,
    normalizedName,
    category,
    categories: [category, ...classification.secondaryCategories],
    activities: classification.activities,
    lat: feature.lat,
    lng: feature.lng,
    bbox,
    source: "openstreetmap",
    sourceType: feature.sourceType,
    sourceId: feature.sourceId,
    sourceKey: classification.sourceKey,
    hasMedia: false,
    status: "active",
    locavaScore: classification.locavaScore,
    confidence: classification.confidence,
    displayPriority: classification.displayPriority === "hidden" ? "low" : classification.displayPriority,
    showAtZoom: classification.showAtZoom,
    classificationReason: classification.reason,
    tagSignals: classification.tagSignals,
    negativeSignals: classification.negativeSignals,
    rejectionReason: null,
    tags: feature.tags,
    attribution: { provider: "openstreetmap", license: "ODbL" },
  };
}

export function dedupeLocavaInventory(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
}): LocavaDedupeResult {
  const duplicateDiagnostics: LocavaDedupeResult["duplicateDiagnostics"] = [];
  let duplicatesSuppressed = 0;

  const spotsByKey = new Map<string, LocavaInventorySpot>();
  for (const spot of input.spots) {
    spotsByKey.set(spot.sourceKey, spot);
  }
  const uniqueSpots = [...spotsByKey.values()];

  const keptSpots: LocavaInventorySpot[] = [];
  for (const spot of uniqueSpots.sort((a, b) => b.locavaScore - a.locavaScore)) {
    const dup = keptSpots.find((existing) => {
      if (existing.category !== spot.category) return false;
      const aName = existing.normalizedName;
      const bName = spot.normalizedName;
      if (!aName || !bName || aName !== bName) return false;
      return haversineMeters({ lat: existing.lat, lng: existing.lng }, { lat: spot.lat, lng: spot.lng }) <= NEAR_DUPLICATE_METERS;
    });
    if (dup) {
      duplicatesSuppressed += 1;
      const keepExisting = spotGeometryRank(dup) >= spotGeometryRank(spot) && dup.locavaScore >= spot.locavaScore;
      if (keepExisting) {
        duplicateDiagnostics.push({ kept: dup.sourceKey, suppressed: spot.sourceKey, reason: "near_duplicate_spot" });
        continue;
      }
      const idx = keptSpots.indexOf(dup);
      keptSpots[idx] = spot;
      duplicateDiagnostics.push({ kept: spot.sourceKey, suppressed: dup.sourceKey, reason: "near_duplicate_spot_replaced" });
      continue;
    }
    keptSpots.push(spot);
  }

  const routesByKey = new Map<string, LocavaInventoryRoute>();
  for (const route of input.routes) {
    routesByKey.set(route.sourceKey, route);
  }
  const uniqueRoutes = [...routesByKey.values()];
  const relationRoutes = uniqueRoutes.filter((r) => r.sourceType === "relation" || r.tags.route);
  const keptRoutes: LocavaInventoryRoute[] = [];

  for (const route of uniqueRoutes.sort((a, b) => b.locavaScore - a.locavaScore)) {
    const dup = keptRoutes.find((existing) => {
      if (existing.normalizedName !== route.normalizedName) return false;
      return haversineMeters(existing.center, route.center) <= NEAR_DUPLICATE_METERS;
    });
    if (dup) {
      duplicatesSuppressed += 1;
      duplicateDiagnostics.push({ kept: dup.sourceKey, suppressed: route.sourceKey, reason: "near_duplicate_route" });
      continue;
    }
    if (route.sourceType === "way" && route.tags.route == null) {
      const covered = relationRoutes.some(
        (rel) =>
          rel.normalizedName === route.normalizedName ||
          haversineMeters(rel.center, route.center) <= NEAR_DUPLICATE_METERS * 2
      );
      if (covered) {
        duplicatesSuppressed += 1;
        duplicateDiagnostics.push({ kept: "relation_route", suppressed: route.sourceKey, reason: "route_member_covered_by_relation" });
        continue;
      }
    }
    keptRoutes.push(route);
  }

  keptRoutes.sort((a, b) => routeGeometryRank(b) - routeGeometryRank(a) || b.locavaScore - a.locavaScore);

  return {
    spots: keptSpots,
    routes: keptRoutes,
    duplicatesSuppressed,
    duplicateDiagnostics,
  };
}
