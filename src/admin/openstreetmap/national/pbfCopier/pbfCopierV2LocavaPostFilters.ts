/**
 * Post-grouping Locava filters that need batch context (trails, parks, support distance caps).
 */
import {
  collectNamedTrailLines,
  collectRecreationAreaPoints,
  isNearRecreationArea,
  minDistanceToNamedTrailMeters,
  type NamedTrailLine,
} from "./pbfCopierV2TrailProximity.js";
import {
  isGeographicIslandCapeWithoutContext,
  isGeologicalLabelWithoutVisitorContext,
  isGenericFootwayWithoutTrailContext,
  isSupportAmenityPrimary,
  mergeLocavaFilterMatch,
  pruneDistantSupportMetadata,
  type LocavaPostFilterSummary,
} from "./pbfCopierV2LocavaProductRules.js";
import type { PbfQualityFilteredPreviewDoc } from "./pbfCopierV2QualityFilters.js";
import { haversineMeters, type PbfSupportObjectRef } from "./pbfCopierV2SupportObjects.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type { LocavaPostFilterSummary };

export function emptyLocavaPostFilterSummary(): LocavaPostFilterSummary {
  return {
    hiddenGeologicalLabels: 0,
    hiddenGenericFootways: 0,
    connectorsAttached: 0,
    supportRefsPruned: 0,
    hiddenSupportAmenities: 0,
  };
}

function topCategoryCounts(
  items: PbfCopierPreviewDoc[],
  visible: boolean,
  limit = 12
): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const isVisible = item.filteredOut !== true;
    if (visible !== isVisible) continue;
    const cat = item.primaryCategory || item.primaryActivity || "unknown";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, count]) => ({ category, count }));
}

export function logLocavaFilterValidation(items: PbfCopierPreviewDoc[]): void {
  if (!items.length) return;
  const visibleTop = topCategoryCounts(items, true);
  const hiddenTop = topCategoryCounts(items, false);
  console.info("[pbf-copier-v2] visible primaryCategory top", visibleTop);
  console.info("[pbf-copier-v2] hidden primaryCategory top", hiddenTop);
}

function attachFootwayConnector(
  route: PbfQualityFilteredPreviewDoc,
  footway: PbfQualityFilteredPreviewDoc,
  distanceMeters: number
): void {
  if (!route.supportMetadata) route.supportMetadata = {};
  const list = route.supportMetadata.connectors ?? [];
  const ref: PbfSupportObjectRef = {
    displayName: footway.displayName || "footway",
    lat: footway.lat!,
    lng: footway.lng!,
    osmType: footway.osmType,
    osmId: footway.osmId,
    distanceMeters: Math.round(distanceMeters),
    tags: footway.sourceTagSample ?? {},
    attachReason: "generic footway connector near route",
  };
  list.push(ref);
  route.supportMetadata.connectors = list;
}

function findNearestRouteForFootway(
  footway: PbfQualityFilteredPreviewDoc,
  routes: PbfQualityFilteredPreviewDoc[],
  maxMeters: number
): { route: PbfQualityFilteredPreviewDoc; distanceMeters: number } | null {
  if (footway.lat == null || footway.lng == null) return null;
  let best: { route: PbfQualityFilteredPreviewDoc; distanceMeters: number } | null = null;
  for (const route of routes) {
    const trails: NamedTrailLine[] = route.routeLineCoordinates?.length
      ? [
          {
            osmType: route.osmType,
            osmId: route.osmId,
            displayName: route.displayName || "",
            coordinates: route.routeLineCoordinates,
          },
        ]
      : [];
    const d = minDistanceToNamedTrailMeters(footway.lat, footway.lng, trails);
    if (d > maxMeters) continue;
    if (!best || d < best.distanceMeters) best = { route, distanceMeters: d };
  }
  return best;
}

export function applyLocavaPostGroupingFilters(
  items: PbfQualityFilteredPreviewDoc[],
  summary: LocavaPostFilterSummary = emptyLocavaPostFilterSummary()
): PbfQualityFilteredPreviewDoc[] {
  const trails = collectNamedTrailLines(items);
  const recreationAreas = collectRecreationAreaPoints(items);
  const routes = items.filter(
    (d) => d.kind === "unexplored_route" && !d.filteredOut && d.routeLineCoordinates?.length
  );

  const updated = items.map((doc) => {
    let next: PbfQualityFilteredPreviewDoc = { ...doc };

    if (!next.filteredOut) {
      const pruned = pruneDistantSupportMetadata(next);
      if (pruned.pruned > 0) {
        summary.supportRefsPruned += pruned.pruned;
        next = pruned.doc;
      }
    }

    if (!next.filteredOut && isSupportAmenityPrimary(next)) {
      if (!next.attachedTo && !next.destinationGroupId) {
        next = mergeLocavaFilterMatch(next, {
          reason: "support amenity, not primary destination",
        });
        summary.hiddenSupportAmenities += 1;
      }
    }

    if (!next.filteredOut && isGeographicIslandCapeWithoutContext(next, trails, recreationAreas)) {
      next = mergeLocavaFilterMatch(next, {
        reason: "geographic label without clear visitor context",
      });
    }

    if (!next.filteredOut && isGeologicalLabelWithoutVisitorContext(next, trails, recreationAreas)) {
      next = mergeLocavaFilterMatch(next, {
        reason: "geological label without clear visitor/trail context",
      });
      summary.hiddenGeologicalLabels += 1;
    }

    if (!next.filteredOut && isGenericFootwayWithoutTrailContext(next, trails, recreationAreas)) {
      const nearest = findNearestRouteForFootway(next, routes, 120);
      if (nearest) {
        attachFootwayConnector(nearest.route, next, nearest.distanceMeters);
        next = mergeLocavaFilterMatch(next, {
          reason: "generic footway/connector, not primary spot",
        });
        summary.connectorsAttached += 1;
        summary.hiddenGenericFootways += 1;
      } else {
        next = mergeLocavaFilterMatch(next, {
          reason: "generic footway/connector, not primary spot",
        });
        summary.hiddenGenericFootways += 1;
      }
    }

    return next;
  });

  logLocavaFilterValidation(updated);
  return updated;
}
