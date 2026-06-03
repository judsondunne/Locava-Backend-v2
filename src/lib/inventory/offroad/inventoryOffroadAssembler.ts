import { normalizeLocavaName } from "../inventoryLocavaClassifier.js";
import type { LocavaInventoryRoute, LocavaRouteKind } from "../inventoryLocavaTypes.js";
import type { OsmFeatureListItem } from "../../openstreetmap/osmFeatureParse.js";
import { findTrailAccess } from "../trails/inventoryTrailAccess.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMilesFromMeters,
  distanceMetersForCoords,
  flattenSegmentsDistance,
  stitchSegments,
  type TrailPoint,
} from "../trails/inventoryTrailGraph.js";
import { classifyOffroadCandidate, type OffroadClassificationResult } from "./inventoryOffroadClassifier.js";

export type OffroadAssemblyInput = {
  features: OsmFeatureListItem[];
  usedSourceKeys: Set<string>;
  accessFeatures: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
  importRunId: string;
};

export type OffroadAssemblyResult = {
  routes: LocavaInventoryRoute[];
  classifications: OffroadClassificationResult[];
  rejected: OffroadClassificationResult[];
};

function offroadRouteKind(category: string): LocavaRouteKind {
  if (category === "class4_road") return "offroad_class4_road";
  if (category === "class6_road") return "offroad_class6_road";
  if (category === "legal_trail") return "offroad_legal_trail";
  if (category === "atv_trail" || category === "ohv_trail" || category === "ohrv_trail") return "offroad_atv_trail";
  if (category === "4wd_track") return "offroad_4wd_track";
  return "offroad_unmaintained_road";
}

function minDistanceMeters(classification: OffroadClassificationResult, dist: number): boolean {
  const explicit =
    classification.roadClassSignals.vtClass4 ||
    classification.roadClassSignals.nhClass6 ||
    classification.roadClassSignals.legalTrail ||
    classification.offroadConfidence === "explicit";
  if (explicit) return dist >= 75;
  if (classification.offroadCategory === "class4_road" || classification.offroadCategory === "class6_road") return dist >= 75;
  if (classification.sourceSignals.includes("highway=unclassified")) return dist >= 150;
  return dist >= 250;
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

function buildOffroadRouteFromGeometry(input: {
  name: string;
  classification: OffroadClassificationResult;
  coords: TrailPoint[];
  segments: TrailPoint[][];
  stitched: boolean;
  sourceKeys: string[];
  memberWayIds: string[];
  tags: Record<string, string>;
  feature: OsmFeatureListItem;
  accessFeatures: OffroadAssemblyInput["accessFeatures"];
  importRunId: string;
}): LocavaInventoryRoute | null {
  const dist = input.stitched
    ? flattenSegmentsDistance(input.segments)
    : distanceMetersForCoords(input.coords);
  if (!minDistanceMeters(input.classification, dist)) return null;

  const access = findTrailAccess({
    segments: input.segments,
    parkingSpots: input.accessFeatures.filter((a) => a.tags.amenity === "parking"),
    trailheadSpots: input.accessFeatures.filter((a) => a.tags.highway === "trailhead" || a.tags.parking === "trailhead"),
  });

  const flatCoords = input.stitched ? input.segments.flat() : input.coords;
  const bbox = bboxOfTrailPoints(flatCoords) ?? {
    minLat: flatCoords[0]!.lat,
    minLng: flatCoords[0]!.lng,
    maxLat: flatCoords[flatCoords.length - 1]!.lat,
    maxLng: flatCoords[flatCoords.length - 1]!.lng,
  };
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  const displayPriority =
    input.classification.offroadConfidence === "explicit"
      ? "high"
      : input.classification.offroadConfidence === "strong"
        ? "medium"
        : "low";

  return {
    id: `route:offroad:${input.sourceKeys[0]}`,
    kind: "inventory_route",
    routeKind:
      input.classification.decision === "candidate" ? "offroad_candidate" : offroadRouteKind(input.classification.offroadCategory),
    name: input.name,
    normalizedName: normalizeLocavaName(input.name) ?? input.name.toLowerCase(),
    activity: "offroading",
    categories: [input.classification.offroadCategory, "offroading"],
    activities: ["offroading"],
    center,
    bbox,
    distanceMeters: dist,
    distanceMiles: distanceMilesFromMeters(dist),
    distanceLabel: distanceLabel(dist),
    geometryType: input.stitched && input.segments.length > 1 ? "MultiLineString" : "LineString",
    coordinates: input.stitched ? undefined : input.coords,
    segments: input.segments,
    encodedPolyline: encodePolyline(input.coords),
    source: "openstreetmap",
    sourceType: input.feature.osmType,
    sourceId: String(input.feature.osmId),
    sourceKey: input.sourceKeys[0]!,
    sourceKeys: input.sourceKeys,
    memberWayIds: input.memberWayIds,
    hasMedia: false,
    status: "active",
    locavaScore: input.classification.score,
    confidence:
      input.classification.offroadConfidence === "explicit"
        ? "high"
        : input.classification.offroadConfidence === "strong"
          ? "medium"
          : "low",
    displayPriority: input.classification.decision === "candidate" ? "hidden" : displayPriority,
    showAtZoom: 13,
    selectedTrailhead: access.selectedTrailhead,
    selectedParking: access.selectedParking,
    parkingCandidates: access.parkingCandidates,
    trailheadCandidates: access.trailheadCandidates,
    offroad: {
      legalDisplayLabel: "Unmaintained road",
      offroadCategory: input.classification.offroadCategory,
      offroadConfidence: input.classification.offroadConfidence,
      accessStatus: input.classification.accessStatus,
      accessWarnings: input.classification.accessWarnings,
      seasonalWarnings: input.classification.seasonalWarnings,
      sourceSignals: input.classification.sourceSignals,
      vehicleSignals: input.classification.vehicleSignals,
      roadClassSignals: input.classification.roadClassSignals,
    },
    assemblyWarnings: input.stitched ? ["stitched_named_segments", ...input.classification.seasonalWarnings] : input.classification.seasonalWarnings,
    classificationReason: `offroad_score_${input.classification.score}`,
    tagSignals: input.classification.sourceSignals,
    negativeSignals: [],
    rejectionReason: null,
    tags: input.tags,
    attribution: { provider: "openstreetmap", license: "ODbL" },
    importRunId: input.importRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function assembleOffroadRoutes(input: OffroadAssemblyInput): OffroadAssemblyResult {
  const routes: LocavaInventoryRoute[] = [];
  const classifications: OffroadClassificationResult[] = [];
  const rejected: OffroadClassificationResult[] = [];

  type WayCandidate = { feature: OsmFeatureListItem; classification: OffroadClassificationResult };
  const acceptedWays: WayCandidate[] = [];
  const candidateWays: WayCandidate[] = [];

  for (const feature of input.features) {
    if (feature.osmType !== "way") continue;
    if (input.usedSourceKeys.has(feature.id)) continue;
    if (feature.coordinates.length < 2) continue;
    const classification = classifyOffroadCandidate(feature);
    if (!classification) continue;
    classifications.push(classification);
    if (classification.decision === "reject") {
      rejected.push(classification);
      continue;
    }
    if (classification.decision === "candidate") candidateWays.push({ feature, classification });
    else acceptedWays.push({ feature, classification });
  }

  const processGroup = (items: WayCandidate[], allowCandidate: boolean) => {
    const groups = new Map<string, WayCandidate[]>();
    for (const item of items) {
      const name = item.feature.hasRealName ? item.feature.name : null;
      const key = name ? normalizeLocavaName(name) ?? name.toLowerCase() : `__unnamed__:${item.classification.offroadCategory}:${item.feature.id}`;
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }

    for (const [, group] of groups) {
      if (group.length === 1) {
        const { feature, classification } = group[0]!;
        const route = buildOffroadRouteFromGeometry({
          name: classification.displayName,
          classification,
          coords: feature.coordinates,
          segments: [feature.coordinates],
          stitched: false,
          sourceKeys: [feature.id],
          memberWayIds: [String(feature.osmId)],
          tags: feature.tags,
          feature,
          accessFeatures: input.accessFeatures,
          importRunId: input.importRunId,
        });
        if (route) routes.push(route);
        continue;
      }

      const first = group[0]!;
      const segments = group.map((g) => g.feature.coordinates);
      const stitched = stitchSegments(segments);
      const displayName = first.feature.hasRealName ? first.feature.name : first.classification.displayName;
      const route = buildOffroadRouteFromGeometry({
        name: displayName,
        classification: first.classification,
        coords: stitched.stitched ? stitched.coordinates : first.feature.coordinates,
        segments: stitched.stitched ? [stitched.coordinates] : stitched.segments,
        stitched: stitched.stitched || group.length > 1,
        sourceKeys: group.map((g) => g.feature.id),
        memberWayIds: group.map((g) => String(g.feature.osmId)),
        tags: first.feature.tags,
        feature: first.feature,
        accessFeatures: input.accessFeatures,
        importRunId: input.importRunId,
      });
      if (route) routes.push(route);
    }
  };

  processGroup(acceptedWays, false);

  routes.sort((a, b) => b.distanceMeters - a.distanceMeters);
  return { routes, classifications, rejected };
}
