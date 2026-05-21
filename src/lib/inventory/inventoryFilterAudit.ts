import type { LocavaInventoryRoute, LocavaInventorySpot, LocavaRejectedItem } from "./inventoryLocavaTypes.js";

const JUNK_SPOT_CATEGORIES = new Set([
  "path",
  "track",
  "cycleway",
  "footway",
  "unclassified",
  "tertiary",
  "primary",
  "secondary",
  "trunk",
  "fire_station",
  "pharmacy",
  "post_office",
  "prison",
  "school",
  "vending_machine",
  "waste_transfer_station",
  "bicycle_parking",
]);

const JUNK_ROUTE_ACTIVITIES = new Set(["primary", "secondary", "tertiary", "trunk", "unclassified", "residential", "service"]);

const INFRA_AMENITIES = new Set([
  "fire_station",
  "pharmacy",
  "post_office",
  "prison",
  "school",
  "vending_machine",
  "waste_transfer_station",
  "bank",
  "dentist",
  "fuel",
  "charging_station",
]);

export type LocavaFilterAudit = {
  verdict: "good" | "needs_tuning" | "bad";
  acceptedJunkCategories: Record<string, number>;
  suspiciousSpotCategories: Record<string, number>;
  suspiciousRouteActivities: Record<string, number>;
  acceptedRoadsAsSpots: Array<Record<string, unknown>>;
  acceptedInfrastructureAsSpots: Array<Record<string, unknown>>;
  acceptedCivicAsSpots: Array<Record<string, unknown>>;
  acceptedTinyRouteFragments: Array<Record<string, unknown>>;
  rejectedLikelyGoodNature: Array<Record<string, unknown>>;
  rejectedLikelyGoodFood: Array<Record<string, unknown>>;
  rejectedLikelyGoodTrails: Array<Record<string, unknown>>;
  suggestedNextRules: string[];
  acceptedRoadRoutes: Array<Record<string, unknown>>;
  trailsWithoutParking: Array<Record<string, unknown>>;
  trailsWithoutFullGeometry: Array<Record<string, unknown>>;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function buildLocavaFilterAudit(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  rejected: LocavaRejectedItem[];
}): LocavaFilterAudit {
  const acceptedJunkCategories: Record<string, number> = {};
  const suspiciousSpotCategories: Record<string, number> = {};
  const suspiciousRouteActivities: Record<string, number> = {};
  const acceptedRoadsAsSpots: Array<Record<string, unknown>> = [];
  const acceptedInfrastructureAsSpots: Array<Record<string, unknown>> = [];
  const acceptedCivicAsSpots: Array<Record<string, unknown>> = [];
  const acceptedTinyRouteFragments: Array<Record<string, unknown>> = [];
  const acceptedRoadRoutes: Array<Record<string, unknown>> = [];

  for (const spot of input.spots) {
    if (JUNK_SPOT_CATEGORIES.has(spot.category) || JUNK_SPOT_CATEGORIES.has(tag(spot.tags, "highway") ?? "")) {
      acceptedJunkCategories[spot.category] = (acceptedJunkCategories[spot.category] ?? 0) + 1;
      acceptedRoadsAsSpots.push({ name: spot.name, category: spot.category, sourceKey: spot.sourceKey, score: spot.locavaScore });
    }
    if (INFRA_AMENITIES.has(tag(spot.tags, "amenity") ?? "")) {
      acceptedInfrastructureAsSpots.push({ name: spot.name, amenity: spot.tags.amenity, sourceKey: spot.sourceKey });
    }
    if (["townhall", "library", "place_of_worship", "grave_yard"].includes(tag(spot.tags, "amenity") ?? tag(spot.tags, "landuse") ?? "")) {
      acceptedCivicAsSpots.push({ name: spot.name, sourceKey: spot.sourceKey, category: spot.category });
    }
    if (spot.locavaScore < 55 || spot.negativeSignals.length >= 2) {
      suspiciousSpotCategories[spot.category] = (suspiciousSpotCategories[spot.category] ?? 0) + 1;
    }
  }

  for (const route of input.routes) {
    if (JUNK_ROUTE_ACTIVITIES.has(route.activity) || JUNK_ROUTE_ACTIVITIES.has(tag(route.tags, "highway") ?? "")) {
      suspiciousRouteActivities[route.activity] = (suspiciousRouteActivities[route.activity] ?? 0) + 1;
      acceptedRoadRoutes.push({ name: route.name, activity: route.activity, sourceKey: route.sourceKey, distanceMeters: route.distanceMeters });
    }
    if (route.distanceMeters < 100) {
      acceptedTinyRouteFragments.push({ name: route.name, distanceMeters: route.distanceMeters, sourceKey: route.sourceKey });
    }
    if (!route.selectedParking) {
      // collected below in trailsWithoutParking via diagnostics too
    }
  }

  const rejectedLikelyGoodNature = input.rejected
    .filter((r) =>
      /waterfall|viewpoint|peak|hill|leisure=park|nature_reserve|natural=wetland|boundary=protected_area/.test(r.rawTypeLabel + JSON.stringify(r.topTags))
    )
    .slice(0, 15)
    .map((r) => ({ name: r.name, rawTypeLabel: r.rawTypeLabel, score: r.locavaScore, rejectionReason: r.rejectionReason }));

  const rejectedLikelyGoodFood = input.rejected
    .filter((r) => /amenity=cafe|amenity=ice_cream|amenity=restaurant|amenity=pub|amenity=marketplace/.test(r.rawTypeLabel))
    .slice(0, 15)
    .map((r) => ({ name: r.name, rawTypeLabel: r.rawTypeLabel, score: r.locavaScore, rejectionReason: r.rejectionReason }));

  const rejectedLikelyGoodTrails = input.rejected
    .filter((r) => /route=hiking|route=foot|route=walking|highway=path|highway=footway/.test(r.rawTypeLabel) && (r.coordinates?.length ?? 0) >= 2)
    .slice(0, 15)
    .map((r) => ({ name: r.name, rawTypeLabel: r.rawTypeLabel, score: r.locavaScore, rejectionReason: r.rejectionReason }));

  const junkCount = Object.values(acceptedJunkCategories).reduce((a, b) => a + b, 0);
  const tinyCount = acceptedTinyRouteFragments.length;
  const roadRouteCount = acceptedRoadRoutes.length;
  let verdict: LocavaFilterAudit["verdict"] = "good";
  if (junkCount > 5 || tinyCount > 10 || roadRouteCount > 3) verdict = "needs_tuning";
  if (junkCount > 30 || roadRouteCount > 20) verdict = "bad";

  const suggestedNextRules: string[] = [];
  if (junkCount > 0) suggestedNextRules.push("Block linear highway categories from InventorySpot entirely.");
  if (tinyCount > 0) suggestedNextRules.push("Raise minimum assembled trail distance or suppress tiny way fragments.");
  if (roadRouteCount > 0) suggestedNextRules.push("Reject primary/secondary/tertiary/trunk routes unless official trail relation.");
  if (acceptedInfrastructureAsSpots.length > 0) suggestedNextRules.push("Hard reject civic infrastructure amenities as spots.");

  return {
    verdict,
    acceptedJunkCategories,
    suspiciousSpotCategories,
    suspiciousRouteActivities,
    acceptedRoadsAsSpots: acceptedRoadsAsSpots.slice(0, 20),
    acceptedInfrastructureAsSpots: acceptedInfrastructureAsSpots.slice(0, 20),
    acceptedCivicAsSpots: acceptedCivicAsSpots.slice(0, 20),
    acceptedTinyRouteFragments: acceptedTinyRouteFragments.slice(0, 20),
    rejectedLikelyGoodNature,
    rejectedLikelyGoodFood,
    rejectedLikelyGoodTrails,
    suggestedNextRules,
    acceptedRoadRoutes: acceptedRoadRoutes.slice(0, 20),
    trailsWithoutParking: input.routes.filter((r) => !r.selectedParking).slice(0, 15).map((r) => ({ name: r.name, sourceKey: r.sourceKey })),
    trailsWithoutFullGeometry: input.routes
      .filter((r) => r.geometryType === "MultiLineString" || (r.coordinates?.length ?? 0) < 3)
      .slice(0, 15)
      .map((r) => ({ name: r.name, sourceKey: r.sourceKey, pointCount: r.coordinates?.length ?? r.segments?.flat().length ?? 0 })),
  };
}
