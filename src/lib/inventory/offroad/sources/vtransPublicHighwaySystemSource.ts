import { formatOffroadDisplayName } from "../offroadDisplayName.js";
import { mergeVtransRoadFeaturesByIdentity } from "../vtransRoadSegmentMerge.js";
import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import { normalizeLocavaName } from "../../inventoryLocavaClassifier.js";
import type { LocavaInventoryRoute, LocavaRouteKind } from "../../inventoryLocavaTypes.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMetersForCoords,
  distanceMilesFromMeters,
  type TrailPoint,
} from "../../trails/inventoryTrailGraph.js";

export const VTRANS_PHS_LOCAL_ROADS_ENDPOINT =
  "https://maps.vtrans.vermont.gov/arcgis/rest/services/Layers/PublicHighwaySystem/MapServer/6/query";

export const VTRANS_PHS_OUT_FIELDS =
  "OBJECTID,SEGMENTID,PRIMARYNAME,RTNAME,RTNUMBER,RDFLNAME,AOTCLASS,SURFACETYPE,ARCMILES,AOTMILES,ROADCLOSED,PENT,TWN_LR,CERTYEAR,MAPYEAR";

export const VTRANS_ACCESS_WARNINGS = [
  "Verify local access, signage, seasonal closures, and vehicle rules before driving.",
  "Class 4 / Legal Trail status does not guarantee current motor vehicle access.",
  "Town selectboards may restrict use or maintenance conditions.",
];

export type VtransRoadProperties = {
  OBJECTID?: number;
  SEGMENTID?: number | string;
  PRIMARYNAME?: string | null;
  RTNAME?: string | null;
  RTNUMBER?: string | number | null;
  RDFLNAME?: string | null;
  AOTCLASS?: number;
  SURFACETYPE?: string | null;
  ARCMILES?: number | null;
  AOTMILES?: number | null;
  ROADCLOSED?: string | null;
  PENT?: string | null;
  TWN_LR?: string | null;
  CERTYEAR?: number | string | null;
  MAPYEAR?: number | string | null;
};

export type VtransRoadGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

export type VtransRoadFeature = {
  type: "Feature";
  properties: VtransRoadProperties;
  geometry: VtransRoadGeometry;
};

type EsriQueryFeature = {
  attributes: VtransRoadProperties;
  geometry?: { paths?: number[][][] };
};

export type FetchVtransBboxInput = {
  bbox: InventoryBbox;
  includeLegalTrails?: boolean;
  includeClass4?: boolean;
  resultRecordCount?: number;
  maxPages?: number;
  fetchTimeoutMs?: number;
};

export type NormalizeVtransContext = {
  importRunId: string;
  localityLabel?: string;
  includeRestrictedAsHidden?: boolean;
};

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function buildVtransAotclassWhere(includeClass4 = true, includeLegalTrails = true): string {
  const classes: number[] = [];
  if (includeClass4) classes.push(4);
  if (includeLegalTrails) classes.push(7);
  if (classes.length === 0) return "1=0";
  if (classes.length === 1) return `AOTCLASS=${classes[0]}`;
  return `AOTCLASS IN (${classes.join(",")})`;
}

/** ArcGIS envelope order: minLng,minLat,maxLng,maxLat */
export function buildVtransPhsQueryParams(input: {
  bbox: InventoryBbox;
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  resultRecordCount?: number;
  resultOffset?: number;
}): URLSearchParams {
  const { minLat, minLng, maxLat, maxLng } = input.bbox;
  const params = new URLSearchParams({
    where: buildVtransAotclassWhere(input.includeClass4 ?? true, input.includeLegalTrails ?? true),
    outFields: VTRANS_PHS_OUT_FIELDS,
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    geometry: `${minLng},${minLat},${maxLng},${maxLat}`,
    resultRecordCount: String(input.resultRecordCount ?? 1000),
  });
  if (input.resultOffset != null && input.resultOffset > 0) {
    params.set("resultOffset", String(input.resultOffset));
  }
  return params;
}

function esriPathsToGeoJson(
  paths: number[][][],
  properties: VtransRoadProperties
): VtransRoadFeature | null {
  if (!paths.length || !paths[0]?.length) return null;
  if (paths.length === 1) {
    return {
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: paths[0]!.map((pair) => [pair[0]!, pair[1]!] as [number, number]),
      },
    };
  }
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "MultiLineString",
      coordinates: paths.map((path) => path.map((pair) => [pair[0]!, pair[1]!] as [number, number])),
    },
  };
}

export function esriFeatureToVtransRoadFeature(feature: EsriQueryFeature): VtransRoadFeature | null {
  const paths = feature.geometry?.paths;
  if (!paths?.length) return null;
  return esriPathsToGeoJson(paths, feature.attributes ?? {});
}

export function geoJsonCoordsToTrailPoints(geometry: VtransRoadGeometry): { segments: TrailPoint[][]; flat: TrailPoint[] } {
  if (geometry.type === "LineString") {
    const segment = geometry.coordinates.map(([lng, lat]: number[]) => ({ lat: lat!, lng: lng! }));
    return { segments: [segment], flat: segment };
  }
  const segments = geometry.coordinates.map((line: number[][]) =>
    line.map(([lng, lat]: number[]) => ({ lat: lat!, lng: lng! }))
  );
  return { segments, flat: segments.flat() };
}

function isRoadClosedRestricted(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "y" || v === "yes" || v === "closed" || v === "seasonal" || v.startsWith("closed ");
}

function isPentRoad(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "y" || v === "yes" || v.includes("pent");
}

function routeKindForAotclass(aotclass: number): LocavaRouteKind {
  if (aotclass === 4) return "offroad_class4_road";
  if (aotclass === 7) return "offroad_legal_trail";
  return "offroad_unmaintained_road";
}

function offroadCategoryForAotclass(aotclass: number): "class4_road" | "legal_trail" {
  return aotclass === 7 ? "legal_trail" : "class4_road";
}

function categoriesForAotclass(aotclass: number): string[] {
  if (aotclass === 7) return ["offroading", "unmaintained_road", "legal_trail"];
  return ["offroading", "unmaintained_road", "class4_road"];
}

export function buildVtransDisplayName(props: VtransRoadProperties, aotclass: number, locality?: string): string {
  const rdfl = cleanStr(props.RDFLNAME);
  if (rdfl) return formatOffroadDisplayName(rdfl);
  const primary = cleanStr(props.PRIMARYNAME);
  if (primary) return formatOffroadDisplayName(primary);
  const rtname = cleanStr(props.RTNAME);
  if (rtname) return formatOffroadDisplayName(rtname);
  const rtn = cleanStr(props.RTNUMBER);
  if (rtn) return `Town Highway ${rtn}`;
  const near = locality ? ` near ${locality}` : "";
  return aotclass === 7 ? `Legal Trail${near}` : `Class 4 Road${near}`;
}

function milesToMeters(miles: number): number {
  return Math.round(miles * 1609.344);
}

export function resolveVtransDistance(input: {
  aotMiles?: number | null;
  arcMiles?: number | null;
  coords: TrailPoint[];
}): { distanceMeters: number; distanceMiles: number; source: "AOTMILES" | "ARCMILES" | "geometry" } {
  if (input.aotMiles != null && Number.isFinite(input.aotMiles) && input.aotMiles > 0) {
    const distanceMeters = milesToMeters(input.aotMiles);
    return { distanceMeters, distanceMiles: Math.round(input.aotMiles * 100) / 100, source: "AOTMILES" };
  }
  if (input.arcMiles != null && Number.isFinite(input.arcMiles) && input.arcMiles > 0) {
    const distanceMeters = milesToMeters(input.arcMiles);
    return { distanceMeters, distanceMiles: Math.round(input.arcMiles * 100) / 100, source: "ARCMILES" };
  }
  const distanceMeters = distanceMetersForCoords(input.coords);
  return { distanceMeters, distanceMiles: distanceMilesFromMeters(distanceMeters), source: "geometry" };
}

export function normalizeVtransRoadFeatureToInventoryRoute(
  feature: VtransRoadFeature,
  context: NormalizeVtransContext
): LocavaInventoryRoute | null {
  const props = feature.properties ?? {};
  const aotclass = props.AOTCLASS;
  if (aotclass !== 4 && aotclass !== 7) return null;
  if (!feature.geometry) return null;

  const { segments, flat } = geoJsonCoordsToTrailPoints(feature.geometry);
  if (flat.length < 2) return null;

  const objectId = props.OBJECTID;
  if (objectId == null) return null;

  const name = buildVtransDisplayName(props, aotclass, context.localityLabel);
  const dist = resolveVtransDistance({
    aotMiles: props.AOTMILES,
    arcMiles: props.ARCMILES,
    coords: flat,
  });

  const roadClosed = cleanStr(props.ROADCLOSED);
  const pent = cleanStr(props.PENT);
  const restricted = isRoadClosedRestricted(roadClosed);
  const pentRoad = isPentRoad(pent);

  const accessWarnings = [...VTRANS_ACCESS_WARNINGS];
  const seasonalWarnings: string[] = [];
  if (pentRoad) {
    accessWarnings.push("Pent road — verify gates, bars, and local access before driving.");
  }
  if (restricted) {
    accessWarnings.push("Road may be closed or restricted seasonally — verify current status before driving.");
  }

  const accessStatus = restricted ? "limited" : "unknown";
  const displayPriority = "high";
  const offroadCategory = offroadCategoryForAotclass(aotclass);

  const bbox = bboxOfTrailPoints(flat) ?? {
    minLat: flat[0]!.lat,
    minLng: flat[0]!.lng,
    maxLat: flat[flat.length - 1]!.lat,
    maxLng: flat[flat.length - 1]!.lng,
  };
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  const sourceKey = `vtrans_phs_local_roads/${objectId}`;

  const tags: Record<string, string> = {
    AOTCLASS: String(aotclass),
    OBJECTID: String(objectId),
  };
  if (props.SEGMENTID != null) tags.SEGMENTID = String(props.SEGMENTID);
  if (props.PRIMARYNAME) tags.PRIMARYNAME = props.PRIMARYNAME;
  if (props.RDFLNAME) tags.RDFLNAME = props.RDFLNAME;
  if (props.RTNAME) tags.RTNAME = props.RTNAME;
  if (props.RTNUMBER != null) tags.RTNUMBER = String(props.RTNUMBER);
  if (props.SURFACETYPE) tags.SURFACETYPE = props.SURFACETYPE;
  if (props.ARCMILES != null) tags.ARCMILES = String(props.ARCMILES);
  if (props.AOTMILES != null) tags.AOTMILES = String(props.AOTMILES);
  if (roadClosed) tags.ROADCLOSED = roadClosed;
  if (pent) tags.PENT = pent;
  if (props.TWN_LR) tags.TWN_LR = props.TWN_LR;
  if (props.CERTYEAR != null) tags.CERTYEAR = String(props.CERTYEAR);
  if (props.MAPYEAR != null) tags.MAPYEAR = String(props.MAPYEAR);

  return {
    id: `route:vtrans:${objectId}`,
    kind: "inventory_route",
    routeKind: routeKindForAotclass(aotclass),
    name,
    normalizedName: normalizeLocavaName(name) ?? name.toLowerCase(),
    activity: "offroading",
    categories: categoriesForAotclass(aotclass),
    activities: ["offroading"],
    center,
    bbox,
    distanceMeters: dist.distanceMeters,
    distanceMiles: dist.distanceMiles,
    distanceLabel: distanceLabel(dist.distanceMiles),
    geometryType: segments.length > 1 ? "MultiLineString" : "LineString",
    coordinates: segments.length === 1 ? segments[0] : undefined,
    segments,
    source: "vtrans_public_highway_system",
    sourceType: "arcgis_feature",
    sourceId: String(objectId),
    sourceKey,
    sourceKeys: [sourceKey],
    sourceDatasetName: "VTrans PublicHighwaySystem Local Roads",
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: 90,
    confidence: "high",
    displayPriority,
    showAtZoom: 12,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    offroad: {
      legalDisplayLabel: "Unmaintained road",
      offroadCategory,
      offroadConfidence: "explicit",
      accessStatus,
      accessWarnings,
      seasonalWarnings,
      sourceSignals: ["vtrans_public_highway_system", `AOTCLASS=${aotclass}`],
      vehicleSignals: {},
      roadClassSignals: {
        vtClass4: aotclass === 4,
        legalTrail: aotclass === 7,
        classTagRaw: String(aotclass),
      },
      surfaceRaw: props.SURFACETYPE ?? undefined,
      roadClosedRaw: roadClosed ?? undefined,
      pentRoadRaw: pent ?? undefined,
      townRouteRaw: props.TWN_LR ?? undefined,
      mapYear: props.MAPYEAR ?? undefined,
      certYear: props.CERTYEAR ?? undefined,
      aotMiles: props.AOTMILES ?? undefined,
      arcMiles: props.ARCMILES ?? undefined,
    },
    assemblyWarnings: restricted ? ["vtrans_road_closed_or_restricted"] : pentRoad ? ["vtrans_pent_road"] : [],
    classificationReason: `vtrans_aotclass_${aotclass}`,
    tagSignals: [`AOTCLASS=${aotclass}`, `distance_${dist.source.toLowerCase()}`],
    negativeSignals: [],
    rejectionReason: null,
    tags,
    attribution: {
      provider: "vtrans",
      license: "public",
      sourceDatasetName: "VTrans PublicHighwaySystem Local Roads",
    },
    importRunId: context.importRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchVtransPage(input: {
  bbox: InventoryBbox;
  includeClass4: boolean;
  includeLegalTrails: boolean;
  resultRecordCount: number;
  resultOffset: number;
  fetchTimeoutMs: number;
}): Promise<{ features: VtransRoadFeature[]; rawCount: number; exceeded: boolean }> {
  const params = buildVtransPhsQueryParams({
    bbox: input.bbox,
    includeClass4: input.includeClass4,
    includeLegalTrails: input.includeLegalTrails,
    resultRecordCount: input.resultRecordCount,
    resultOffset: input.resultOffset,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.fetchTimeoutMs);
  try {
    const res = await fetch(`${VTRANS_PHS_LOCAL_ROADS_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "LocavaInventory/1.0 (VTrans PHS Local Roads)" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`vtrans_phs_query_failed:http_${res.status}`);
    const json = (await res.json()) as {
      features?: EsriQueryFeature[];
      error?: { message?: string };
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`vtrans_phs_query_error:${json.error.message ?? "unknown"}`);
    const raw = json.features ?? [];
    const features = raw.map(esriFeatureToVtransRoadFeature).filter((f): f is VtransRoadFeature => f != null);
    return { features, rawCount: raw.length, exceeded: Boolean(json.exceededTransferLimit) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`vtrans_phs_query_timeout:after_${input.fetchTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchVtransClass4AndLegalTrailsForBbox(input: FetchVtransBboxInput): Promise<VtransRoadFeature[]> {
  const includeClass4 = input.includeClass4 ?? true;
  const includeLegalTrails = input.includeLegalTrails ?? true;
  const resultRecordCount = input.resultRecordCount ?? 1000;
  const maxPages = input.maxPages ?? 20;
  const fetchTimeoutMs = input.fetchTimeoutMs ?? 60_000;

  const seen = new Set<string>();
  const out: VtransRoadFeature[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await fetchVtransPage({
      bbox: input.bbox,
      includeClass4,
      includeLegalTrails,
      resultRecordCount,
      resultOffset: offset,
      fetchTimeoutMs,
    });

    for (const feature of pageResult.features) {
      const objectId = feature.properties?.OBJECTID;
      const segmentId = feature.properties?.SEGMENTID;
      const dedupeKey = objectId != null ? `oid:${objectId}` : segmentId != null ? `seg:${segmentId}` : null;
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);
      out.push(feature);
    }

    if (!pageResult.exceeded || pageResult.rawCount < resultRecordCount) break;
    offset += pageResult.rawCount;
  }

  return out;
}

export async function importVtransRoutesForBbox(input: FetchVtransBboxInput & NormalizeVtransContext): Promise<{
  routes: LocavaInventoryRoute[];
  rawFeatures: VtransRoadFeature[];
  missingGeometry: number;
}> {
  const rawFeatures = mergeVtransRoadFeaturesByIdentity(await fetchVtransClass4AndLegalTrailsForBbox(input));
  const routes: LocavaInventoryRoute[] = [];
  let missingGeometry = 0;

  for (const feature of rawFeatures) {
    const route = normalizeVtransRoadFeatureToInventoryRoute(feature, {
      importRunId: input.importRunId,
      localityLabel: input.localityLabel,
      includeRestrictedAsHidden: input.includeRestrictedAsHidden,
    });
    if (route) routes.push(route);
    else missingGeometry += 1;
  }

  routes.sort((a, b) => b.distanceMeters - a.distanceMeters);
  return { routes, rawFeatures, missingGeometry };
}
