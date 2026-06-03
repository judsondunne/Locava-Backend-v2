import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { routesLikelySameRoad } from "./inventoryOffroadMerge.js";
import type { MergedOffroadRouteMeta, OffroadMergedConfidence } from "./sources/nationalOffroadSource.types.js";

const SOURCE_PRIORITY: Record<string, number> = {
  vt_vtrans_public_highway_system: 100,
  nh_class_vi_roads: 95,
  me_atv_trails: 90,
  usfs_mvum: 80,
  blm_gtlf: 75,
  osm_offroad: 40,
};

function sourcePriority(sourceId: string): number {
  if (sourceId.startsWith("state_")) return 50;
  return SOURCE_PRIORITY[sourceId] ?? 30;
}

function confidenceForRoute(route: LocavaInventoryRoute, primarySourceId: string): OffroadMergedConfidence {
  if (primarySourceId === "vt_vtrans_public_highway_system" || primarySourceId === "nh_class_vi_roads") {
    return "official_state";
  }
  if (primarySourceId === "usfs_mvum") return "official_federal";
  if (primarySourceId === "blm_gtlf") {
    if (route.offroad?.accessStatus === "limited") return "official_limited";
    return "official_federal";
  }
  if (route.offroad?.offroadConfidence === "explicit" || route.offroad?.offroadConfidence === "strong") {
    return "osm_explicit";
  }
  return "osm_candidate";
}

function routeSourceId(route: LocavaInventoryRoute): string {
  if (route.source === "vtrans_public_highway_system") return "vt_vtrans_public_highway_system";
  if (route.source === "nhdot_legislative_class") return "nh_class_vi_roads";
  if (route.source === "usfs_mvum") return "usfs_mvum";
  if (route.source === "blm_gtlf") return "blm_gtlf";
  if (route.source === "openstreetmap") return "osm_offroad";
  return route.source;
}

function distinctNamedTrails(a: LocavaInventoryRoute, b: LocavaInventoryRoute): boolean {
  const nameA = a.normalizedName?.trim() || a.name.trim().toLowerCase();
  const nameB = b.normalizedName?.trim() || b.name.trim().toLowerCase();
  if (!nameA || !nameB) return false;
  if (nameA === nameB) return false;
  const generic = /^(trail|road|route|segment|mvum|blm)\b/i;
  if (generic.test(nameA) && generic.test(nameB)) return false;
  return nameA.length > 3 && nameB.length > 3 && nameA !== nameB;
}

export type MergeOffroadRoutesResult = {
  routes: LocavaInventoryRoute[];
  mergedCount: number;
  suppressed: string[];
};

export function mergeOffroadRoutesFromSources(input: {
  routes: Array<{ route: LocavaInventoryRoute; sourceId: string }>;
}): MergeOffroadRoutesResult {
  const sorted = [...input.routes].sort(
    (a, b) => sourcePriority(b.sourceId) - sourcePriority(a.sourceId)
  );

  const final: LocavaInventoryRoute[] = [];
  const suppressed: string[] = [];
  let mergedCount = 0;

  for (const candidate of sorted) {
    let merged = false;
    for (let i = 0; i < final.length; i += 1) {
      const existing = final[i]!;
      const existingSourceId = routeSourceId(existing);

      if (candidate.sourceId === existingSourceId && candidate.route.sourceKey === existing.sourceKey) {
        suppressed.push(candidate.route.sourceKey);
        merged = true;
        mergedCount += 1;
        break;
      }

      if (distinctNamedTrails(candidate.route, existing)) continue;

      if (routesLikelySameRoad(candidate.route, existing) || candidate.route.sourceKey === existing.sourceKey) {
        const primarySourceId =
          sourcePriority(candidate.sourceId) >= sourcePriority(existingSourceId)
            ? candidate.sourceId
            : existingSourceId;
        const primary =
          sourcePriority(candidate.sourceId) >= sourcePriority(existingSourceId)
            ? candidate.route
            : existing;
        const secondary =
          sourcePriority(candidate.sourceId) >= sourcePriority(existingSourceId)
            ? existing
            : candidate.route;

        const meta = buildMergedMeta(primary, secondary, primarySourceId);
        final[i] = applyMergedMeta(primary, secondary, meta);
        suppressed.push(secondary.sourceKey);
        merged = true;
        mergedCount += 1;
        break;
      }
    }
    if (!merged) final.push(candidate.route);
  }

  return { routes: final, mergedCount, suppressed };
}

function buildMergedMeta(
  primary: LocavaInventoryRoute,
  secondary: LocavaInventoryRoute,
  primarySourceId: string
): MergedOffroadRouteMeta {
  const sourceKeys = [...new Set([...primary.sourceKeys, ...secondary.sourceKeys])];
  const sourceSignals = [
    ...new Set([...(primary.offroad?.sourceSignals ?? []), ...(secondary.offroad?.sourceSignals ?? [])]),
  ];
  const sourceDatasetNames = [
    ...new Set(
      [primary.sourceDatasetName, secondary.sourceDatasetName].filter((n): n is string => Boolean(n))
    ),
  ];
  const confidence = confidenceForRoute(primary, primarySourceId);

  return {
    primarySourceId,
    sourceDatasetNames,
    sourceSignals,
    sourceKeys,
    sourcePriority: primarySourceId,
    mergedFrom: [secondary.sourceKey],
    confidence,
    accessStatus: primary.offroad?.accessStatus ?? "unknown",
    accessWarnings: [...new Set([...(primary.offroad?.accessWarnings ?? []), ...(secondary.offroad?.accessWarnings ?? [])])],
    legalDisplayLabel: primary.offroad?.legalDisplayLabel ?? "Unmaintained road",
    offroadCategory: primary.offroad?.offroadCategory ?? "unknown",
    publicMapEligibleCandidate:
      confidence === "official_state" ||
      confidence === "official_federal" ||
      confidence === "osm_explicit",
  };
}

function applyMergedMeta(
  primary: LocavaInventoryRoute,
  secondary: LocavaInventoryRoute,
  meta: MergedOffroadRouteMeta
): LocavaInventoryRoute {
  return {
    ...primary,
    sourceKeys: meta.sourceKeys,
    tags: {
      ...secondary.tags,
      ...primary.tags,
      _mergedFrom: meta.mergedFrom.join(","),
      _primarySource: meta.primarySourceId,
      _mergeConfidence: meta.confidence,
    },
    offroad: primary.offroad
      ? {
          ...primary.offroad,
          sourceSignals: meta.sourceSignals,
          accessWarnings: meta.accessWarnings,
        }
      : primary.offroad,
    assemblyWarnings: [...new Set([...(primary.assemblyWarnings ?? []), "merged_offroad_sources"])],
  };
}
