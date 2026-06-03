import type { LocavaClassifierConfig, LocavaClassifierFeatureInput } from "./inventoryLocavaTypes.js";
import {
  hillOrPeakHasOnTagTrailContext,
  isOsmObservationTowerTags,
  isOsmViewpointTags,
} from "./inventoryHillPeakGate.js";
import {
  evaluateNameInference,
  type NameInferenceEvaluation,
} from "./inventoryNameInference.js";
import { inferActivitiesFromOsmTags } from "./inventoryOsmActivityTags.js";
import { dedupeActivities } from "./activities/locavaActivities.js";
import {
  evaluateOsmVisitability,
  visitabilityBlocksSpotAcceptance,
} from "./inventoryVisitability.js";

export type LocavaScoreBreakdown = {
  score: number;
  spotScore: number;
  routeScore: number;
  tagSignals: string[];
  negativeSignals: string[];
  warnings: string[];
  hardReject: boolean;
  hardRejectReason?: string;
  visitorOverride: boolean;
  visitability?: ReturnType<typeof evaluateOsmVisitability>;
  primaryCategory: string | null;
  secondaryCategories: string[];
  activities: string[];
  nameInference?: NameInferenceEvaluation;
};

const NATIONAL_CHAIN_FAST_FOOD = new Set([
  "mcdonald's",
  "mcdonalds",
  "burger king",
  "wendy's",
  "wendys",
  "moe's",
  "moes",
  "panera",
  "panera bread",
  "jersey mike's",
  "jersey mikes",
  "subway",
  "taco bell",
  "kfc",
  "domino's",
  "dominos",
  "pizza hut",
  "dunkin",
  "dunkin'",
  "starbucks",
  "chipotle",
]);

const STRONG_VISITOR_AMENITY = new Set([
  "cafe",
  "restaurant",
  "ice_cream",
  "pub",
  "bar",
  "fast_food",
  "marketplace",
  "arts_centre",
  "cinema",
  "theatre",
  "museum",
]);

const STRONG_VISITOR_TOURISM = new Set([
  "viewpoint",
  "attraction",
  "museum",
  "picnic_site",
  "camp_site",
  "information",
  "artwork",
  "brewery",
]);

const TRAIL_SURFACES = new Set(["dirt", "ground", "gravel", "grass", "woodchips", "compacted", "earth", "sand"]);

const DECISION_THRESHOLD = 45;

const LINEAR_HIGHWAY_NEVER_SPOT = new Set([
  "path",
  "footway",
  "track",
  "cycleway",
  "steps",
  "bridleway",
  "primary",
  "secondary",
  "tertiary",
  "trunk",
  "unclassified",
  "residential",
  "service",
  "living_street",
  "motorway",
]);

const CIVIC_AMENITY_REJECT = new Set([
  "fire_station",
  "police",
  "pharmacy",
  "post_office",
  "school",
  "prison",
  "vending_machine",
  "waste_transfer_station",
  "bicycle_parking",
  "hospital",
]);

const CHAIN_RESTAURANTS = new Set(["applebee", "denny", "olive garden", "red lobster", "chili", "outback"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string, value?: string): boolean {
  const v = tag(tags, key);
  if (v == null) return false;
  if (value == null) return true;
  return v === value.toLowerCase();
}

function hasRealName(feature: LocavaClassifierFeatureInput): boolean {
  const name = feature.name?.trim();
  if (!name || name.length < 2) return false;
  if (name.includes("=")) return false;
  return true;
}

function isChainFastFood(tags: Record<string, string>): boolean {
  const brand = (tag(tags, "brand") ?? tag(tags, "operator") ?? "").toLowerCase();
  const name = (tag(tags, "name") ?? "").toLowerCase();
  for (const chain of NATIONAL_CHAIN_FAST_FOOD) {
    if (brand.includes(chain) || name.includes(chain)) return true;
  }
  return false;
}

function isLocalSnackFastFood(tags: Record<string, string>): boolean {
  const cuisine = tag(tags, "cuisine") ?? "";
  return (
    cuisine.includes("ice_cream") ||
    cuisine.includes("burger") ||
    cuisine.includes("snack") ||
    cuisine.includes("hot_dog") ||
    (tag(tags, "name") ?? "").toLowerCase().includes("snack")
  );
}

function hasVisitorOverride(tags: Record<string, string>): boolean {
  const amenity = tag(tags, "amenity");
  if (amenity && STRONG_VISITOR_AMENITY.has(amenity)) return true;
  const tourism = tag(tags, "tourism");
  if (tourism && STRONG_VISITOR_TOURISM.has(tourism)) return true;
  if (hasTag(tags, "historic")) return true;
  if (hasTag(tags, "leisure", "park")) {
    if (tag(tags, "boundary") === "protected_area") {
      const visit = evaluateOsmVisitability(tags);
      return visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal;
    }
    return true;
  }
  if (hasTag(tags, "leisure", "nature_reserve")) {
    const visit = evaluateOsmVisitability(tags);
    return visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal;
  }
  if (hasTag(tags, "natural", "waterfall")) return true;
  return false;
}

function isTrailLike(tags: Record<string, string>): boolean {
  const highway = tag(tags, "highway");
  if (!highway) return false;
  if (["path", "footway", "track", "bridleway", "cycleway", "steps"].includes(highway)) return true;
  return false;
}

function isSidewalkOrCrossing(tags: Record<string, string>): boolean {
  const footway = tag(tags, "footway");
  if (footway && ["sidewalk", "crossing", "traffic_island", "access_aisle"].includes(footway)) return true;
  const highway = tag(tags, "highway");
  return highway === "crossing" || highway === "traffic_isle";
}

function isPrivateAccess(tags: Record<string, string>): boolean {
  const access = tag(tags, "access");
  return access === "private" || access === "no" || tag(tags, "private") === "yes";
}

export function isPrivateRecreationDestination(tags: Record<string, string>): boolean {
  if (!isPrivateAccess(tags)) return false;
  if (tag(tags, "access") === "permissive" || tag(tags, "access") === "public" || tag(tags, "access") === "designated") {
    return false;
  }
  if (hasVisitorOverride(tags)) return false;
  return true;
}

export function hasLocavaNatureSignal(tags: Record<string, string>): boolean {
  if (tag(tags, "natural") === "waterfall" || tag(tags, "natural") === "beach" || tag(tags, "natural") === "cave_entrance") {
    return true;
  }
  if (tag(tags, "waterway") === "waterfall") return true;
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (tag(tags, "tourism") && ["viewpoint", "picnic_site", "camp_site", "attraction", "museum"].includes(tag(tags, "tourism")!)) {
    return true;
  }
  if (isOsmObservationTowerTags(tags)) return true;
  if (tag(tags, "historic") || tag(tags, "heritage")) return true;
  if (tag(tags, "amenity") && STRONG_VISITOR_AMENITY.has(tag(tags, "amenity")!)) return true;
  if (tag(tags, "leisure") === "park" && tag(tags, "boundary") !== "protected_area") return true;
  if (tag(tags, "leisure") === "nature_reserve" || tag(tags, "boundary") === "protected_area") {
    const visit = evaluateOsmVisitability(tags);
    return visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal;
  }
  if (tag(tags, "natural") === "peak" || tag(tags, "natural") === "hill") {
    return false;
  }
  if (tag(tags, "natural") === "wetland" || tag(tags, "natural") === "wood" || tag(tags, "natural") === "scrub") {
    const visit = evaluateOsmVisitability(tags);
    return visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal;
  }
  if (tag(tags, "landuse") === "recreation_ground") return true;
  return false;
}

export function isStrongSwimmingOrBeachTagSignal(tags: Record<string, string>): boolean {
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (tag(tags, "natural") === "beach") return true;
  if (tag(tags, "leisure") === "beach_resort") return true;
  if (tag(tags, "leisure") === "beach") return true;
  if (tag(tags, "beach") === "yes") return true;
  if (tag(tags, "sport") === "swimming") return true;
  if (tag(tags, "swimming") === "yes" || tag(tags, "swimming") === "designated") return true;
  if (tag(tags, "bathing") === "yes") return true;
  if ((tag(tags, "natural") === "water" || tag(tags, "waterway")) && (tag(tags, "swimming") || tag(tags, "bathing"))) {
    return true;
  }
  return false;
}

/** @deprecated Use isStrongSwimmingOrBeachTagSignal — name is ignored. */
export function isStrongSwimmingOrBeachSignal(tags: Record<string, string>, _name?: string | null): boolean {
  return isStrongSwimmingOrBeachTagSignal(tags);
}

export function isBridgeSpot(tags: Record<string, string>): boolean {
  if (tag(tags, "man_made") === "bridge") return true;
  if (tag(tags, "bridge") && tag(tags, "bridge") !== "no") return true;
  if (tag(tags, "railway") && tag(tags, "bridge")) return true;
  return false;
}

export function isRailroadBridge(tags: Record<string, string>): boolean {
  if (!isBridgeSpot(tags)) return false;
  if (tag(tags, "railway")) return true;
  return Object.keys(tags).some((k) => k === "railway" || k.startsWith("railway:"));
}

function isBusinessOrOfficeOnly(tags: Record<string, string>): boolean {
  if (tag(tags, "office")) return true;
  if (tag(tags, "shop")) return true;
  if (tag(tags, "craft") && !hasVisitorOverride(tags)) return true;
  if (tag(tags, "healthcare") === "centre" || tag(tags, "healthcare") === "clinic") return true;
  return false;
}

function isNameOnlyFeature(feature: LocavaClassifierFeatureInput, breakdown: LocavaScoreBreakdown): boolean {
  if (
    feature.nearbyHikingTrail === true &&
    (tag(feature.tags, "natural") === "peak" || tag(feature.tags, "natural") === "hill")
  ) {
    return false;
  }
  if (!hasRealName(feature)) return false;
  const tags = feature.tags;
  if (hasLocavaNatureSignal(tags)) return false;
  if (hasVisitorOverride(tags)) return false;
  if (isBridgeSpot(tags)) return false;
  if (isStrongSwimmingOrBeachTagSignal(tags)) return false;
  if (tag(tags, "route")) return false;
  if (isBusinessOrOfficeOnly(tags)) return true;
  const meaningfulKeys = Object.keys(tags).filter((k) => !["name", "note", "source", "created_by", "fixme"].includes(k));
  if (meaningfulKeys.length === 0) return true;
  const raw = feature.rawTypeLabel ?? "";
  if (raw === "name" || raw === "unknown" || raw === "") return true;
  if (!hasLocavaNatureSignal(tags) && breakdown.spotScore < 55) return true;
  return false;
}

function isNotableHistoricOrTourism(tags: Record<string, string>): boolean {
  return (
    hasTag(tags, "historic") ||
    hasTag(tags, "heritage") ||
    tag(tags, "tourism") === "attraction" ||
    tag(tags, "amenity") === "theatre" ||
    tag(tags, "amenity") === "cinema"
  );
}

export function isTrailLikeHighway(tags: Record<string, string>): boolean {
  return isTrailLike(tags) && !isSidewalkOrCrossing(tags) && !isPrivateAccess(tags);
}

export function isDestinationSpotEligible(feature: LocavaClassifierFeatureInput): boolean {
  const tags = feature.tags;
  const highway = tag(tags, "highway");
  const waterway = tag(tags, "waterway");
  const amenity = tag(tags, "amenity");
  const landuse = tag(tags, "landuse");

  if (highway && LINEAR_HIGHWAY_NEVER_SPOT.has(highway) && !hasVisitorOverride(tags)) return false;
  if (waterway === "stream" && !hasTag(tags, "waterway", "waterfall") && tag(tags, "natural") !== "water") return false;
  if (landuse === "grave_yard" && !isNotableHistoricOrTourism(tags)) return false;
  if (amenity === "grave_yard" && !isNotableHistoricOrTourism(tags)) return false;
  if (tag(tags, "historic") === "cemetery" && !isNotableHistoricOrTourism(tags)) return false;
  if (landuse === "cemetery" && !isNotableHistoricOrTourism(tags)) return false;
  if (amenity === "place_of_worship" && !isNotableHistoricOrTourism(tags)) return false;
  if (amenity === "townhall" && !isNotableHistoricOrTourism(tags) && tag(tags, "amenity") !== "theatre") return false;
  if (amenity && CIVIC_AMENITY_REJECT.has(amenity) && !isNotableHistoricOrTourism(tags)) return false;

  if (feature.geometryKind === "line" && highway && !hasVisitorOverride(tags) && !isBridgeSpot(tags)) return false;

  return true;
}

function isProtectedOrRecreationContext(tags: Record<string, string>): boolean {
  return (
    hasTag(tags, "leisure", "park") ||
    hasTag(tags, "leisure", "nature_reserve") ||
    hasTag(tags, "boundary", "protected_area") ||
    hasTag(tags, "landuse", "recreation_ground") ||
    hasTag(tags, "landuse", "conservation") ||
    hasTag(tags, "natural", "wood") ||
    hasTag(tags, "route")
  );
}

function addScore(
  breakdown: LocavaScoreBreakdown,
  amount: number,
  signal: string,
  target: "both" | "spot" | "route" = "both"
): void {
  breakdown.score += amount;
  if (target === "both" || target === "spot") breakdown.spotScore += amount;
  if (target === "both" || target === "route") breakdown.routeScore += amount;
  breakdown.tagSignals.push(`${signal}:${amount >= 0 ? "+" : ""}${amount}`);
}

function addNegative(
  breakdown: LocavaScoreBreakdown,
  amount: number,
  signal: string,
  target: "both" | "spot" | "route" = "both"
): void {
  breakdown.negativeSignals.push(`${signal}:${amount}`);
  addScore(breakdown, amount, signal, target);
}

export function scoreOsmFeatureForLocava(
  feature: LocavaClassifierFeatureInput,
  config: LocavaClassifierConfig
): LocavaScoreBreakdown {
  const tags = feature.tags;
  const breakdown: LocavaScoreBreakdown = {
    score: 0,
    spotScore: 0,
    routeScore: 0,
    tagSignals: [],
    negativeSignals: [],
    warnings: [],
    hardReject: false,
    visitorOverride: false,
    primaryCategory: null,
    secondaryCategories: [],
    activities: [],
  };

  const named = hasRealName(feature);
  const highway = tag(tags, "highway");
  const building = tag(tags, "building");
  const aeroway = tag(tags, "aeroway");
  const amenity = tag(tags, "amenity");
  const natural = tag(tags, "natural");
  const leisure = tag(tags, "leisure");
  const tourism = tag(tags, "tourism");
  const routeTag = tag(tags, "route");
  const landuse = tag(tags, "landuse");

  // Name scoring
  if (named) addScore(breakdown, 25, "named");
  else if (tag(tags, "ref") || tag(tags, "operator") || tag(tags, "brand")) addScore(breakdown, 10, "ref_or_brand");
  else if (natural || routeTag || hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) addScore(breakdown, -20, "unnamed_strong_natural_or_trail");
  else addScore(breakdown, -40, "unnamed_generic");

  // Geometry scoring
  if (feature.geometryKind === "point" && feature.lat != null && feature.lng != null) {
    addScore(breakdown, 20, "valid_point", "spot");
  } else if (feature.geometryKind === "line" && (feature.coordinates?.length ?? 0) >= 2) {
    addScore(breakdown, 25, "valid_line", "route");
  } else if (feature.geometryKind === "polygon" && feature.lat != null && feature.lng != null) {
    addScore(breakdown, 15, "valid_area_center", "spot");
  } else if (feature.coordValid === false || feature.coordSwapped) {
    addScore(breakdown, -80, "invalid_coordinates");
    breakdown.warnings.push("invalid_or_swapped_coordinates");
  } else {
    addScore(breakdown, -60, "missing_geometry");
  }

  // Hard rejection negatives (may be overridden)
  const hardRejectChecks: Array<{ match: boolean; score: number; reason: string }> = [
    { match: Boolean(aeroway), score: -95, reason: "aeroway" },
    { match: highway === "primary", score: -85, reason: "highway_primary" },
    { match: highway === "secondary", score: -85, reason: "highway_secondary" },
    { match: highway === "tertiary", score: -85, reason: "highway_tertiary" },
    { match: highway === "trunk", score: -85, reason: "highway_trunk" },
    { match: highway === "residential", score: -80, reason: "highway_residential" },
    { match: highway === "unclassified" && !isTrailLike(tags), score: -75, reason: "highway_unclassified" },
    { match: highway === "driveway", score: -80, reason: "highway_driveway" },
    { match: amenity != null && CIVIC_AMENITY_REJECT.has(amenity) && !isNotableHistoricOrTourism(tags), score: -85, reason: `amenity_${amenity}` },
    { match: landuse === "grave_yard" && !isNotableHistoricOrTourism(tags), score: -70, reason: "grave_yard_generic" },
    { match: amenity === "grave_yard" && !isNotableHistoricOrTourism(tags), score: -70, reason: "grave_yard_generic" },
    { match: tag(tags, "historic") === "cemetery" && !isNotableHistoricOrTourism(tags), score: -70, reason: "cemetery_generic" },
    { match: landuse === "cemetery" && !isNotableHistoricOrTourism(tags), score: -70, reason: "cemetery_generic" },
    { match: amenity === "place_of_worship" && !isNotableHistoricOrTourism(tags), score: -65, reason: "place_of_worship_generic" },
    { match: amenity === "townhall" && !isNotableHistoricOrTourism(tags), score: -60, reason: "townhall_generic" },
    { match: amenity === "bank", score: -80, reason: "amenity_bank" },
    { match: amenity === "dentist", score: -80, reason: "amenity_dentist" },
    { match: amenity === "doctors", score: -80, reason: "amenity_doctors" },
    { match: amenity === "fuel", score: -80, reason: "amenity_fuel" },
    { match: amenity === "charging_station", score: -80, reason: "amenity_charging_station" },
    { match: amenity === "car_wash", score: -80, reason: "amenity_car_wash" },
    { match: amenity === "loading_dock", score: -80, reason: "amenity_loading_dock" },
    { match: Boolean(tag(tags, "manhole") || tag(tags, "power") === "tower" || tag(tags, "power") === "pole"), score: -80, reason: "utility_object" },
    { match: landuse === "residential" || landuse === "commercial" || landuse === "industrial", score: -70, reason: "generic_landuse" },
    { match: tag(tags, "boundary") === "administrative", score: -70, reason: "administrative_boundary" },
    { match: isBusinessOrOfficeOnly(tags) && !hasVisitorOverride(tags), score: -85, reason: "business_office_only" },
  ];

  if (building && !hasVisitorOverride(tags)) {
    if (["house", "residential", "yes", "commercial", "garage", "shed", "barn"].includes(building)) {
      hardRejectChecks.push({ match: true, score: -90, reason: "generic_building" });
    }
  }

  if (highway === "service" && !isTrailLike(tags) && !isProtectedOrRecreationContext(tags)) {
    hardRejectChecks.push({ match: true, score: -75, reason: "highway_service" });
  }

  if (isSidewalkOrCrossing(tags)) {
    hardRejectChecks.push({ match: true, score: -80, reason: "sidewalk_or_crossing" });
  }

  if (amenity === "parking" && !isProtectedOrRecreationContext(tags) && !hasTag(tags, "parking", "trailhead")) {
    hardRejectChecks.push({ match: true, score: -45, reason: "generic_parking" });
  }

  if (isPrivateRecreationDestination(tags) && (isStrongSwimmingOrBeachSignal(tags, feature.name) || isTrailLike(tags))) {
    hardRejectChecks.push({ match: true, score: -90, reason: "private_access" });
  }

  if (amenity === "swimming_pool" && (isPrivateAccess(tags) || tag(tags, "access") === "customers")) {
    hardRejectChecks.push({ match: true, score: -85, reason: "private_swimming_pool" });
  }

  if (natural === "hill" && !isOsmViewpointTags(tags) && feature.nearbyHikingTrail !== true) {
    hardRejectChecks.push({ match: true, score: -80, reason: "bare_hill_no_trail_or_viewpoint" });
  }
  if (
    natural === "peak" &&
    !hillOrPeakHasOnTagTrailContext(tags) &&
    feature.nearbyHikingTrail !== true &&
    !isOsmViewpointTags(tags)
  ) {
    hardRejectChecks.push({ match: true, score: -75, reason: "bare_peak_no_trail_or_viewpoint" });
  }

  let hardestReject = 0;
  let hardestReason: string | undefined;
  for (const check of hardRejectChecks) {
    if (!check.match) continue;
    addNegative(breakdown, check.score, check.reason);
    if (check.score <= hardestReject) {
      hardestReject = check.score;
      hardestReason = check.reason;
    }
  }

  breakdown.visitorOverride = hasVisitorOverride(tags);
  if (hardestReject <= -70 && !breakdown.visitorOverride) {
    breakdown.hardReject = true;
    breakdown.hardRejectReason = hardestReason;
  }

  // Outdoor / nature high-value
  if (tag(tags, "waterway") === "waterfall" || natural === "waterfall") addScore(breakdown, 75, "waterway_waterfall", "spot");
  if (natural === "waterfall") addScore(breakdown, 70, "natural_waterfall", "spot");
  if (tourism === "viewpoint") addScore(breakdown, 65, "tourism_viewpoint", "spot");
  if (isOsmObservationTowerTags(tags) && named) addScore(breakdown, 62, "observation_tower", "spot");
  if (
    natural === "peak" &&
    (hillOrPeakHasOnTagTrailContext(tags) || feature.nearbyHikingTrail === true)
  ) {
    addScore(breakdown, 65, "natural_peak", "spot");
  }
  if (leisure === "park") {
    if (tag(tags, "boundary") === "protected_area") {
      const visit = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
      if (visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal) {
        addScore(breakdown, 60, "leisure_park", "spot");
      } else {
        addScore(breakdown, 15, "leisure_park_in_protected_context", "spot");
      }
    } else {
      addScore(breakdown, 60, "leisure_park", "spot");
    }
  }
  if (leisure === "nature_reserve") {
    const visit = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
    if (visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal) {
      addScore(breakdown, 65, "leisure_nature_reserve", "spot");
    } else {
      addScore(breakdown, 20, "leisure_nature_reserve_weak", "spot");
    }
  }
  if (tag(tags, "boundary") === "protected_area") {
    const visit = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
    if (visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal) {
      addScore(breakdown, 55, "boundary_protected_area_with_visitor_signal", "spot");
    } else {
      addScore(breakdown, 10, "boundary_protected_area_only", "spot");
    }
  }
  if (tourism === "picnic_site") addScore(breakdown, 55, "tourism_picnic_site", "spot");
  if (tourism === "camp_site") addScore(breakdown, 55, "tourism_camp_site", "spot");
  if (natural === "beach") addScore(breakdown, 70, "natural_beach", "spot");
  if (tag(tags, "beach") === "yes") addScore(breakdown, 65, "beach_yes", "spot");
  if (leisure === "swimming_area") addScore(breakdown, 80, "leisure_swimming_area", "spot");
  if (leisure === "beach_resort") addScore(breakdown, 70, "leisure_beach_resort", "spot");
  if (tag(tags, "sport") === "swimming") addScore(breakdown, 75, "sport_swimming", "spot");
  if (tag(tags, "swimming") === "yes" || tag(tags, "swimming") === "designated") addScore(breakdown, 75, "swimming_yes", "spot");
  if (tag(tags, "bathing") === "yes") addScore(breakdown, 70, "bathing_yes", "spot");
  if (tag(tags, "amenity") === "public_bath" && isProtectedOrRecreationContext(tags)) addScore(breakdown, 55, "public_bath_outdoor", "spot");
  if (isStrongSwimmingOrBeachTagSignal(tags) && isProtectedOrRecreationContext(tags)) addScore(breakdown, 30, "swim_beach_public_context", "spot");
  if (tag(tags, "access") === "public" || tag(tags, "access") === "permissive" || tag(tags, "access") === "designated") {
    addScore(breakdown, 20, "public_access", "spot");
  }

  if (isBridgeSpot(tags)) {
    addScore(breakdown, 65, "bridge_spot", "spot");
    if (isRailroadBridge(tags) || tags.railway != null) addScore(breakdown, 25, "railroad_bridge", "spot");
    else if (isTrailLike(tags) || isProtectedOrRecreationContext(tags) || tag(tags, "foot") === "yes" || tag(tags, "hiking") === "yes") {
      addScore(breakdown, 20, "trail_bridge", "spot");
    }
  }

  if (natural === "wetland") {
    const visit = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
    if (visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal) {
      addScore(breakdown, 50, "natural_wetland_with_visitor_signal", "spot");
    } else if (named || isProtectedOrRecreationContext(tags)) {
      addScore(breakdown, 25, "natural_wetland_named_or_rec", "spot");
    } else if (config.natureMode === "broad_natural") {
      addScore(breakdown, 30, "natural_wetland_broad", "spot");
    } else {
      addNegative(breakdown, -30, "unnamed_wetland_fragment", "spot");
    }
  }

  if (natural === "water" || tag(tags, "water")) {
    const waterType = tag(tags, "water");
    if (named || waterType === "lake" || waterType === "pond" || waterType === "reservoir") {
      addScore(breakdown, 45, "natural_water_named_or_lake", "spot");
    } else if (config.natureMode === "broad_natural") {
      addScore(breakdown, 25, "natural_water_broad", "spot");
    }
  }

  if (natural === "wood" || natural === "forest") {
    const visit = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
    if (visit.hasStrongDestinationSignal || visit.hasAccessOrRecreationSignal) {
      addScore(breakdown, 35, "natural_wood_with_visitor_signal", "spot");
    } else if (named || isProtectedOrRecreationContext(tags)) {
      addScore(breakdown, 20, "natural_wood_named_or_protected", "spot");
    } else if (config.natureMode === "broad_natural") {
      addScore(breakdown, 20, "natural_wood_broad", "spot");
    }
  }

  breakdown.visitability = evaluateOsmVisitability(tags, { name: feature.name, geometryKind: feature.geometryKind });
  const visitBlock = visitabilityBlocksSpotAcceptance(tags, breakdown.visitability);
  if (visitBlock.reject && !breakdown.visitorOverride && !isStrongSwimmingOrBeachTagSignal(tags)) {
    addNegative(breakdown, -95, visitBlock.reason ?? "large_natural_area_no_visitor_signal", "spot");
    breakdown.hardReject = true;
    breakdown.hardRejectReason = visitBlock.reason ?? "large_natural_area_no_visitor_signal";
    breakdown.visitorOverride = false;
  } else if (breakdown.visitability.visitabilityTier === "moderate" || breakdown.visitability.visitabilityTier === "strong") {
    addScore(breakdown, Math.min(25, Math.floor(breakdown.visitability.score / 4)), "visitability_boost", "spot");
  }

  // Routes / trails
  if (routeTag === "hiking") addScore(breakdown, 80, "route_hiking", "route");
  if (routeTag === "foot") addScore(breakdown, 75, "route_foot", "route");
  if (routeTag === "walking") addScore(breakdown, 70, "route_walking", "route");
  if (routeTag === "bicycle") addScore(breakdown, 65, "route_bicycle", "route");
  if (highway === "path") addScore(breakdown, 70, "highway_path", "route");
  if (highway === "footway" && !isSidewalkOrCrossing(tags)) addScore(breakdown, 65, "highway_footway", "route");
  if (highway === "track" && !isPrivateAccess(tags)) addScore(breakdown, 55, "highway_track", "route");
  if (highway === "bridleway") addScore(breakdown, 55, "highway_bridleway", "route");
  if (highway === "cycleway") addScore(breakdown, 45, "highway_cycleway", "route");
  if (hasTag(tags, "foot", "designated")) addScore(breakdown, 35, "foot_designated", "route");
  if (hasTag(tags, "hiking", "yes")) addScore(breakdown, 35, "hiking_yes", "route");
  if (hasTag(tags, "sac_scale")) addScore(breakdown, 35, "sac_scale", "route");
  if (hasTag(tags, "trail_visibility")) addScore(breakdown, 30, "trail_visibility", "route");
  const surface = tag(tags, "surface");
  if (surface && TRAIL_SURFACES.has(surface)) addScore(breakdown, 25, "trail_surface", "route");

  if (isPrivateAccess(tags) && isTrailLike(tags)) addNegative(breakdown, -50, "private_trail_access", "route");

  if (config.trailMode === "recreation_only") {
    if (isTrailLike(tags) && !named && !hasTag(tags, "sac_scale") && !hasTag(tags, "trail_visibility") && !isProtectedOrRecreationContext(tags)) {
      addScore(breakdown, 15, "unnamed_path_medium", "route");
    }
    if (isSidewalkOrCrossing(tags)) addNegative(breakdown, -80, "sidewalk_hidden", "route");
  } else if (isTrailLike(tags)) {
    addScore(breakdown, 20, "all_paths_mode", "route");
  }

  // Food / local experience
  if (amenity === "ice_cream") addScore(breakdown, 70, "amenity_ice_cream", "spot");
  if (amenity === "cafe") addScore(breakdown, 65, "amenity_cafe", "spot");
  if (amenity === "restaurant") {
    const nameLower = (tag(tags, "name") ?? "").toLowerCase();
    const isChainRestaurant = [...CHAIN_RESTAURANTS].some((c) => nameLower.includes(c));
    if (config.foodMode === "local_only" && isChainRestaurant) addNegative(breakdown, -35, "chain_restaurant_low_value", "spot");
    else addScore(breakdown, 65, "amenity_restaurant", "spot");
  }
  if (amenity === "pub") addScore(breakdown, 60, "amenity_pub", "spot");
  if (amenity === "bar") addScore(breakdown, 60, "amenity_bar", "spot");
  if (tag(tags, "craft") === "brewery" || tourism === "brewery") addScore(breakdown, 65, "brewery", "spot");
  if (amenity === "marketplace") addScore(breakdown, 55, "amenity_marketplace", "spot");

  if (amenity === "fast_food") {
    if (config.foodMode === "all_named_food" && named) addScore(breakdown, 45, "fast_food_named_all_mode", "spot");
    else if (isLocalSnackFastFood(tags)) addScore(breakdown, 45, "fast_food_local_snack", "spot");
    else if (isChainFastFood(tags)) addNegative(breakdown, -30, "chain_fast_food_low_locava_value", "spot");
    else if (named) addScore(breakdown, 20, "fast_food_unbranded_named", "spot");
    else addNegative(breakdown, -50, "unnamed_fast_food", "spot");
  }

  // Culture / history
  if (tourism === "museum") addScore(breakdown, 65, "tourism_museum", "spot");
  if (hasTag(tags, "historic") && named) addScore(breakdown, 60, "historic_named", "spot");
  if (tourism === "attraction") addScore(breakdown, 55, "tourism_attraction", "spot");
  if (tourism === "artwork") addScore(breakdown, 50, "tourism_artwork", "spot");
  if (amenity === "arts_centre") addScore(breakdown, 50, "amenity_arts_centre", "spot");
  if ((amenity === "cinema" || amenity === "theatre") && named) addScore(breakdown, 45, "cinema_theatre_named", "spot");
  if (amenity === "library" && named) addScore(breakdown, 35, "library_named_low", "spot");

  // Access support
  if (amenity === "parking" && (isProtectedOrRecreationContext(tags) || hasTag(tags, "hiking"))) {
    addScore(breakdown, 35, "trailhead_parking", "spot");
  }
  if (tag(tags, "information") && isProtectedOrRecreationContext(tags)) addScore(breakdown, 45, "trail_information", "spot");
  if (highway === "trailhead" || (tourism === "information" && isTrailLike(tags))) addScore(breakdown, 40, "trailhead", "spot");

  // Linear highways should not accumulate spot score
  if (highway && LINEAR_HIGHWAY_NEVER_SPOT.has(highway)) addNegative(breakdown, -90, "linear_highway_not_spot", "spot");

  // Category mapping from explicit tags first.
  breakdown.primaryCategory = inferPrimaryCategory(tags, breakdown, feature);

  const nameEval = evaluateNameInference(tags, feature.name ?? tag(tags, "name") ?? null);
  breakdown.nameInference = nameEval;
  if (nameEval.nameInferenceBlockedReason) {
    breakdown.warnings.push(`name_inference_blocked:${nameEval.nameInferenceBlockedReason}`);
  }

  if (isNameOnlyFeature(feature, breakdown)) {
    addNegative(breakdown, -85, "name_only_no_locava_signal", "spot");
    breakdown.hardReject = true;
    if (
      breakdown.hardRejectReason !== "large_natural_area_no_visitor_signal" &&
      breakdown.hardRejectReason !== "bare_peak_no_trail_or_viewpoint" &&
      breakdown.hardRejectReason !== "bare_hill_no_trail_or_viewpoint"
    ) {
      breakdown.hardRejectReason = "name_only_no_locava_signal";
    }
  }

  const place = tag(tags, "place");
  const adminPlaces = new Set([
    "city",
    "town",
    "village",
    "hamlet",
    "suburb",
    "neighbourhood",
    "neighborhood",
    "quarter",
    "isolated_dwelling",
  ]);
  const nameLower = (feature.name ?? tag(tags, "name") ?? "").toLowerCase();
  if (/\bmobile\s+home\s+park\b/i.test(nameLower)) {
    addNegative(breakdown, -95, "mobile_home_park", "spot");
    breakdown.hardReject = true;
    breakdown.hardRejectReason = "mobile_home_park";
  } else if (
    place &&
    adminPlaces.has(place) &&
    !hasVisitorOverride(tags) &&
    !isBridgeSpot(tags) &&
    !isStrongSwimmingOrBeachTagSignal(tags)
  ) {
    addNegative(breakdown, -90, "administrative_place", "spot");
    breakdown.hardReject = true;
    breakdown.hardRejectReason = "administrative_place";
  }

  if (breakdown.primaryCategory === "natural_feature" && !hasLocavaNatureSignal(tags)) {
    breakdown.primaryCategory = null;
    addNegative(breakdown, -60, "natural_feature_without_signal", "spot");
  }

  breakdown.secondaryCategories = inferSecondaryCategories(tags);
  breakdown.activities = dedupeActivities(inferActivities(breakdown.primaryCategory, breakdown.secondaryCategories, tags));
  if (building && breakdown.visitorOverride) {
    breakdown.hardReject = false;
    breakdown.warnings.push("building_overridden_by_visitor_amenity");
  }

  return breakdown;
}

function inferPrimaryCategory(
  tags: Record<string, string>,
  breakdown: LocavaScoreBreakdown,
  feature?: LocavaClassifierFeatureInput
): string | null {
  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return "waterfall";
  if (tag(tags, "tourism") === "viewpoint") return "viewpoint";
  if (isOsmObservationTowerTags(tags)) return "viewpoint";
  if (tag(tags, "natural") === "peak") return "peak";
  if (tag(tags, "natural") === "hill") return "hill";
  if (tag(tags, "leisure") === "park") return "park";
  if (tag(tags, "leisure") === "nature_reserve") return "nature_reserve";
  if (tag(tags, "leisure") === "swimming_area") return "swimming";
  if (tag(tags, "natural") === "beach" || tag(tags, "beach") === "yes" || tag(tags, "leisure") === "beach_resort" || tag(tags, "leisure") === "beach") return "beach";
  if (tag(tags, "swimming") === "yes" || tag(tags, "swimming") === "designated" || tag(tags, "bathing") === "yes" || tag(tags, "sport") === "swimming") {
    return "swimming_hole";
  }
  if (isBridgeSpot(tags)) {
    if (isRailroadBridge(tags) || tags.railway != null) return "railroad_bridge";
    if (tag(tags, "bridge") === "covered" || /\bcovered\s+bridge\b/i.test(tag(tags, "name") ?? "")) return "covered_bridge";
    return "bridge";
  }
  if (tag(tags, "natural") === "wetland") return "wetland";
  if (tag(tags, "natural") === "water") return "water";
  if (tag(tags, "amenity") === "ice_cream") return "ice_cream";
  if (tag(tags, "amenity") === "cafe") return "cafe";
  if (tag(tags, "amenity") === "restaurant") return "restaurant";
  if (tag(tags, "amenity") === "fast_food") return "fast_food";
  if (tag(tags, "landuse") === "grave_yard" || tag(tags, "amenity") === "grave_yard" || tag(tags, "historic") === "cemetery") return "grave_yard";
  if (tag(tags, "tourism") === "museum") return "museum";
  if (tag(tags, "tourism") === "picnic_site") return "picnic_site";
  if (tag(tags, "route")) return tag(tags, "route") ?? "route";
  if (breakdown.routeScore > breakdown.spotScore + 5) {
    return tag(tags, "route") ?? tag(tags, "highway") ?? "trail";
  }
  if (tag(tags, "highway") && LINEAR_HIGHWAY_NEVER_SPOT.has(tag(tags, "highway")!)) {
    return null;
  }
  if (tag(tags, "highway") === "path") return "path";
  if (tag(tags, "highway") === "footway") return "footway";
  if (tag(tags, "highway") === "track") return "track";
  if (breakdown.spotScore >= breakdown.routeScore) {
    const natural = tag(tags, "natural");
    const amenity = tag(tags, "amenity");
    const tourism = tag(tags, "tourism");
    if (natural) return natural;
    if (amenity) return amenity;
    if (tourism) return tourism;
    if (hasLocavaNatureSignal(tags)) return "natural_feature";
    if (feature && hasRealName(feature) && breakdown.spotScore >= 45) return null;
  }
  return tag(tags, "route") ?? tag(tags, "highway") ?? "trail";
}

function inferSecondaryCategories(tags: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const key of ["natural", "leisure", "tourism", "amenity", "historic", "waterway", "landuse"]) {
    const v = tag(tags, key);
    if (v) out.add(`${key}:${v}`);
  }
  return [...out];
}

export function inferActivities(_primary: string | null, _secondary: string[], tags: Record<string, string>): string[] {
  return inferActivitiesFromOsmTags(tags);
}

export function confidenceFromScore(score: number, warnings: string[]): "high" | "medium" | "low" {
  if (score >= 80 && warnings.length === 0) return "high";
  if (score >= 60) return "medium";
  return "low";
}

export function displayPriorityFromCategory(
  primaryCategory: string | null,
  score: number,
  decision: "spot" | "route"
): { displayPriority: "hero" | "high" | "medium" | "low" | "hidden"; showAtZoom: number } {
  const heroCategories = new Set([
    "waterfall",
    "viewpoint",
    "peak",
    "park",
    "nature_reserve",
    "museum",
    "water",
    "lake",
    "hiking",
    "beach",
    "swimming",
    "swimming_hole",
  ]);
  const highCategories = new Set([
    "cafe",
    "restaurant",
    "ice_cream",
    "wetland",
    "historic",
    "camp_site",
    "picnic_site",
    "bridge",
    "railroad_bridge",
  ]);

  if (score < 45) return { displayPriority: "hidden", showAtZoom: 99 };
  if (primaryCategory && heroCategories.has(primaryCategory)) return { displayPriority: "hero", showAtZoom: 10 };
  if (primaryCategory && highCategories.has(primaryCategory)) return { displayPriority: "high", showAtZoom: 12 };
  if (decision === "route" && score >= 60) return { displayPriority: "medium", showAtZoom: 14 };
  if (score >= 60) return { displayPriority: "medium", showAtZoom: 14 };
  return { displayPriority: "low", showAtZoom: 15 };
}

export {
  DECISION_THRESHOLD,
  hasRealName,
  hasVisitorOverride,
  isChainFastFood,
  isSidewalkOrCrossing,
};
