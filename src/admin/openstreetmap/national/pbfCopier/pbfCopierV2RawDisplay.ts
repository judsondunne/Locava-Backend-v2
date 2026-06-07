/**
 * PBF Copier V2 raw OSM — display post-processing.
 *
 * - Drop residential-only homes (building=house etc. with no destination tags).
 * - Merge named hiking trail segments into one stitched line + one trailhead pin.
 * - Other line geometry stays on map as lines without route markers.
 */
import {
  clusterTrailSegmentsByEndpoints,
  distanceMetersForCoords,
  stitchSegments,
  TRAIL_MERGE_ENDPOINT_TOLERANCE_METERS,
  type TrailPoint,
} from "../../../../lib/inventory/trails/inventoryTrailGraph.js";
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { enrichRoutePreviewDoc } from "./pbfCopierV2RouteEnrichment.js";
import {
  buildUnnamedHikingTrailContext,
  isUnnamedRealHikingTrailDoc,
  promoteUnnamedHikingTrailDoc,
} from "./pbfCopierV2DestinationQuality.js";

const ROUTE_LINE_POINT_CAP = 8000;

export const HIKING_TRAIL_LINE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
] as const;

const RESIDENTIAL_BUILDING_VALUES = new Set([
  "house",
  "residential",
  "detached",
  "semi",
  "semidetached_house",
  "terrace",
  "bungalow",
  "cabin",
  "hut",
  "static_caravan",
  "mobile_home",
  "apartments",
  "dormitory",
]);

const DESTINATION_TAG_KEYS = [
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "historic",
  "natural",
  "man_made",
  "office",
  "craft",
  "healthcare",
  "sport",
  "railway",
  "aeroway",
  "waterway",
  "landuse",
] as const;

const METADATA_ONLY_KEYS = new Set([
  "building",
  "addr:housenumber",
  "addr:street",
  "addr:city",
  "addr:postcode",
  "addr:state",
  "addr:country",
  "source",
  "name",
  "ref:vcgi:esiteid",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

function downsampleLine(points: TrailPoint[], maxPoints: number): TrailPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: TrailPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** True when OSM object is only a private residence — safe to hide on coverage map. */
export function isResidentialHomeOnly(tags: Record<string, string>): boolean {
  const building = tag(tags, "building");
  if (!building) return false;

  for (const key of DESTINATION_TAG_KEYS) {
    if (tags[key]?.trim()) return false;
  }

  if (RESIDENTIAL_BUILDING_VALUES.has(building)) return true;

  if (building === "yes") {
    const meaningful = Object.keys(tags).filter((k) => !METADATA_ONLY_KEYS.has(k));
    if (meaningful.length === 0) return true;
    if (meaningful.length === 1 && meaningful[0] === "building") return true;
  }

  return false;
}

export function isHikingTrailPreviewDoc(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind !== "unexplored_route") return false;
  const tags = doc.sourceTagSample ?? {};
  const highway = tag(tags, "highway");
  if (tag(tags, "footway") === "sidewalk" || tag(tags, "foot") === "no") return false;
  if (tag(tags, "bicycle") === "designated" && !tag(tags, "sac_scale") && highway === "cycleway") {
    return false;
  }
  if (tag(tags, "sac_scale") || tag(tags, "trail_visibility")) return true;
  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking"].includes(route)) return true;
  if (highway === "path" || highway === "steps" || highway === "bridleway") return true;
  if (highway === "footway") return true;
  if (highway === "track") {
    const foot = tag(tags, "foot");
    if (
      foot === "designated" ||
      foot === "yes" ||
      foot === "permissive" ||
      tag(tags, "hiking") === "yes" ||
      tag(tags, "sac_scale")
    ) {
      return true;
    }
  }
  return false;
}

function isNamedTrailDoc(doc: PbfCopierPreviewDoc): boolean {
  const raw = (doc.displayName || "").trim().toLowerCase();
  if (!raw || raw.startsWith("highway=") || raw.startsWith("osm way/") || raw.startsWith("osm node/")) {
    return false;
  }
  const key = normalizePreviewDisplayName(doc.displayName);
  if (!key) return false;
  if (key.startsWith("highway ") || key.startsWith("osm ")) return false;
  if (!hasOsmNameTag(doc.sourceTagSample ?? {})) return false;
  return true;
}

export function hikingTrailColorForName(displayName: string): string {
  const key = normalizePreviewDisplayName(displayName) || displayName;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % HIKING_TRAIL_LINE_COLORS.length;
  return HIKING_TRAIL_LINE_COLORS[idx]!;
}

export function mergeHikingTrailPreviewDocs(segments: PbfCopierPreviewDoc[]): PbfCopierPreviewDoc {
  const lines = segments
    .map((s) => s.routeLineCoordinates ?? [])
    .filter((line) => line.length >= 2) as TrailPoint[][];
  const joinMultiplier = 10;
  const maxGap = TRAIL_MERGE_ENDPOINT_TOLERANCE_METERS * joinMultiplier;
  const clusters = clusterTrailSegmentsByEndpoints(lines, maxGap);
  let stitched = stitchSegments(lines, {
    endpointToleranceMeters: TRAIL_MERGE_ENDPOINT_TOLERANCE_METERS,
    maxJoinDistanceMultiplier: joinMultiplier,
  });
  if (!stitched.stitched && clusters.length > 1) {
    let best = stitched;
    let bestLen = 0;
    for (const cluster of clusters) {
      const attempt = stitchSegments(cluster, {
        endpointToleranceMeters: TRAIL_MERGE_ENDPOINT_TOLERANCE_METERS,
        maxJoinDistanceMultiplier: joinMultiplier,
      });
      const len = distanceMetersForCoords(attempt.coordinates);
      if (len > bestLen) {
        bestLen = len;
        best = attempt;
      }
    }
    stitched = best;
  }
  const base = segments[0]!;
  const displayName = base.displayName;
  const color = hikingTrailColorForName(displayName);

  let routeLineCoordinates: TrailPoint[] | undefined;
  let routeLineSegments: TrailPoint[][] | undefined;

  if (stitched.stitched && stitched.coordinates.length >= 2) {
    routeLineCoordinates = downsampleLine(stitched.coordinates, ROUTE_LINE_POINT_CAP);
  } else if (stitched.segments.length > 0) {
    routeLineSegments = stitched.segments
      .filter((s) => s.length >= 2)
      .map((s) => downsampleLine(s, ROUTE_LINE_POINT_CAP));
    routeLineCoordinates = routeLineSegments[0];
  } else {
    routeLineCoordinates = lines[0] ? downsampleLine(lines[0], ROUTE_LINE_POINT_CAP) : undefined;
  }

  const anchor =
    routeLineCoordinates && routeLineCoordinates.length > 0
      ? routeLineCoordinates[0]!
      : { lat: base.lat, lng: base.lng };

  const warnings = (base.warnings ?? []).filter((w) => w !== "v2_raw_osm_unfiltered");
  warnings.push("v2_hiking_trail_merged");

  return {
    ...base,
    id: `hiking:${normalizePreviewDisplayName(displayName) || base.id}`,
    displayName,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking",
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    sourceKeys: segments.flatMap((s) => s.sourceKeys),
    sourceIds: segments.flatMap((s) => s.sourceIds),
    routeLineCoordinates,
    routeLineSegments,
    routeLineColor: color,
    hasRouteGeometry: Boolean(
      (routeLineCoordinates && routeLineCoordinates.length >= 2) ||
        (routeLineSegments && routeLineSegments.some((s) => s.length >= 2))
    ),
    geometryPointCount: routeLineCoordinates?.length ?? routeLineSegments?.[0]?.length ?? 0,
    warnings,
  };
}

export type RawOsmDisplayPostProcessResult = {
  items: PbfCopierPreviewDoc[];
  residentialHomesFiltered: number;
  hikingTrailGroupsMerged: number;
  hikingTrailSegmentsCollapsed: number;
  unnamedHikingTrailsIncluded: number;
};

export function postProcessRawOsmPreviewDocs(docs: PbfCopierPreviewDoc[]): RawOsmDisplayPostProcessResult {
  const spots: PbfCopierPreviewDoc[] = [];
  const hikingByName = new Map<string, PbfCopierPreviewDoc[]>();
  const unnamedHikingRoutes: PbfCopierPreviewDoc[] = [];
  const lineOnlyRoutes: PbfCopierPreviewDoc[] = [];
  let residentialHomesFiltered = 0;
  let hikingTrailSegmentsCollapsed = 0;
  let unnamedHikingTrailsIncluded = 0;

  const trailContext = buildUnnamedHikingTrailContext(docs);

  for (const doc of docs) {
    if (doc.kind === "unexplored_spot") {
      if (isResidentialHomeOnly(doc.sourceTagSample ?? {})) {
        residentialHomesFiltered += 1;
        continue;
      }
      spots.push(doc);
      continue;
    }

    if (!isHikingTrailPreviewDoc(doc)) {
      lineOnlyRoutes.push({
        ...doc,
        warnings: [...(doc.warnings ?? []), "v2_line_no_marker"],
      });
      continue;
    }

    if (!isNamedTrailDoc(doc)) {
      if (isUnnamedRealHikingTrailDoc(doc, trailContext)) {
        unnamedHikingRoutes.push(promoteUnnamedHikingTrailDoc(doc, trailContext));
        unnamedHikingTrailsIncluded += 1;
      } else {
        lineOnlyRoutes.push({
          ...doc,
          warnings: [...(doc.warnings ?? []), "v2_line_no_marker"],
        });
      }
      continue;
    }

    const key = normalizePreviewDisplayName(doc.displayName);
    const bucket = hikingByName.get(key) ?? [];
    bucket.push(doc);
    hikingByName.set(key, bucket);
  }

  const mergedHiking: PbfCopierPreviewDoc[] = [];
  for (const bucket of hikingByName.values()) {
    hikingTrailSegmentsCollapsed += Math.max(0, bucket.length - 1);
    mergedHiking.push(mergeHikingTrailPreviewDocs(bucket));
  }

  const enrichedLineOnly = lineOnlyRoutes.map((doc) =>
    enrichRoutePreviewDoc(enrichHikingTrailLineRoute(doc))
  );

  const mergedEnriched = mergedHiking.map(enrichRoutePreviewDoc);
  const unnamedEnriched = unnamedHikingRoutes.map((doc) =>
    enrichRoutePreviewDoc(enrichHikingTrailLineRoute(doc))
  );

  return {
    items: [...spots, ...mergedEnriched, ...unnamedEnriched, ...enrichedLineOnly],
    residentialHomesFiltered,
    hikingTrailGroupsMerged: mergedHiking.length,
    hikingTrailSegmentsCollapsed,
    unnamedHikingTrailsIncluded,
  };
}

/** Line-only hiking segments: stable color + trailhead anchor for map (named merges already handled). */
export function enrichHikingTrailLineRoute(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (doc.kind !== "unexplored_route") return doc;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return doc;
  if (!isHikingTrailPreviewDoc(doc)) return doc;

  const coords =
    doc.routeLineCoordinates ??
    doc.routeLineSegments?.find((segment) => segment.length >= 2);
  if (!coords || coords.length < 2) return doc;

  const anchor = coords[0]!;
  const colorKey =
    normalizePreviewDisplayName(doc.displayName) || `osm/${doc.osmType ?? "way"}/${doc.osmId ?? 0}`;
  const color = hikingTrailColorForName(colorKey);

  return {
    ...doc,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: doc.routeMarkerCoordinate ?? anchor,
    routeLineColor: doc.routeLineColor ?? color,
    primaryActivity: doc.primaryActivity ?? "hiking",
    activities: doc.activities?.length ? doc.activities : ["hiking"],
    primaryCategory: doc.primaryCategory === "osm" ? "hiking" : doc.primaryCategory,
  };
}
