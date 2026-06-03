import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import {
  buildArcgisEnvelopeQueryParams,
  fetchArcgisLayerPage,
} from "./sources/arcgisOffroadQuery.js";
import type { OffroadSourceRegistryEntry, OffroadSourceStatus } from "./sources/nationalOffroadSource.types.js";

export type SourceValidationResult = {
  sourceId: string;
  reachable: boolean;
  supportsQuery: boolean;
  supportsGeometry: boolean;
  supportsPagination: boolean;
  geometryTypes: string[];
  sampleFieldKeys: string[];
  bboxQueryWorks: boolean;
  latLngOrderOk: boolean;
  hasAttribution: boolean;
  recommendedStatus: OffroadSourceStatus;
  errors: string[];
  warnings: string[];
};

const SAMPLE_BBOX: InventoryBbox = {
  minLat: 43.5,
  minLng: -72.45,
  maxLat: 43.55,
  maxLng: -72.4,
};

export function canSourcePublishPublic(source: OffroadSourceRegistryEntry): boolean {
  return source.status === "active" && source.sourceType !== "needs_research";
}

export async function validateOffroadSourceEndpoint(
  source: OffroadSourceRegistryEntry,
  sampleBbox: InventoryBbox = SAMPLE_BBOX
): Promise<SourceValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let reachable = false;
  let supportsQuery = false;
  let supportsGeometry = false;
  let supportsPagination = false;
  let bboxQueryWorks = false;
  let latLngOrderOk = true;
  const geometryTypes: string[] = [];
  const sampleFieldKeys: string[] = [];

  if (!source.endpoint) {
    return {
      sourceId: source.sourceId,
      reachable: false,
      supportsQuery: false,
      supportsGeometry: false,
      supportsPagination: false,
      geometryTypes: [],
      sampleFieldKeys: [],
      bboxQueryWorks: false,
      latLngOrderOk: true,
      hasAttribution: Boolean(source.attribution?.trim()),
      recommendedStatus: source.status === "needs_source" ? "needs_source" : "needs_validation",
      errors: ["no_endpoint"],
      warnings,
    };
  }

  if (source.queryFormat !== "arcgis") {
    return {
      sourceId: source.sourceId,
      reachable: true,
      supportsQuery: source.queryFormat === "overpass",
      supportsGeometry: true,
      supportsPagination: source.supportsPagination,
      geometryTypes: ["line"],
      sampleFieldKeys: [],
      bboxQueryWorks: true,
      latLngOrderOk: true,
      hasAttribution: Boolean(source.attribution?.trim()),
      recommendedStatus: source.status,
      errors: [],
      warnings: ["non_arcgis_validation_skipped"],
    };
  }

  try {
    const page = await fetchArcgisLayerPage({
      layerQueryEndpoint: source.endpoint,
      bbox: sampleBbox,
      where: source.whereClause ?? "1=1",
      outFields: source.outFields ?? "*",
      resultRecordCount: 5,
      fetchTimeoutMs: 30_000,
    });
    reachable = true;
    supportsQuery = true;
    bboxQueryWorks = true;
    supportsPagination = page.exceeded || page.rawCount > 0;

    for (const f of page.features) {
      if (f.geometry?.paths?.length) {
        supportsGeometry = true;
        geometryTypes.push("LineString");
        const path = f.geometry.paths[0]![0];
        if (path && Math.abs(path[1]!) > 90) {
          latLngOrderOk = false;
          warnings.push("possible_lat_lng_swap");
        }
      }
      const rings = (f.geometry as { rings?: number[][][] })?.rings;
      if (rings?.length) {
        supportsGeometry = true;
        geometryTypes.push("Polygon");
      }
      if (f.attributes) sampleFieldKeys.push(...Object.keys(f.attributes));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const hasAttribution = Boolean(source.attribution?.trim());
  if (!hasAttribution) warnings.push("missing_attribution");

  let recommendedStatus: OffroadSourceStatus = source.status;
  if (errors.length) recommendedStatus = "failed";
  else if (!supportsGeometry && !source.areaContextOnly) recommendedStatus = "needs_validation";
  else if (source.status === "needs_validation" && supportsGeometry && bboxQueryWorks) {
    recommendedStatus = "needs_validation";
  } else if (source.status === "active" && supportsGeometry) {
    recommendedStatus = "active";
  }

  return {
    sourceId: source.sourceId,
    reachable,
    supportsQuery,
    supportsGeometry,
    supportsPagination,
    geometryTypes: [...new Set(geometryTypes)],
    sampleFieldKeys: [...new Set(sampleFieldKeys)].slice(0, 40),
    bboxQueryWorks,
    latLngOrderOk,
    hasAttribution,
    recommendedStatus,
    errors,
    warnings,
  };
}

export function buildArcgisValidationProbeUrl(source: OffroadSourceRegistryEntry, bbox: InventoryBbox): string | null {
  if (!source.endpoint || source.queryFormat !== "arcgis") return null;
  return `${source.endpoint}?${buildArcgisEnvelopeQueryParams({
    bbox,
    where: source.whereClause,
    outFields: source.outFields ?? "*",
    resultRecordCount: 5,
  }).toString()}`;
}
