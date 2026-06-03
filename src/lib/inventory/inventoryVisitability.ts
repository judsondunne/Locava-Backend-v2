/**
 * Principled visitor / public-destination signal scoring for OSM features.
 * Used by the Locava classifier to avoid admin centroids of huge protected areas
 * while still accepting real visitable destinations.
 */

export type OsmObjectKind =
  | "food_drink"
  | "viewpoint_destination"
  | "water_destination"
  | "park_destination"
  | "protected_area"
  | "natural_area"
  | "trail_route"
  | "historic_destination"
  | "camp_recreation"
  | "infrastructure"
  | "generic";

export type VisitabilityTier = "strong" | "moderate" | "weak" | "none";

export type VisitabilityEvaluation = {
  score: number;
  signals: string[];
  objectKind: OsmObjectKind;
  isLargeNaturalOrProtectedArea: boolean;
  hasStrongDestinationSignal: boolean;
  hasAccessOrRecreationSignal: boolean;
  hasWeakNatureOnlySignal: boolean;
  visitabilityTier: VisitabilityTier;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string, value?: string): boolean {
  const v = tag(tags, key);
  if (v == null) return false;
  if (value == null) return true;
  return v === value.toLowerCase();
}

const STRONG_TOURISM = new Set([
  "viewpoint",
  "attraction",
  "museum",
  "picnic_site",
  "camp_site",
  "information",
  "artwork",
  "zoo",
  "theme_park",
]);

const STRONG_AMENITY = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "ice_cream",
  "marketplace",
  "theatre",
  "cinema",
  "arts_centre",
]);

const RECREATION_LEISURE = new Set([
  "park",
  "nature_reserve",
  "recreation_ground",
  "playground",
  "picnic_table",
  "sports_centre",
  "pitch",
  "swimming_area",
  "slipway",
  "marina",
  "track",
  "golf_course",
  "ski_resort",
]);

const WEAK_NATURAL = new Set(["wood", "wetland", "scrub", "grassland", "heath", "moor", "tree", "fell", "hill"]);

const STRONG_NATURAL = new Set(["waterfall", "beach", "cave_entrance", "spring", "cliff", "arch", "geyser"]);

const TRAIL_HIGHWAYS = new Set(["path", "footway", "cycleway", "bridleway", "steps", "track"]);
const TRAIL_ROUTES = new Set(["hiking", "foot", "walking", "running", "bicycle", "mtb", "ski", "piste"]);

function inferObjectKind(tags: Record<string, string>): OsmObjectKind {
  const amenity = tag(tags, "amenity");
  if (amenity && STRONG_AMENITY.has(amenity)) return "food_drink";
  const tourism = tag(tags, "tourism");
  if (tourism === "viewpoint" || tourism === "attraction" || tourism === "museum") return "viewpoint_destination";
  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return "water_destination";
  if (tag(tags, "natural") === "beach" || tag(tags, "leisure") === "swimming_area") return "water_destination";
  if (tag(tags, "route") || (tag(tags, "highway") && TRAIL_HIGHWAYS.has(tag(tags, "highway")!))) return "trail_route";
  if (tag(tags, "historic") || tag(tags, "heritage")) return "historic_destination";
  if (tourism === "camp_site" || tag(tags, "leisure") === "camp_site") return "camp_recreation";
  if (tag(tags, "boundary") === "protected_area" || tag(tags, "leisure") === "nature_reserve") return "protected_area";
  if (tag(tags, "natural") || tag(tags, "landuse") === "forest" || tag(tags, "landuse") === "meadow") return "natural_area";
  if (tag(tags, "leisure") === "park" || tag(tags, "landuse") === "recreation_ground") return "park_destination";
  if (amenity === "parking" || tag(tags, "building")) return "infrastructure";
  return "generic";
}

function isLargeNaturalOrProtectedArea(tags: Record<string, string>, objectKind: OsmObjectKind): boolean {
  if (objectKind === "protected_area") return true;
  if (objectKind === "natural_area" && !STRONG_NATURAL.has(tag(tags, "natural") ?? "")) return true;
  if (tag(tags, "boundary") === "protected_area") return true;
  if (tag(tags, "leisure") === "nature_reserve" && !hasStrongDestinationTags(tags)) return true;
  if (tag(tags, "landuse") === "forest" || tag(tags, "landuse") === "conservation") return true;
  return false;
}

function hasStrongDestinationTags(tags: Record<string, string>): boolean {
  const tourism = tag(tags, "tourism");
  if (tourism && STRONG_TOURISM.has(tourism)) return true;
  const amenity = tag(tags, "amenity");
  if (amenity && STRONG_AMENITY.has(amenity)) return true;
  const leisure = tag(tags, "leisure");
  if (leisure && RECREATION_LEISURE.has(leisure)) {
    if (leisure === "park" && tag(tags, "boundary") === "protected_area" && !hasAccessOrRecreationTags(tags)) {
      return false;
    }
    return true;
  }
  const natural = tag(tags, "natural");
  if (natural && STRONG_NATURAL.has(natural)) return true;
  if (tag(tags, "waterway") === "waterfall") return true;
  if (tag(tags, "historic") === "covered_bridge" || tag(tags, "bridge") === "covered") return true;
  if (tag(tags, "historic")) return true;
  if (tag(tags, "route") && TRAIL_ROUTES.has(tag(tags, "route")!)) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "information") === "trailhead" || tag(tags, "information") === "guidepost") return true;
  return false;
}

function hasAccessOrRecreationTags(tags: Record<string, string>): boolean {
  const access = tag(tags, "access");
  if (access === "yes" || access === "public" || access === "permissive" || access === "designated") return true;
  for (const mode of ["foot", "bicycle", "horse", "ski", "canoe"]) {
    const v = tag(tags, mode);
    if (v === "yes" || v === "designated" || v === "permissive") return true;
  }
  const route = tag(tags, "route");
  if (route && TRAIL_ROUTES.has(route)) return true;
  if (tag(tags, "sac_scale") || tag(tags, "trail_visibility")) return true;
  if (tag(tags, "hiking") === "yes" || tag(tags, "fishing") === "yes") return true;
  if (tag(tags, "sport") === "fishing" || tag(tags, "sport") === "climbing") return true;
  if (tag(tags, "amenity") === "parking" && (tag(tags, "parking") === "trailhead" || tag(tags, "hiking") === "yes")) {
    return true;
  }
  if (tag(tags, "tourism") === "information") return true;
  if (tag(tags, "highway") && TRAIL_HIGHWAYS.has(tag(tags, "highway")!) && tag(tags, "name")) return true;
  return false;
}

function hasWeakNatureOnly(tags: Record<string, string>): boolean {
  const natural = tag(tags, "natural");
  if (natural && WEAK_NATURAL.has(natural)) return true;
  if (tag(tags, "landuse") === "forest" || tag(tags, "landuse") === "meadow") return true;
  if (tag(tags, "boundary") === "protected_area" && !hasAccessOrRecreationTags(tags) && !hasStrongDestinationTags(tags)) {
    return true;
  }
  return false;
}

function tierFromScore(score: number): VisitabilityTier {
  if (score >= 55) return "strong";
  if (score >= 35) return "moderate";
  if (score >= 15) return "weak";
  return "none";
}

export function evaluateOsmVisitability(
  tags: Record<string, string>,
  options?: { name?: string | null; geometryKind?: string }
): VisitabilityEvaluation {
  const signals: string[] = [];
  let score = 0;
  const objectKind = inferObjectKind(tags);

  if (hasStrongDestinationTags(tags)) {
    score += 45;
    signals.push("strong_destination");
  }
  if (hasAccessOrRecreationTags(tags)) {
    score += 35;
    signals.push("access_or_recreation");
  }
  if (tag(tags, "wikidata") || tag(tags, "wikipedia")) {
    score += 8;
    signals.push("notability_metadata");
  }
  if (options?.name?.trim() && options.name.trim().length >= 3) {
    score += 10;
    signals.push("named");
  }
  if (objectKind === "trail_route" && options?.geometryKind === "line") {
    score += 25;
    signals.push("line_trail_geometry");
  }
  if (objectKind === "food_drink") {
    score += 40;
    signals.push("food_drink_destination");
  }

  const large = isLargeNaturalOrProtectedArea(tags, objectKind);
  const weakNature = hasWeakNatureOnly(tags);
  if (large && !hasStrongDestinationTags(tags) && !hasAccessOrRecreationTags(tags)) {
    score -= 50;
    signals.push("large_area_no_visitor_signal");
  }
  if (weakNature && !hasAccessOrRecreationTags(tags) && objectKind !== "food_drink") {
    score -= 25;
    signals.push("weak_nature_only");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    signals,
    objectKind,
    isLargeNaturalOrProtectedArea: large,
    hasStrongDestinationSignal: hasStrongDestinationTags(tags),
    hasAccessOrRecreationSignal: hasAccessOrRecreationTags(tags),
    hasWeakNatureOnlySignal: weakNature,
    visitabilityTier: tierFromScore(score),
  };
}

export function requiresVisitabilityForAcceptance(tags: Record<string, string>): boolean {
  if (tag(tags, "natural") === "peak" || tag(tags, "natural") === "hill") return false;
  const kind = inferObjectKind(tags);
  if (kind === "food_drink" || kind === "viewpoint_destination" || kind === "water_destination" || kind === "historic_destination") {
    return false;
  }
  if (kind === "trail_route") return false;
  return (
    tag(tags, "boundary") === "protected_area" ||
    tag(tags, "leisure") === "nature_reserve" ||
    tag(tags, "natural") === "wetland" ||
    tag(tags, "natural") === "wood" ||
    tag(tags, "natural") === "scrub" ||
    tag(tags, "landuse") === "forest" ||
    (tag(tags, "leisure") === "park" && tag(tags, "boundary") === "protected_area")
  );
}

export function visitabilityBlocksSpotAcceptance(
  tags: Record<string, string>,
  evaluation: VisitabilityEvaluation
): { reject: boolean; reason?: string } {
  if (!requiresVisitabilityForAcceptance(tags)) return { reject: false };
  if (evaluation.hasStrongDestinationSignal || evaluation.hasAccessOrRecreationSignal) {
    if (evaluation.visitabilityTier === "none") return { reject: true, reason: "large_natural_area_no_visitor_signal" };
    return { reject: false };
  }
  if (evaluation.isLargeNaturalOrProtectedArea || evaluation.hasWeakNatureOnlySignal) {
    return { reject: true, reason: "large_natural_area_no_visitor_signal" };
  }
  return { reject: false };
}
