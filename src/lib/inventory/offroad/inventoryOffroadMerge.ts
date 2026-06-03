import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { bboxIntersects } from "../inventoryBbox.js";
import { endpointsMatch } from "../trails/inventoryTrailGraph.js";

export function routeIntersectsBbox(route: LocavaInventoryRoute, bbox: InventoryBbox): boolean {
  if (bboxIntersects(route.bbox, bbox)) return true;
  const coords = route.coordinates ?? route.segments?.flat() ?? [];
  return coords.some((c) => c.lat >= bbox.minLat && c.lat <= bbox.maxLat && c.lng >= bbox.minLng && c.lng <= bbox.maxLng);
}

function routeCoords(route: LocavaInventoryRoute): Array<{ lat: number; lng: number }> {
  return route.segments?.flat() ?? route.coordinates ?? [];
}

function normalizedRouteName(route: LocavaInventoryRoute): string {
  return route.normalizedName?.trim() || route.name.trim().toLowerCase();
}

export function routesLikelySameRoad(osm: LocavaInventoryRoute, vtrans: LocavaInventoryRoute): boolean {
  const osmName = normalizedRouteName(osm);
  const vtransName = normalizedRouteName(vtrans);
  if (osmName && vtransName && osmName === vtransName) return true;

  const a = routeCoords(osm);
  const b = routeCoords(vtrans);
  if (a.length < 2 || b.length < 2) return false;

  const aStart = a[0]!;
  const aEnd = a[a.length - 1]!;
  const bStart = b[0]!;
  const bEnd = b[b.length - 1]!;

  return (
    endpointsMatch(aStart, bStart, 25) ||
    endpointsMatch(aStart, bEnd, 25) ||
    endpointsMatch(aEnd, bStart, 25) ||
    endpointsMatch(aEnd, bEnd, 25)
  );
}

export function mergeVtransPreferringOfficial(input: {
  osmRoute: LocavaInventoryRoute;
  vtransRoute: LocavaInventoryRoute;
}): LocavaInventoryRoute {
  const mergedKeys = [...new Set([...input.vtransRoute.sourceKeys, ...input.osmRoute.sourceKeys])];
  const mergedTags = { ...input.osmRoute.tags, ...input.vtransRoute.tags };
  const supplementalSignals = [...(input.vtransRoute.offroad?.sourceSignals ?? []), "osm_supplemental"];
  if (!supplementalSignals.includes("osm_supplemental")) supplementalSignals.push("osm_supplemental");

  return {
    ...input.vtransRoute,
    sourceKeys: mergedKeys,
    tags: mergedTags,
    offroad: input.vtransRoute.offroad
      ? {
          ...input.vtransRoute.offroad,
          sourceSignals: supplementalSignals,
        }
      : input.vtransRoute.offroad,
    assemblyWarnings: [...new Set([...(input.vtransRoute.assemblyWarnings ?? []), "merged_with_osm_offroad"])],
  };
}

export type MergeOsmVtransResult = {
  routes: LocavaInventoryRoute[];
  duplicatesMergedWithOsm: number;
  mergedPairs: Array<{ vtransSourceKey: string; osmSourceKey: string }>;
};

export function mergeOsmAndVtransOffroadRoutes(input: {
  osmRoutes: LocavaInventoryRoute[];
  vtransRoutes: LocavaInventoryRoute[];
  bbox: InventoryBbox;
}): MergeOsmVtransResult {
  const vtransInBbox = input.vtransRoutes.filter((r) => routeIntersectsBbox(r, input.bbox));
  const osmPool = [...input.osmRoutes];
  const mergedPairs: MergeOsmVtransResult["mergedPairs"] = [];
  const finalRoutes: LocavaInventoryRoute[] = [];
  const consumedOsm = new Set<string>();

  for (const vtrans of vtransInBbox) {
    const matchIdx = osmPool.findIndex((osm) => !consumedOsm.has(osm.sourceKey) && routesLikelySameRoad(osm, vtrans));
    if (matchIdx >= 0) {
      const osm = osmPool[matchIdx]!;
      consumedOsm.add(osm.sourceKey);
      finalRoutes.push(mergeVtransPreferringOfficial({ osmRoute: osm, vtransRoute: vtrans }));
      mergedPairs.push({ vtransSourceKey: vtrans.sourceKey, osmSourceKey: osm.sourceKey });
    } else {
      finalRoutes.push(vtrans);
    }
  }

  for (const osm of osmPool) {
    if (!consumedOsm.has(osm.sourceKey)) finalRoutes.push(osm);
  }

  return {
    routes: finalRoutes.sort((a, b) => b.distanceMeters - a.distanceMeters),
    duplicatesMergedWithOsm: mergedPairs.length,
    mergedPairs,
  };
}

/** @deprecated use mergeOsmAndVtransOffroadRoutes */
export function mergeStateOffroadRoutes(input: {
  osmRoutes: LocavaInventoryRoute[];
  stateRoutes: LocavaInventoryRoute[];
  bbox: InventoryBbox;
}): LocavaInventoryRoute[] {
  return mergeOsmAndVtransOffroadRoutes({
    osmRoutes: input.osmRoutes,
    vtransRoutes: input.stateRoutes,
    bbox: input.bbox,
  }).routes;
}
