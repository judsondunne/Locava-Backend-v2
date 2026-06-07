/**
 * PBF Copier V2 audit — reason codes mapped from existing filter/classifier signals.
 * Does not change acceptance logic; only normalizes reasons for JSON inspection.
 */
import type { PbfQualityFilterKey } from "./pbfCopierV2QualityFilters.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfAuditTagFamily =
  | "amenity"
  | "tourism"
  | "leisure"
  | "shop"
  | "craft"
  | "office"
  | "building"
  | "historic"
  | "natural"
  | "sport"
  | "man_made"
  | "government_civic"
  | "industrial_warehouse"
  | "highway_trail"
  | "other";

const GOVERNMENT_AMENITIES = new Set([
  "townhall",
  "courthouse",
  "police",
  "fire_station",
  "post_office",
  "library",
  "community_centre",
  "social_facility",
  "public_building",
]);

const INDUSTRIAL_BUILDINGS = new Set([
  "industrial",
  "warehouse",
  "factory",
  "manufacture",
  "storage",
  "hangar",
]);

const INDUSTRIAL_LANDUSE = new Set(["industrial", "railway", "commercial"]);

const UTILITY_MAN_MADE = new Set([
  "storage_tank",
  "wastewater_plant",
  "water_works",
  "pipeline",
  "beacon",
  "crane",
  "silo",
  "works",
  "gasometer",
  "surveillance",
  "monitoring_station",
  "mast",
  "tower",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function inferOsmTagFamily(tags: Record<string, string>): PbfAuditTagFamily {
  if (tag(tags, "boundary") === "administrative" || tag(tags, "office") === "government") {
    return "government_civic";
  }
  const amenity = tag(tags, "amenity");
  if (amenity && GOVERNMENT_AMENITIES.has(amenity)) return "government_civic";

  const building = tag(tags, "building");
  if (building && INDUSTRIAL_BUILDINGS.has(building)) return "industrial_warehouse";
  const landuse = tag(tags, "landuse");
  if (landuse && INDUSTRIAL_LANDUSE.has(landuse)) return "industrial_warehouse";
  const manMade = tag(tags, "man_made");
  if (manMade && UTILITY_MAN_MADE.has(manMade)) return "industrial_warehouse";
  if (tag(tags, "power")) return "industrial_warehouse";

  if (tag(tags, "highway") || tag(tags, "route")) return "highway_trail";
  if (tags.amenity?.trim()) return "amenity";
  if (tags.tourism?.trim()) return "tourism";
  if (tags.leisure?.trim()) return "leisure";
  if (tags.shop?.trim()) return "shop";
  if (tags.craft?.trim()) return "craft";
  if (tags.office?.trim()) return "office";
  if (tags.building?.trim()) return "building";
  if (tags.historic?.trim()) return "historic";
  if (tags.natural?.trim()) return "natural";
  if (tags.sport?.trim()) return "sport";
  if (tags.man_made?.trim()) return "man_made";
  return "other";
}

const FILTER_KEY_TO_REJECT_CODES: Partial<Record<PbfQualityFilterKey, string[]>> = {
  infrastructure: ["utility_infrastructure"],
  service_road: ["unsupported_osm_tags"],
  administrative: ["boring_government"],
  railway: ["unsupported_osm_tags"],
  broad_geography: ["unsupported_osm_tags"],
  unnamed_land: ["missing_name"],
  unnamed_path: ["route_too_short", "insufficient_geometry"],
  parking_support_unattached: ["unsupported_osm_tags"],
  tiny_non_destination_amenity: ["failed_quality_filter"],
  non_destination_amenity: ["failed_quality_filter"],
  support_attached: ["unsupported_osm_tags"],
  aerialway_pylon: ["utility_infrastructure"],
  address_only: ["missing_name"],
  unnamed_terrain: ["missing_name"],
  generic_track: ["unsupported_osm_tags"],
  unnamed_piste: ["missing_name"],
  unnamed_aerialway_station: ["missing_name"],
  lift_infrastructure: ["utility_infrastructure"],
  place_label: ["unsupported_osm_tags"],
  school_campus: ["boring_government"],
  place_of_worship: ["failed_quality_filter"],
  generic_lodging: ["failed_quality_filter"],
  resort_lodge: ["failed_quality_filter"],
  generic_retail: ["failed_quality_filter"],
  healthcare: ["failed_quality_filter"],
  golf_micro: ["failed_quality_filter"],
  sports_micro: ["failed_quality_filter"],
  private_pool: ["private_or_access_restricted"],
  landscape_object: ["failed_quality_filter"],
  road_furniture: ["unsupported_osm_tags"],
  bank_atm: ["failed_quality_filter"],
  support_infrastructure: ["utility_infrastructure"],
  public_service: ["boring_government"],
  professional_office: ["boring_government"],
  age_restricted_retail: ["failed_quality_filter"],
  map_junk: ["failed_quality_filter"],
  residential_land: ["unsupported_osm_tags"],
  non_destination_residential: ["unsupported_osm_tags"],
};

export function mapClassifierRejectionToCodes(rejectionReason: string | null | undefined): string[] {
  const reason = (rejectionReason ?? "below_threshold").toLowerCase();
  const codes = new Set<string>();

  if (reason.includes("name") && (reason.includes("missing") || reason.includes("only") || reason.includes("blacklist"))) {
    codes.add("missing_name");
  }
  if (reason.includes("government") || reason.includes("townhall") || reason.includes("admin")) {
    codes.add("boring_government");
  }
  if (
    reason.includes("warehouse") ||
    reason.includes("industrial") ||
    reason.includes("factory") ||
    reason.includes("works")
  ) {
    codes.add("industrial_or_warehouse");
  }
  if (reason.includes("power") || reason.includes("utility") || reason.includes("pipeline") || reason.includes("tower")) {
    codes.add("utility_infrastructure");
  }
  if (reason.includes("private") || reason.includes("access") || reason.includes("restricted")) {
    codes.add("private_or_access_restricted");
  }
  if (reason.includes("geometry") || reason.includes("coordinate")) {
    codes.add("insufficient_geometry");
  }
  if (reason.includes("duplicate")) {
    codes.add("duplicate_candidate");
  }
  if (reason.includes("short") || reason.includes("too_small")) {
    codes.add("route_too_short");
  }
  if (reason.includes("fragment") || reason.includes("segment")) {
    codes.add("route_fragment_without_relation_context");
  }
  if (reason.includes("service") || reason.includes("highway") || reason.includes("unsupported")) {
    codes.add("unsupported_osm_tags");
  }
  if (reason.includes("threshold") || reason.includes("score") || reason.includes("reject")) {
    codes.add("failed_quality_filter");
  }
  if (reason.includes("bbox") || reason.includes("outside")) {
    codes.add("outside_bbox");
  }

  if (codes.size === 0) codes.add("failed_quality_filter");
  return [...codes];
}

export function mapQualityFilterToRejectCodes(
  filteredBy: PbfQualityFilterKey[] | undefined,
  filterReason: string | undefined
): string[] {
  const codes = new Set<string>();
  for (const key of filteredBy ?? []) {
    for (const code of FILTER_KEY_TO_REJECT_CODES[key] ?? ["failed_quality_filter"]) {
      codes.add(code);
    }
  }
  const reason = (filterReason ?? "").toLowerCase();
  if (reason.includes("private")) codes.add("private_or_access_restricted");
  if (reason.includes("warehouse") || reason.includes("industrial")) codes.add("industrial_or_warehouse");
  if (reason.includes("government") || reason.includes("administrative")) codes.add("boring_government");
  if (reason.includes("utility") || reason.includes("power") || reason.includes("pipeline")) {
    codes.add("utility_infrastructure");
  }
  if (reason.includes("unnamed") || reason.includes("missing name")) codes.add("missing_name");
  if (reason.includes("geometry") || reason.includes("short")) codes.add("insufficient_geometry");
  if (codes.size === 0 && filteredBy?.length) codes.add("failed_quality_filter");
  return [...codes];
}

export function mapResidentialRejectCodes(): string[] {
  return ["unsupported_osm_tags", "non_destination_residential"];
}

export function inferAcceptReasonCodes(doc: PbfCopierPreviewDoc): string[] {
  const tags = doc.sourceTagSample ?? {};
  const codes = new Set<string>();

  if (tags.amenity?.trim()) codes.add("amenity_allowed");
  if (tags.tourism?.trim()) codes.add("tourism_allowed");
  if (tags.leisure?.trim()) codes.add("leisure_allowed");
  if (tags.natural?.trim()) codes.add("natural_allowed");
  if (tags.shop?.trim()) codes.add("shop_allowed");
  if (tags.craft?.trim()) codes.add("craft_allowed");

  const name = tags.name?.trim() || tags["name:en"]?.trim();
  if (name) codes.add("has_good_name");
  if (doc.displayName?.trim() && !doc.displayName.startsWith("highway=")) codes.add("has_good_name");

  if (Number.isFinite(doc.lat) && Number.isFinite(doc.lng)) codes.add("has_coordinates");

  if (doc.kind === "unexplored_route") {
    if (tags.route || tags.highway) codes.add("trail_like_way");
    if (doc.osmType === "relation") codes.add("relation_route");
    if (doc.warnings?.includes("v2_hiking_trail_merged")) codes.add("trail_segment_merged");
  }

  if (!doc.filteredOut) codes.add("passes_quality_filter");
  if (doc.warnings?.includes("v2_tag_coverage_only")) codes.add("tag_coverage_rescue");

  return [...codes];
}

export function looksPotentiallyInteresting(tags: Record<string, string>): boolean {
  const family = inferOsmTagFamily(tags);
  if (["tourism", "leisure", "natural", "historic", "shop", "amenity"].includes(family)) {
    const amenity = tag(tags, "amenity");
    if (amenity && GOVERNMENT_AMENITIES.has(amenity)) return false;
    return true;
  }
  if (tag(tags, "route") || tag(tags, "sac_scale") || tag(tags, "trail_visibility")) return true;
  if (tags.name?.trim() && (tag(tags, "highway") === "path" || tag(tags, "highway") === "footway")) return true;
  return false;
}

export function looksPotentiallyBoring(tags: Record<string, string>): boolean {
  const amenity = tag(tags, "amenity");
  const name = tags.name?.trim() || tags["name:en"]?.trim() || "";
  if (
    amenity === "library" &&
    (tag(tags, "library:type") === "public" || /\bpublic library\b/i.test(name))
  ) {
    return false;
  }
  if (amenity === "community_centre" && tag(tags, "community_centre") === "cultural_centre") {
    return false;
  }

  const family = inferOsmTagFamily(tags);
  if (["government_civic", "industrial_warehouse"].includes(family)) return true;

  if (/\b[A-Z]{2,5}-(?:AM|FM|TV)\b/.test(name) || /\btransmission tower\b/i.test(name)) return true;

  const manMade = tag(tags, "man_made");
  if (manMade && ["tower", "mast", "communications_tower", "antenna", "utility_pole"].includes(manMade)) {
    return true;
  }

  return false;
}
