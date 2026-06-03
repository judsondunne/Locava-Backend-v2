import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

const EXPLICIT_OFFROAD_CATEGORIES = new Set(["class4_road", "class6_road", "legal_trail"]);

/** Keep only official class roads / legal trails — drop generic gravel/track OSM noise. */
export function isExplicitOffroadClassRoute(route: LocavaInventoryRoute): boolean {
  const category = route.offroad?.offroadCategory;
  const source = route.source;

  if (source === "vtrans_public_highway_system" || source === "nhdot_legislative_class") {
    return category === "class4_road" || category === "class6_road" || category === "legal_trail";
  }

  if (source === "usfs_mvum") {
    return true;
  }

  if (source === "blm_gtlf") {
    return category !== "forest_road" && category !== "dirt_road";
  }

  if (source === "openstreetmap" || route.tags._primarySource === "osm_offroad") {
    const rc = route.offroad?.roadClassSignals;
    const conf = route.offroad?.offroadConfidence;
    const explicitClass = Boolean(rc?.vtClass4 || rc?.nhClass6 || rc?.legalTrail);
    if (!explicitClass) return false;
    return conf === "explicit" || conf === "strong";
  }

  if (category && EXPLICIT_OFFROAD_CATEGORIES.has(category)) {
    return route.offroad?.offroadConfidence === "explicit" || route.offroad?.offroadConfidence === "strong";
  }

  return false;
}

export function filterRoutesToExplicitOffroadClasses(routes: LocavaInventoryRoute[]): {
  routes: LocavaInventoryRoute[];
  filteredOut: number;
} {
  const kept: LocavaInventoryRoute[] = [];
  let filteredOut = 0;
  for (const route of routes) {
    if (isExplicitOffroadClassRoute(route)) kept.push(route);
    else filteredOut += 1;
  }
  return { routes: kept, filteredOut };
}
