import { normalizeLocavaName } from "../inventoryLocavaClassifier.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import type { OsmFeatureListItem, OverpassElement } from "../../openstreetmap/osmFeatureParse.js";
import { findTrailAccess } from "./inventoryTrailAccess.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMilesFromMeters,
  distanceMetersForCoords,
  flattenSegmentsDistance,
  stitchSegments,
  type TrailPoint,
} from "./inventoryTrailGraph.js";

export type TrailAssemblyInput = {
  features: OsmFeatureListItem[];
  elementsById: Map<string, OverpassElement>;
  accessFeatures: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
  importRunId: string;
};

export type TrailAssemblyResult = {
  routes: LocavaInventoryRoute[];
  suppressedTinySegments: number;
  suppressedMemberWays: number;
  diagnostics: {
    rawRouteRelations: number;
    rawTrailLikeWays: number;
    fullTrailsAssembled: number;
    relationTrails: number;
    namedWayGroupTrails: number;
    parkTrailNetworks: number;
    singleWaySegments: number;
    suppressedTinySegments: number;
    suppressedMemberWays: number;
    routesWithParking: number;
    routesWithoutParking: number;
    routesWithTrailhead: number;
    routesWithoutTrailhead: number;
    routesUnder100m: number;
    routesOver1Mile: number;
    routesOver3Miles: number;
    averageDistanceMiles: number;
    longestRoutes: Array<Record<string, unknown>>;
    shortestAcceptedRoutes: Array<Record<string, unknown>>;
    routesMissingParkingSamples: Array<Record<string, unknown>>;
    assembledTrailSamples: Array<Record<string, unknown>>;
    suppressedSegmentSamples: Array<Record<string, unknown>>;
    routeMapHighlightReady: boolean;
  };
};

const ROAD_HIGHWAYS = new Set(["primary", "secondary", "tertiary", "trunk", "motorway", "unclassified", "residential", "service", "living_street"]);
const TRAIL_HIGHWAYS = new Set(["path", "footway", "track", "bridleway", "cycleway", "steps"]);
const TRAIL_ROUTES = new Set(["hiking", "foot", "walking", "running", "bicycle", "mtb"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function isTrailLikeWay(feature: OsmFeatureListItem): boolean {
  const highway = tag(feature.tags, "highway");
  if (highway && TRAIL_HIGHWAYS.has(highway)) {
    if (tag(feature.tags, "footway") === "sidewalk") return false;
    if (tag(feature.tags, "highway") === "crossing") return false;
    return true;
  }
  if (TRAIL_ROUTES.has(tag(feature.tags, "route") ?? "")) return true;
  if (tag(feature.tags, "sac_scale") || tag(feature.tags, "trail_visibility") || tag(feature.tags, "hiking") === "yes") return true;
  return false;
}

function isRoadWay(feature: OsmFeatureListItem): boolean {
  const highway = tag(feature.tags, "highway");
  return Boolean(highway && ROAD_HIGHWAYS.has(highway));
}

function encodePolyline(coords: TrailPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";
  for (const c of coords) {
    const lat = Math.round(c.lat * 1e5);
    const lng = Math.round(c.lng * 1e5);
    result += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

function wayCoords(feature: OsmFeatureListItem): TrailPoint[] {
  return feature.coordinates.length >= 2 ? feature.coordinates : [];
}

function buildRouteFromAssembly(input: {
  id: string;
  routeKind: LocavaInventoryRoute["routeKind"];
  name: string;
  activity: string;
  geometryType: "LineString" | "MultiLineString";
  coordinates?: TrailPoint[];
  segments: TrailPoint[][];
  sourceKeys: string[];
  memberWayIds: string[];
  tags: Record<string, string>;
  locavaScore: number;
  confidence: LocavaInventoryRoute["confidence"];
  displayPriority: LocavaInventoryRoute["displayPriority"];
  showAtZoom: number;
  assemblyWarnings: string[];
  accessFeatures: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
  importRunId: string;
}): LocavaInventoryRoute | null {
  const distanceMeters =
    input.geometryType === "LineString" && input.coordinates
      ? distanceMetersForCoords(input.coordinates)
      : flattenSegmentsDistance(input.segments);
  if (distanceMeters < 50) return null;

  const allPoints = input.coordinates ?? input.segments.flat();
  const bbox = bboxOfTrailPoints(allPoints);
  if (!bbox) return null;
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  const distanceMiles = distanceMilesFromMeters(distanceMeters);
  const parkingSpots = input.accessFeatures.filter(
    (f) =>
      tag(f.tags, "amenity") === "parking" ||
      tag(f.tags, "parking") === "trailhead" ||
      tag(f.tags, "parking") === "surface" ||
      /parking|trailhead/i.test(f.name ?? "")
  );
  const trailheadSpots = input.accessFeatures.filter(
    (f) =>
      tag(f.tags, "highway") === "trailhead" ||
      (tag(f.tags, "tourism") === "information" && ["map", "board", "guidepost"].includes(tag(f.tags, "information") ?? "")) ||
      /trailhead/i.test(f.name ?? "")
  );
  const access = findTrailAccess({
    segments: input.segments.length > 0 ? input.segments : input.coordinates ? [input.coordinates] : [],
    parkingSpots,
    trailheadSpots,
  });

  const primaryKey = input.sourceKeys[0] ?? input.id;
  return {
    id: input.id,
    kind: "inventory_route",
    routeKind: input.routeKind,
    name: input.name,
    normalizedName: normalizeLocavaName(input.name) ?? input.name.toLowerCase(),
    activity: input.activity,
    categories: [input.activity],
    activities: [input.activity === "bicycle" ? "biking" : "hiking"],
    center,
    bbox,
    distanceMeters,
    distanceMiles,
    distanceLabel: distanceLabel(distanceMiles),
    geometryType: input.geometryType,
    coordinates: input.geometryType === "LineString" ? input.coordinates : undefined,
    segments: input.geometryType === "MultiLineString" ? input.segments : undefined,
    encodedPolyline: input.coordinates ? encodePolyline(input.coordinates) : undefined,
    source: "openstreetmap",
    sourceType: input.routeKind === "route_relation" ? "relation" : "way",
    sourceId: primaryKey.split("/")[1] ?? primaryKey,
    sourceKey: primaryKey,
    sourceKeys: input.sourceKeys,
    memberWayIds: input.memberWayIds,
    hasMedia: false,
    status: "active",
    locavaScore: input.locavaScore,
    confidence: input.confidence,
    displayPriority: input.displayPriority,
    showAtZoom: input.showAtZoom,
    selectedTrailhead: access.selectedTrailhead,
    selectedParking: access.selectedParking,
    parkingCandidates: access.parkingCandidates,
    trailheadCandidates: access.trailheadCandidates,
    assemblyWarnings: input.assemblyWarnings,
    classificationReason: "trail_assembly",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: input.tags,
    attribution: { provider: "openstreetmap", license: "ODbL" },
    importRunId: input.importRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function assembleInventoryTrails(input: TrailAssemblyInput): TrailAssemblyResult {
  const trailWays = input.features.filter((f) => f.osmType === "way" && isTrailLikeWay(f) && !isRoadWay(f) && wayCoords(f).length >= 2);
  const relations = [...input.elementsById.values()].filter(
    (el) => el.type === "relation" && TRAIL_ROUTES.has(tag(el.tags ?? {}, "route") ?? "")
  );

  const routes: LocavaInventoryRoute[] = [];
  let suppressedTinySegments = 0;
  let suppressedMemberWays = 0;
  const suppressedSegmentSamples: Array<Record<string, unknown>> = [];
  const usedWayKeys = new Set<string>();

  // 1. Route relations
  for (const rel of relations) {
    const memberWayIds = (rel.members ?? []).filter((m) => m.type === "way").map((m) => String(m.ref));
    const segments: TrailPoint[][] = [];
    for (const wayId of memberWayIds) {
      const el = input.elementsById.get(`way/${wayId}`);
      const coords = el?.geometry?.map((p) => ({ lat: Number(p.lat), lng: Number(p.lon ?? p.lng) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ?? [];
      if (coords.length >= 2) {
        segments.push(coords);
        usedWayKeys.add(`way/${wayId}`);
      }
    }
    if (segments.length === 0) continue;
    const stitched = stitchSegments(segments);
    const dist = stitched.stitched && stitched.coordinates.length >= 2 ? distanceMetersForCoords(stitched.coordinates) : flattenSegmentsDistance(stitched.segments);
    if (dist < 100) {
      suppressedTinySegments += 1;
      continue;
    }
    const name = rel.tags?.name ?? rel.tags?.ref ?? `Route ${rel.id}`;
    const activity = tag(rel.tags ?? {}, "route") ?? "hiking";
    const route = buildRouteFromAssembly({
      id: `route:relation/${rel.id}`,
      routeKind: "route_relation",
      name,
      activity,
      geometryType: stitched.stitched ? "LineString" : "MultiLineString",
      coordinates: stitched.stitched ? stitched.coordinates : undefined,
      segments: stitched.stitched ? [stitched.coordinates] : stitched.segments,
      sourceKeys: [`relation/${rel.id}`, ...memberWayIds.map((id) => `way/${id}`)],
      memberWayIds,
      tags: rel.tags ?? {},
      locavaScore: dist >= 1609 ? 85 : 70,
      confidence: dist >= 1609 ? "high" : "medium",
      displayPriority: dist >= 4828 ? "hero" : dist >= 1609 ? "high" : "medium",
      showAtZoom: dist >= 4828 ? 10 : dist >= 1609 ? 12 : 14,
      assemblyWarnings: stitched.stitched ? [] : ["multi_segment_route"],
      accessFeatures: input.accessFeatures,
      importRunId: input.importRunId,
    });
    if (route) routes.push(route);
  }

  // 2. Named way groups
  const groups = new Map<string, OsmFeatureListItem[]>();
  for (const way of trailWays) {
    if (usedWayKeys.has(way.id)) continue;
    const name = normalizeLocavaName(way.hasRealName ? way.name : null);
    if (!name) continue;
    const key = `${name}|${tag(way.tags, "route") ?? tag(way.tags, "highway") ?? "trail"}`;
    const list = groups.get(key) ?? [];
    list.push(way);
    groups.set(key, list);
  }

  for (const [, ways] of groups) {
    const segments = ways.map((w) => wayCoords(w));
    const stitched = stitchSegments(segments);
    const dist = stitched.stitched && stitched.coordinates.length >= 2 ? distanceMetersForCoords(stitched.coordinates) : flattenSegmentsDistance(stitched.segments);
    if (dist < 100) {
      suppressedTinySegments += ways.length;
      suppressedSegmentSamples.push({ name: ways[0]?.name, distanceMeters: dist, count: ways.length });
      continue;
    }
    for (const w of ways) usedWayKeys.add(w.id);
    const first = ways[0]!;
    const route = buildRouteFromAssembly({
      id: `route:group:${first.id}`,
      routeKind: ways.length > 1 ? "named_way_group" : "single_way_segment",
      name: first.name,
      activity: tag(first.tags, "route") ?? "hiking",
      geometryType: stitched.stitched ? "LineString" : "MultiLineString",
      coordinates: stitched.stitched ? stitched.coordinates : undefined,
      segments: stitched.stitched ? [stitched.coordinates] : stitched.segments,
      sourceKeys: ways.map((w) => w.id),
      memberWayIds: ways.map((w) => String(w.osmId)),
      tags: first.tags,
      locavaScore: dist >= 800 ? 75 : 60,
      confidence: dist >= 800 ? "medium" : "low",
      displayPriority: dist >= 1609 ? "high" : "medium",
      showAtZoom: dist >= 1609 ? 12 : 14,
      assemblyWarnings: stitched.stitched ? [] : ["multi_segment_route"],
      accessFeatures: input.accessFeatures,
      importRunId: input.importRunId,
    });
    if (route) routes.push(route);
  }

  // 3. Strong unnamed recreation ways (single segments >= 250m)
  for (const way of trailWays) {
    if (usedWayKeys.has(way.id)) continue;
    const coords = wayCoords(way);
    const dist = distanceMetersForCoords(coords);
    const hasStrongTrailTag = Boolean(tag(way.tags, "sac_scale") || tag(way.tags, "trail_visibility") || tag(way.tags, "hiking") === "yes");
    if (dist < (hasStrongTrailTag ? 100 : 250)) {
      suppressedTinySegments += 1;
      continue;
    }
    usedWayKeys.add(way.id);
    const route = buildRouteFromAssembly({
      id: `route:way:${way.id}`,
      routeKind: "single_way_segment",
      name: way.hasRealName ? way.name : "Unnamed trail segment",
      activity: "hiking",
      geometryType: "LineString",
      coordinates: coords,
      segments: [coords],
      sourceKeys: [way.id],
      memberWayIds: [String(way.osmId)],
      tags: way.tags,
      locavaScore: 55,
      confidence: "low",
      displayPriority: "medium",
      showAtZoom: 15,
      assemblyWarnings: way.hasRealName ? [] : ["unnamed_trail_segment"],
      accessFeatures: input.accessFeatures,
      importRunId: input.importRunId,
    });
    if (route) routes.push(route);
    else suppressedTinySegments += 1;
  }

  suppressedMemberWays = trailWays.filter((w) => !usedWayKeys.has(w.id)).length;

  routes.sort((a, b) => b.distanceMeters - a.distanceMeters);
  const miles = routes.map((r) => r.distanceMiles);
  const avgMiles = miles.length ? miles.reduce((a, b) => a + b, 0) / miles.length : 0;

  const diag = {
    rawRouteRelations: relations.length,
    rawTrailLikeWays: trailWays.length,
    fullTrailsAssembled: routes.length,
    relationTrails: routes.filter((r) => r.routeKind === "route_relation").length,
    namedWayGroupTrails: routes.filter((r) => r.routeKind === "named_way_group").length,
    parkTrailNetworks: routes.filter((r) => r.routeKind === "park_trail_network").length,
    singleWaySegments: routes.filter((r) => r.routeKind === "single_way_segment").length,
    suppressedTinySegments,
    suppressedMemberWays,
    routesWithParking: routes.filter((r) => r.selectedParking).length,
    routesWithoutParking: routes.filter((r) => !r.selectedParking).length,
    routesWithTrailhead: routes.filter((r) => r.selectedTrailhead).length,
    routesWithoutTrailhead: routes.filter((r) => !r.selectedTrailhead).length,
    routesUnder100m: routes.filter((r) => r.distanceMeters < 100).length,
    routesOver1Mile: routes.filter((r) => r.distanceMiles >= 1).length,
    routesOver3Miles: routes.filter((r) => r.distanceMiles >= 3).length,
    averageDistanceMiles: Math.round(avgMiles * 100) / 100,
    longestRoutes: routes.slice(0, 10).map((r) => ({ name: r.name, distanceMiles: r.distanceMiles, routeKind: r.routeKind })),
    shortestAcceptedRoutes: routes.slice(-10).map((r) => ({ name: r.name, distanceMeters: r.distanceMeters, routeKind: r.routeKind })),
    routesMissingParkingSamples: routes.filter((r) => !r.selectedParking).slice(0, 10).map((r) => ({ name: r.name, sourceKey: r.sourceKey })),
    assembledTrailSamples: routes.slice(0, 10).map((r) => ({
      name: r.name,
      routeKind: r.routeKind,
      distanceMiles: r.distanceMiles,
      segmentCount: r.segments?.length ?? 1,
      pointCount: r.coordinates?.length ?? r.segments?.flat().length ?? 0,
    })),
    suppressedSegmentSamples,
    routeMapHighlightReady: true,
  };

  return { routes, suppressedTinySegments, suppressedMemberWays, diagnostics: diag };
}
