import type { LocavaClassifierConfig, LocavaClassifierFeatureInput } from "./inventoryLocavaTypes.js";

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
  primaryCategory: string | null;
  secondaryCategories: string[];
  activities: string[];
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
  if (hasTag(tags, "leisure", "park") || hasTag(tags, "leisure", "nature_reserve")) return true;
  if (hasTag(tags, "natural", "waterfall") || hasTag(tags, "natural", "peak")) return true;
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

  if (feature.geometryKind === "line" && highway && !hasVisitorOverride(tags)) return false;

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
  if (natural === "peak") addScore(breakdown, 65, "natural_peak", "spot");
  if (natural === "hill") addScore(breakdown, 55, "natural_hill", "spot");
  if (leisure === "park") addScore(breakdown, 60, "leisure_park", "spot");
  if (leisure === "nature_reserve") addScore(breakdown, 65, "leisure_nature_reserve", "spot");
  if (tag(tags, "boundary") === "protected_area") addScore(breakdown, 60, "boundary_protected_area", "spot");
  if (tourism === "picnic_site") addScore(breakdown, 55, "tourism_picnic_site", "spot");
  if (tourism === "camp_site") addScore(breakdown, 55, "tourism_camp_site", "spot");
  if (natural === "beach") addScore(breakdown, 55, "natural_beach", "spot");
  if (leisure === "swimming_area") addScore(breakdown, 50, "leisure_swimming_area", "spot");

  if (natural === "wetland") {
    if (named || isProtectedOrRecreationContext(tags)) addScore(breakdown, 50, "natural_wetland_named_or_rec", "spot");
    else if (config.natureMode === "broad_natural") addScore(breakdown, 30, "natural_wetland_broad", "spot");
    else addNegative(breakdown, -30, "unnamed_wetland_fragment", "spot");
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
    if (named || isProtectedOrRecreationContext(tags)) addScore(breakdown, 35, "natural_wood_named_or_protected", "spot");
    else if (config.natureMode === "broad_natural") addScore(breakdown, 20, "natural_wood_broad", "spot");
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

  // Category mapping
  breakdown.primaryCategory = inferPrimaryCategory(tags, breakdown);
  breakdown.secondaryCategories = inferSecondaryCategories(tags);
  breakdown.activities = inferActivities(breakdown.primaryCategory, breakdown.secondaryCategories, tags);

  // Visitor override on building
  if (building && breakdown.visitorOverride) {
    breakdown.hardReject = false;
    breakdown.warnings.push("building_overridden_by_visitor_amenity");
  }

  return breakdown;
}

function inferPrimaryCategory(tags: Record<string, string>, breakdown: LocavaScoreBreakdown): string | null {
  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return "waterfall";
  if (tag(tags, "tourism") === "viewpoint") return "viewpoint";
  if (tag(tags, "natural") === "peak") return "peak";
  if (tag(tags, "natural") === "hill") return "hill";
  if (tag(tags, "leisure") === "park") return "park";
  if (tag(tags, "leisure") === "nature_reserve") return "nature_reserve";
  if (tag(tags, "natural") === "wetland") return "wetland";
  if (tag(tags, "natural") === "water") return "water";
  if (tag(tags, "amenity") === "ice_cream") return "ice_cream";
  if (tag(tags, "amenity") === "cafe") return "cafe";
  if (tag(tags, "amenity") === "restaurant") return "restaurant";
  if (tag(tags, "amenity") === "fast_food") return "fast_food";
  if (tag(tags, "landuse") === "grave_yard" || tag(tags, "amenity") === "grave_yard" || tag(tags, "historic") === "cemetery") return "grave_yard";
  if (tag(tags, "tourism") === "museum") return "museum";
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
  if (breakdown.spotScore >= breakdown.routeScore) return tag(tags, "natural") ?? tag(tags, "amenity") ?? tag(tags, "tourism") ?? null;
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

function inferActivities(primary: string | null, secondary: string[], tags: Record<string, string>): string[] {
  const acts = new Set<string>();
  if (!primary) return [];
  if (["waterfall", "viewpoint", "peak", "hill", "park", "nature_reserve", "wetland", "water"].includes(primary)) {
    acts.add("hiking");
    acts.add("scenic");
  }
  if (["cafe", "restaurant", "ice_cream", "fast_food", "marketplace"].includes(primary)) acts.add("food");
  if (primary === "path" || primary === "footway" || primary === "track" || primary === "hiking" || primary === "walking") {
    acts.add("hiking");
  }
  if (tag(tags, "route") === "bicycle" || tag(tags, "highway") === "cycleway") acts.add("biking");
  if (secondary.some((s) => s.includes("swimming"))) acts.add("swimming");
  return [...acts];
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
  ]);
  const highCategories = new Set(["cafe", "restaurant", "ice_cream", "wetland", "historic", "camp_site", "picnic_site"]);

  if (score < 45) return { displayPriority: "hidden", showAtZoom: 99 };
  if (primaryCategory && heroCategories.has(primaryCategory)) return { displayPriority: "hero", showAtZoom: 10 };
  if (primaryCategory && highCategories.has(primaryCategory)) return { displayPriority: "high", showAtZoom: 12 };
  if (decision === "route" && score >= 60) return { displayPriority: "medium", showAtZoom: 14 };
  if (score >= 60) return { displayPriority: "medium", showAtZoom: 14 };
  return { displayPriority: "low", showAtZoom: 15 };
}

export { DECISION_THRESHOLD, hasRealName, hasVisitorOverride, isChainFastFood, isSidewalkOrCrossing };
