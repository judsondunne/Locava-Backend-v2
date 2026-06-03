import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import {
  buildArcgisEnvelopeQueryParams,
  fetchArcgisLayerPaginated,
  esriFeatureToRawLineFeature,
  type EsriQueryFeature,
} from "./arcgisOffroadQuery.js";
import {
  USFS_MVUM_WARNINGS,
  type NationalOffroadSourceAdapter,
  type OffroadBboxFetchInput,
  type OffroadNormalizeContext,
  type OffroadRawFeature,
  type OffroadStateFetchInput,
  type RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";
import { buildFederalOffroadRoute, featureDisplayName, geoJsonLineToTrailPoints } from "./offroadRouteBuilder.js";

export const USFS_MVUM_MAPSERVER = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer";
export const USFS_MVUM_ROADS_LAYER = 1;
export const USFS_MVUM_TRAILS_LAYER = 2;

const LAYER_NAMES: Record<number, string> = {
  [USFS_MVUM_ROADS_LAYER]: "MVUM Roads",
  [USFS_MVUM_TRAILS_LAYER]: "MVUM Trails",
};

function layerEndpoint(layerId: number): string {
  return `${USFS_MVUM_MAPSERVER}/${layerId}/query`;
}

async function fetchLayerForBbox(input: {
  bbox: InventoryBbox;
  layerId: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<OffroadRawFeature[]> {
  const esriFeatures = await fetchArcgisLayerPaginated({
    layerQueryEndpoint: layerEndpoint(input.layerId),
    bbox: input.bbox,
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    userAgent: "LocavaOffroad/1.0 (USFS MVUM)",
  });

  const out: OffroadRawFeature[] = [];
  for (const f of esriFeatures) {
    const raw = esriToOffroadRaw(f, input.layerId);
    if (raw) out.push(raw);
  }
  return out;
}

function esriToOffroadRaw(feature: EsriQueryFeature, layerId: number): OffroadRawFeature | null {
  const converted = esriFeatureToRawLineFeature({
    feature,
    sourceId: "usfs_mvum",
    featureIdPrefix: `usfs_mvum/l${layerId}`,
    layerId,
  });
  if (!converted) return null;
  return {
    sourceId: "usfs_mvum",
    sourceType: "usfs_mvum",
    featureId: converted.featureId,
    geometryType: converted.geometryType,
    geometry: converted.geometry,
    properties: converted.properties,
    layerId,
  };
}

export const usfsMvumAdapter: NationalOffroadSourceAdapter = {
  sourceId: "usfs_mvum",
  sourceName: "USFS Motor Vehicle Use Map",
  supportsState: () => true,

  async fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]> {
    const pageSize = input.pageSize ?? 1000;
    const maxPages = input.maxPages ?? 20;
    const roads = await fetchLayerForBbox({ bbox: input.bbox, layerId: USFS_MVUM_ROADS_LAYER, pageSize, maxPages });
    const trails = await fetchLayerForBbox({ bbox: input.bbox, layerId: USFS_MVUM_TRAILS_LAYER, pageSize, maxPages });
    return [...roads, ...trails];
  },

  async fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]> {
    if (!input.bbox) return [];
    return this.fetchForBbox({
      bbox: input.bbox,
      dryRun: true,
      importRunId: input.importRunId,
      pageSize: input.pageSize,
      maxPages: input.maxPagesPerChunk ?? input.maxPages,
    });
  },

  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): LocavaInventoryRoute | RejectedOffroadCandidate | null {
    if (feature.geometryType !== "LineString" && feature.geometryType !== "MultiLineString") {
      return { kind: "rejected", sourceId: "usfs_mvum", reason: "not_line_geometry", properties: feature.properties };
    }
    const { segments, flat } = geoJsonLineToTrailPoints(
      feature.geometry as { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] }
    );
    const layerName = LAYER_NAMES[feature.layerId ?? USFS_MVUM_ROADS_LAYER] ?? "MVUM";
    const name = featureDisplayName(feature.properties, `${layerName} segment`);
    const oid = feature.properties.OBJECTID ?? feature.properties.objectid;
    const sourceId = oid != null ? String(oid) : feature.featureId.split("/").pop() ?? "unknown";

    const tags: Record<string, string> = { state: context.stateCode };
    for (const [k, v] of Object.entries(feature.properties)) {
      if (v != null && k !== "_layerId") tags[k] = String(v);
    }
    if (feature.layerId != null) tags._mvumLayer = String(feature.layerId);

    return buildFederalOffroadRoute({
      source: "usfs_mvum",
      sourceId,
      sourceKey: `usfs_mvum/${feature.featureId}`,
      sourceDatasetName: "USFS Motor Vehicle Use Map",
      sourceType: "arcgis_feature",
      name,
      segments,
      flat,
      importRunId: context.importRunId,
      stateCode: context.stateCode,
      accessStatus: "designated",
      accessWarnings: [...USFS_MVUM_WARNINGS],
      legalDisplayLabel: "Motorized route",
      offroadCategory: feature.layerId === USFS_MVUM_TRAILS_LAYER ? "mvum_trail" : "mvum_road",
      confidence: "official_federal",
      sourceSignals: ["usfs_mvum", `layer=${feature.layerId ?? "?"}`],
      tags,
      attribution: {
        provider: "usfs",
        license: "public",
        sourceDatasetName: "USFS Motor Vehicle Use Map",
      },
    });
  },
};

export function usfsMvumLayerQueryUrl(bbox: InventoryBbox, layerId: number): string {
  return `${layerEndpoint(layerId)}?${buildArcgisEnvelopeQueryParams({ bbox }).toString()}`;
}
