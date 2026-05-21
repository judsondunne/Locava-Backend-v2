export type InventoryOsmClassification = "spot" | "route" | "reject";

export type InventoryOsmClassificationResult = {
  kind: InventoryOsmClassification;
  reason?: string;
  spotCategoryHint?: string;
  routeCategoryHint?: string;
};

type TagMap = Record<string, unknown>;

const SPOT_TAG_RULES: Array<{ keys: string[]; values?: string[]; category?: string }> = [
  { keys: ["tourism"], values: ["viewpoint", "attraction", "museum", "picnic_site", "camp_site", "information"] },
  { keys: ["leisure"], values: ["park", "nature_reserve", "swimming_area", "beach_resort"] },
  { keys: ["natural"], values: ["peak", "hill", "waterfall", "water", "wetland", "wood", "beach", "spring"] },
  { keys: ["water"], values: ["lake", "pond", "river", "reservoir"] },
  { keys: ["waterway"], values: ["river", "stream", "canal"] },
  { keys: ["historic"] },
  { keys: ["heritage"] },
  { keys: ["boundary"], values: ["protected_area", "national_park"] },
  { keys: ["amenity"], values: ["cafe", "restaurant"] },
  { keys: ["place"], values: ["locality", "hamlet", "village", "town"] },
  { keys: ["man_made"], values: ["tower", "observation_tower"] },
  { keys: ["landuse"], values: ["recreation_ground", "forest", "meadow", "conservation"] },
];

const ROUTE_TAG_RULES: Array<{ keys: string[]; values?: string[] }> = [
  { keys: ["route"], values: ["hiking", "foot", "walking", "running", "bicycle"] },
  { keys: ["network"], values: ["lwn", "rwn", "nwn", "iwn"] },
  { keys: ["highway"], values: ["path", "footway", "track", "cycleway", "bridleway", "steps"] },
  { keys: ["foot"], values: ["yes", "designated"] },
  { keys: ["hiking"], values: ["yes", "designated"] },
  { keys: ["bicycle"], values: ["designated", "yes"] },
  { keys: ["trail_visibility"] },
  { keys: ["sac_scale"] },
  { keys: ["mtb:scale"] },
];

const REJECT_HIGHWAY = new Set([
  "residential",
  "service",
  "living_street",
  "unclassified",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
  "motorway",
  "motorway_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
]);

const AREA_SPOT_VALUES = new Set([
  "park",
  "nature_reserve",
  "protected_area",
  "water",
  "wetland",
  "wood",
  "forest",
  "meadow",
  "recreation_ground",
  "conservation",
  "lake",
  "pond",
  "reservoir",
]);

function normalizeTagEntries(tags: TagMap): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(tags)) {
    const normalizedKey = key.trim().toLowerCase();
    if (typeof raw === "string") {
      out.push({ key: normalizedKey, value: raw.trim().toLowerCase() });
      continue;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") out.push({ key: normalizedKey, value: item.trim().toLowerCase() });
      }
    }
  }
  return out;
}

function tagMatches(rule: { keys: string[]; values?: string[] }, entries: Array<{ key: string; value: string }>): boolean {
  for (const entry of entries) {
    if (!rule.keys.includes(entry.key)) continue;
    if (!rule.values || rule.values.includes(entry.value) || rule.values.includes("*")) return true;
    if (rule.values.length === 0) return true;
  }
  return false;
}

function hasNamedTrailContext(entries: Array<{ key: string; value: string }>): boolean {
  return entries.some(
    (entry) =>
      (entry.key === "name" && entry.value.length >= 3) ||
      entry.key === "route" ||
      entry.key === "foot" ||
      entry.key === "hiking" ||
      entry.key === "trail_visibility" ||
      (entry.key === "highway" && ["path", "footway", "track", "cycleway", "bridleway", "steps"].includes(entry.value))
  );
}

export function classifyInventoryOsmObject(input: {
  tags: TagMap;
  geometryKind?: "point" | "line" | "polygon" | "relation";
  closed?: boolean;
  hasName?: boolean;
}): InventoryOsmClassificationResult {
  const entries = normalizeTagEntries(input.tags);
  const highway = entries.find((e) => e.key === "highway")?.value;
  const building = entries.find((e) => e.key === "building")?.value;
  const landuse = entries.find((e) => e.key === "landuse")?.value;

  if (building && building !== "no") {
    return { kind: "reject", reason: "building_polygon" };
  }

  if (highway && REJECT_HIGHWAY.has(highway) && !hasNamedTrailContext(entries)) {
    return { kind: "reject", reason: "generic_road" };
  }

  if (landuse && !AREA_SPOT_VALUES.has(landuse) && !tagMatches({ keys: ["leisure"], values: ["park"] }, entries)) {
    if (!entries.some((e) => SPOT_TAG_RULES.some((rule) => tagMatches(rule, [e])))) {
      return { kind: "reject", reason: "generic_landuse" };
    }
  }

  const isRouteCandidate = ROUTE_TAG_RULES.some((rule) => tagMatches(rule, entries));
  const isSpotCandidate = SPOT_TAG_RULES.some((rule) => tagMatches(rule, entries));

  if (input.geometryKind === "polygon" || (input.closed && input.geometryKind === "line")) {
    if (isSpotCandidate || AREA_SPOT_VALUES.has(landuse ?? "")) {
      return { kind: "spot", spotCategoryHint: "park" };
    }
    if (isRouteCandidate) {
      return { kind: "reject", reason: "closed_way_not_area_spot" };
    }
    return { kind: "reject", reason: "unclassified_polygon" };
  }

  if (input.geometryKind === "line") {
    if (isRouteCandidate) return { kind: "route", routeCategoryHint: "hiking" };
    if (isSpotCandidate && !isRouteCandidate) {
      return { kind: "spot", reason: "line_classified_as_spot_center" };
    }
    if (highway && ["path", "footway", "track", "cycleway", "bridleway", "steps"].includes(highway)) {
      return { kind: "route", routeCategoryHint: "hiking" };
    }
    return { kind: "reject", reason: "unclassified_line" };
  }

  if (input.geometryKind === "relation") {
    const routeTag = entries.find((e) => e.key === "route")?.value;
    const relType = entries.find((e) => e.key === "type")?.value;
    if (routeTag && ["hiking", "foot", "walking", "running", "bicycle"].includes(routeTag)) {
      return { kind: "route", routeCategoryHint: routeTag === "bicycle" ? "biking" : routeTag };
    }
    if (relType === "route") return { kind: "route", routeCategoryHint: "hiking" };
    if (isSpotCandidate) return { kind: "spot" };
    return { kind: "reject", reason: "unclassified_relation" };
  }

  if (isSpotCandidate) return { kind: "spot" };
  if (isRouteCandidate) return { kind: "route", routeCategoryHint: "hiking" };

  if (!input.hasName) {
    return { kind: "reject", reason: "unnamed_unclassified" };
  }

  return { kind: "reject", reason: "unclassified_object" };
}
