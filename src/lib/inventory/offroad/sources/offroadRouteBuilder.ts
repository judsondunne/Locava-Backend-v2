import { normalizeLocavaName } from "../../inventoryLocavaClassifier.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMilesFromMeters,
  distanceMetersForCoords,
  type TrailPoint,
} from "../../trails/inventoryTrailGraph.js";
import type { OffroadMergedConfidence } from "./nationalOffroadSource.types.js";

export function geoJsonLineToTrailPoints(geometry: {
  type: "LineString" | "MultiLineString";
  coordinates: number[][] | number[][][];
}): { segments: TrailPoint[][]; flat: TrailPoint[] } {
  if (geometry.type === "LineString") {
    const segment = (geometry.coordinates as number[][]).map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
    return { segments: [segment], flat: segment };
  }
  const segments = (geometry.coordinates as number[][][]).map((line) =>
    line.map(([lng, lat]) => ({ lat: lat!, lng: lng! }))
  );
  return { segments, flat: segments.flat() };
}

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function buildFederalOffroadRoute(input: {
  source: string;
  sourceId: string;
  sourceKey: string;
  sourceDatasetName: string;
  sourceType: "arcgis_feature";
  name: string;
  segments: TrailPoint[][];
  flat: TrailPoint[];
  importRunId: string;
  stateCode: string;
  accessStatus: "public" | "limited" | "permissive" | "designated" | "unknown" | "private" | "restricted";
  accessWarnings: string[];
  legalDisplayLabel: "Motorized route" | "Limited motorized route" | "Unmaintained road";
  offroadCategory: string;
  confidence: OffroadMergedConfidence;
  displayPriority?: "high" | "medium" | "low" | "hidden";
  sourceSignals: string[];
  tags: Record<string, string>;
  attribution: { provider: string; license: string; sourceDatasetName: string };
}): LocavaInventoryRoute | null {
  if (input.flat.length < 2) return null;

  const bbox = bboxOfTrailPoints(input.flat) ?? {
    minLat: input.flat[0]!.lat,
    minLng: input.flat[0]!.lng,
    maxLat: input.flat[input.flat.length - 1]!.lat,
    maxLng: input.flat[input.flat.length - 1]!.lng,
  };
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  const distanceMeters = distanceMetersForCoords(input.flat);
  const distanceMiles = distanceMilesFromMeters(distanceMeters);

  return {
    id: `route:${input.source}:${input.sourceId}`,
    kind: "inventory_route",
    routeKind: "offroad_unmaintained_road",
    name: input.name,
    normalizedName: normalizeLocavaName(input.name) ?? input.name.toLowerCase(),
    activity: "offroading",
    categories: ["offroading", "motorized_route"],
    activities: ["offroading"],
    center,
    bbox,
    distanceMeters,
    distanceMiles,
    distanceLabel: distanceLabel(distanceMiles),
    geometryType: input.segments.length > 1 ? "MultiLineString" : "LineString",
    coordinates: input.segments.length === 1 ? input.segments[0] : undefined,
    segments: input.segments,
    source: input.source,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceKey: input.sourceKey,
    sourceKeys: [input.sourceKey],
    sourceDatasetName: input.sourceDatasetName,
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: input.confidence === "official_federal" ? 88 : 75,
    confidence: input.confidence === "osm_candidate" ? "low" : "high",
    displayPriority: input.displayPriority ?? (input.accessStatus === "restricted" ? "hidden" : "high"),
    showAtZoom: 12,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    offroad: {
      legalDisplayLabel: input.legalDisplayLabel,
      offroadCategory: input.offroadCategory,
      offroadConfidence: input.confidence === "osm_candidate" ? "candidate" : "explicit",
      accessStatus: input.accessStatus,
      accessWarnings: input.accessWarnings,
      seasonalWarnings: [],
      sourceSignals: input.sourceSignals,
      vehicleSignals: {},
      roadClassSignals: {},
    },
    assemblyWarnings: [],
    classificationReason: `${input.source}_federal`,
    tagSignals: input.sourceSignals,
    negativeSignals: [],
    rejectionReason: null,
    tags: input.tags,
    attribution: input.attribution,
    importRunId: input.importRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function featureDisplayName(props: Record<string, unknown>, fallback: string): string {
  const candidates = [
    props.ROUTE_NAME,
    props.RouteName,
    props.NAME,
    props.Name,
    props.name,
    props.ROAD_NAME,
    props.RoadName,
    props.TRAIL_NAME,
    props.SYSTEM_NAME,
    props.SYSTEMNAME,
    props.ROUTE_NUM,
  ];
  for (const c of candidates) {
    const s = cleanStr(c);
    if (s) return s;
  }
  return fallback;
}
