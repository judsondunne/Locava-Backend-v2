import type {
  MapLayerFeature,
  MapLayerRouteFeature,
} from "../../contracts/surfaces/undiscovered-map-layer.contract.js";

function normalizeTrailName(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(trail|path|route|loop)\b/g, "")
    .trim();
}

function mergeKeyForRoute(route: MapLayerRouteFeature): string {
  const osmId = route.osm?.id?.trim();
  const osmType = route.osm?.type?.trim().toLowerCase();
  if (osmType === "relation" && osmId) return `rel:${osmId}`;
  const name = normalizeTrailName(route.title);
  if (name.length >= 4) return `name:${name}`;
  return `id:${route.id}`;
}

function routeLengthScore(route: MapLayerRouteFeature): number {
  const fromMeters = route.routeLengthMeters ?? 0;
  const fromPoints = route.routeSummary.pointCount ?? 0;
  return Math.max(fromMeters, fromPoints * 8);
}

/**
 * Collapse multiple OSM route docs that represent the same named trail/relation into one map feature.
 */
export function mergeRouteFragmentFeatures(features: MapLayerFeature[]): {
  features: MapLayerFeature[];
  mergedRouteFragmentCount: number;
} {
  const routes: MapLayerRouteFeature[] = [];
  const rest: MapLayerFeature[] = [];
  for (const f of features) {
    if (f.featureKind === "route") routes.push(f);
    else rest.push(f);
  }
  if (routes.length <= 1) {
    return { features, mergedRouteFragmentCount: 0 };
  }

  const groups = new Map<string, MapLayerRouteFeature[]>();
  for (const route of routes) {
    const key = mergeKeyForRoute(route);
    const list = groups.get(key) ?? [];
    list.push(route);
    groups.set(key, list);
  }

  const mergedRoutes: MapLayerRouteFeature[] = [];
  let mergedRouteFragmentCount = 0;
  for (const group of groups.values()) {
    if (group.length === 1) {
      mergedRoutes.push(group[0]!);
      continue;
    }
    group.sort((a, b) => routeLengthScore(b) - routeLengthScore(a));
    mergedRoutes.push(group[0]!);
    mergedRouteFragmentCount += group.length - 1;
  }

  return {
    features: [...rest, ...mergedRoutes],
    mergedRouteFragmentCount,
  };
}
