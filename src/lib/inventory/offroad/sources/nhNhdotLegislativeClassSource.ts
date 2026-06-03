import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import { normalizeLocavaName } from "../../inventoryLocavaClassifier.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMetersForCoords,
  distanceMilesFromMeters,
  type TrailPoint,
} from "../../trails/inventoryTrailGraph.js";
import { VTRANS_ACCESS_WARNINGS } from "./vtransPublicHighwaySystemSource.js";

export const NHDOT_LEGISLATIVE_CLASS_ENDPOINT =
  "https://maps.dot.nh.gov/arcgis_server/rest/services/Highways/NHDOT_HIGHWAYS_Legislative_Class_Groups/MapServer/5/query";

export const NHDOT_CLASS6_OUT_FIELDS =
  "OBJECTID,ROUTE_ID,STREET,TOWN_NAME,LEGIS_CLASS,SECT_LENGTH,SURF_TYPE,JURISDICTION_DESCR,WINTER_MAINT,SUMMER_MAINTENANCE";

export type NhdotRoadProperties = {
  OBJECTID?: number;
  ROUTE_ID?: string | number | null;
  STREET?: string | null;
  TOWN_NAME?: string | null;
  LEGIS_CLASS?: string | null;
  SECT_LENGTH?: number | null;
  SURF_TYPE?: string | null;
  JURISDICTION_DESCR?: string | null;
  WINTER_MAINT?: string | null;
  SUMMER_MAINTENANCE?: string | null;
};

export type NhdotRoadGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

export type NhdotRoadFeature = {
  type: "Feature";
  properties: NhdotRoadProperties;
  geometry: NhdotRoadGeometry;
};

type EsriQueryFeature = {
  attributes: NhdotRoadProperties;
  geometry?: { paths?: number[][][] };
};

export type FetchNhdotBboxInput = {
  bbox: InventoryBbox;
  includeClass6?: boolean;
  resultRecordCount?: number;
  maxPages?: number;
  fetchTimeoutMs?: number;
};

export type NormalizeNhdotContext = {
  importRunId: string;
  localityLabel?: string;
};

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function buildNhdotClass6Where(includeClass6 = true): string {
  return includeClass6 ? "LEGIS_CLASS='VI'" : "1=0";
}

export function buildNhdotQueryParams(input: {
  bbox: InventoryBbox;
  includeClass6?: boolean;
  resultRecordCount?: number;
  resultOffset?: number;
}): URLSearchParams {
  const { minLat, minLng, maxLat, maxLng } = input.bbox;
  return new URLSearchParams({
    where: buildNhdotClass6Where(input.includeClass6 ?? true),
    outFields: NHDOT_CLASS6_OUT_FIELDS,
    returnGeometry: "true",
    outSR: "4326",
    inSR: "4326",
    geometry: `${minLng},${minLat},${maxLng},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: String(input.resultRecordCount ?? 1000),
    resultOffset: String(input.resultOffset ?? 0),
    f: "json",
  });
}

function esriPathsToSegments(paths: number[][][]): { segments: TrailPoint[][]; flat: TrailPoint[] } {
  const segments: TrailPoint[][] = paths.map((path) => path.map(([lng, lat]) => ({ lat: lat!, lng: lng! })));
  const flat = segments.flat();
  return { segments, flat };
}

function esriFeatureToNhdotRoadFeature(raw: EsriQueryFeature): NhdotRoadFeature | null {
  const paths = raw.geometry?.paths;
  if (!paths?.length) return null;
  const { segments } = esriPathsToSegments(paths);
  if (segments.length === 1) {
    return {
      type: "Feature",
      properties: raw.attributes ?? {},
      geometry: { type: "LineString", coordinates: segments[0]!.map((p) => [p.lng, p.lat]) },
    };
  }
  return {
    type: "Feature",
    properties: raw.attributes ?? {},
    geometry: {
      type: "MultiLineString",
      coordinates: segments.map((seg) => seg.map((p) => [p.lng, p.lat])),
    },
  };
}

function geoJsonCoordsToTrailPoints(geometry: NhdotRoadGeometry): { segments: TrailPoint[][]; flat: TrailPoint[] } {
  if (geometry.type === "LineString") {
    const seg = geometry.coordinates.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
    return { segments: [seg], flat: seg };
  }
  const segments = geometry.coordinates.map((line) => line.map(([lng, lat]) => ({ lat: lat!, lng: lng! })));
  return { segments, flat: segments.flat() };
}

function buildNhdotDisplayName(props: NhdotRoadProperties): string {
  const street = cleanStr(props.STREET);
  const town = cleanStr(props.TOWN_NAME);
  if (street && street.toLowerCase() !== "no name") {
    return town ? `${street} (${town})` : street;
  }
  return town ? `Class VI Road (${town})` : "Class VI Road";
}

export function normalizeNhdotRoadFeatureToInventoryRoute(
  feature: NhdotRoadFeature,
  context: NormalizeNhdotContext
): LocavaInventoryRoute | null {
  const props = feature.properties ?? {};
  const legisClass = cleanStr(props.LEGIS_CLASS)?.toUpperCase();
  if (legisClass !== "VI") return null;
  if (!feature.geometry) return null;

  const { segments, flat } = geoJsonCoordsToTrailPoints(feature.geometry);
  if (flat.length < 2) return null;

  const objectId = props.OBJECTID;
  if (objectId == null) return null;

  const name = buildNhdotDisplayName(props);
  const sectMiles = props.SECT_LENGTH;
  const distanceMeters =
    sectMiles != null && Number.isFinite(sectMiles) && sectMiles > 0
      ? Math.round(sectMiles * 1609.344)
      : distanceMetersForCoords(flat);
  const distanceMiles =
    sectMiles != null && Number.isFinite(sectMiles) && sectMiles > 0
      ? Math.round(sectMiles * 100) / 100
      : distanceMilesFromMeters(distanceMeters);

  const bbox = bboxOfTrailPoints(flat) ?? {
    minLat: flat[0]!.lat,
    minLng: flat[0]!.lng,
    maxLat: flat[flat.length - 1]!.lat,
    maxLng: flat[flat.length - 1]!.lng,
  };
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  const sourceKey = `nhdot_legislative_class/${objectId}`;

  const tags: Record<string, string> = {
    LEGIS_CLASS: "VI",
    OBJECTID: String(objectId),
  };
  if (props.ROUTE_ID != null) tags.ROUTE_ID = String(props.ROUTE_ID);
  if (props.STREET) tags.STREET = props.STREET;
  if (props.TOWN_NAME) tags.TOWN_NAME = props.TOWN_NAME;
  if (props.SECT_LENGTH != null) tags.SECT_LENGTH = String(props.SECT_LENGTH);
  if (props.SURF_TYPE) tags.SURF_TYPE = props.SURF_TYPE;

  const accessWarnings = [
    ...VTRANS_ACCESS_WARNINGS,
    "NH Class VI roads are locally owned/unmaintained — verify town access and vehicle rules.",
  ];

  return {
    id: `route:nhdot:${objectId}`,
    kind: "inventory_route",
    routeKind: "offroad_class6_road",
    name,
    normalizedName: normalizeLocavaName(name) ?? name.toLowerCase(),
    activity: "offroading",
    categories: ["class6_road", "offroading"],
    activities: ["offroading", "unmaintainedroad", "class6road"],
    center,
    bbox,
    distanceMeters,
    distanceMiles,
    distanceLabel: distanceLabel(distanceMiles),
    geometryType: segments.length > 1 ? "MultiLineString" : "LineString",
    coordinates: segments.length === 1 ? segments[0] : undefined,
    segments,
    source: "nhdot_legislative_class",
    sourceType: "arcgis_feature",
    sourceId: String(objectId),
    sourceKey,
    sourceKeys: [sourceKey],
    sourceDatasetName: "NHDOT Legislative Class VI",
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: 88,
    confidence: "high",
    displayPriority: "high",
    showAtZoom: 12,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    offroad: {
      legalDisplayLabel: "Unmaintained road",
      offroadCategory: "class6_road",
      offroadConfidence: "explicit",
      accessStatus: "unknown",
      accessWarnings,
      seasonalWarnings: [],
      sourceSignals: ["nhdot_legislative_class", "LEGIS_CLASS=VI"],
      vehicleSignals: {},
      roadClassSignals: { nhClass6: true, classTagRaw: "VI" },
      surfaceRaw: props.SURF_TYPE ?? undefined,
    },
    assemblyWarnings: [],
    classificationReason: "nhdot_legis_class_vi",
    tagSignals: ["LEGIS_CLASS=VI"],
    negativeSignals: [],
    rejectionReason: null,
    tags,
    attribution: {
      provider: "nhdot",
      license: "public",
      sourceDatasetName: "NHDOT Legislative Class VI",
    },
    importRunId: context.importRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchNhdotPage(input: {
  bbox: InventoryBbox;
  includeClass6: boolean;
  resultRecordCount: number;
  resultOffset: number;
  fetchTimeoutMs: number;
}): Promise<{ features: NhdotRoadFeature[]; rawCount: number; exceeded: boolean }> {
  const params = buildNhdotQueryParams({
    bbox: input.bbox,
    includeClass6: input.includeClass6,
    resultRecordCount: input.resultRecordCount,
    resultOffset: input.resultOffset,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.fetchTimeoutMs);
  try {
    const res = await fetch(`${NHDOT_LEGISLATIVE_CLASS_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "LocavaInventory/1.0 (NHDOT Legislative Class VI)" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`nhdot_class6_query_failed:http_${res.status}`);
    const json = (await res.json()) as {
      features?: EsriQueryFeature[];
      error?: { message?: string };
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`nhdot_class6_query_error:${json.error.message ?? "unknown"}`);
    const raw = json.features ?? [];
    const features = raw.map(esriFeatureToNhdotRoadFeature).filter((f): f is NhdotRoadFeature => f != null);
    return { features, rawCount: raw.length, exceeded: Boolean(json.exceededTransferLimit) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`nhdot_class6_query_timeout:after_${input.fetchTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNhdotClass6RoadsForBbox(input: FetchNhdotBboxInput): Promise<NhdotRoadFeature[]> {
  const includeClass6 = input.includeClass6 ?? true;
  const resultRecordCount = input.resultRecordCount ?? 1000;
  const maxPages = input.maxPages ?? 20;
  const fetchTimeoutMs = input.fetchTimeoutMs ?? 60_000;

  const seen = new Set<string>();
  const out: NhdotRoadFeature[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await fetchNhdotPage({
      bbox: input.bbox,
      includeClass6,
      resultRecordCount,
      resultOffset: offset,
      fetchTimeoutMs,
    });

    for (const feature of pageResult.features) {
      const objectId = feature.properties?.OBJECTID;
      const dedupeKey = objectId != null ? `oid:${objectId}` : null;
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);
      out.push(feature);
    }

    if (!pageResult.exceeded || pageResult.rawCount < resultRecordCount) break;
    offset += pageResult.rawCount;
  }

  return out;
}

export async function importNhdotClass6RoutesForBbox(input: FetchNhdotBboxInput & NormalizeNhdotContext): Promise<{
  routes: LocavaInventoryRoute[];
  rawFeatures: NhdotRoadFeature[];
  missingGeometry: number;
}> {
  const rawFeatures = await fetchNhdotClass6RoadsForBbox(input);
  const routes: LocavaInventoryRoute[] = [];
  let missingGeometry = 0;

  for (const feature of rawFeatures) {
    const route = normalizeNhdotRoadFeatureToInventoryRoute(feature, {
      importRunId: input.importRunId,
      localityLabel: input.localityLabel,
    });
    if (route) routes.push(route);
    else missingGeometry += 1;
  }

  routes.sort((a, b) => b.distanceMeters - a.distanceMeters);
  return { routes, rawFeatures, missingGeometry };
}
