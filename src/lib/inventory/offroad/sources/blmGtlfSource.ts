import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import {
  buildArcgisEnvelopeQueryParams,
  fetchArcgisLayerPaginated,
  esriFeatureToRawLineFeature,
  type EsriQueryFeature,
} from "./arcgisOffroadQuery.js";
import {
  BLM_GTLF_WARNINGS,
  type NationalOffroadSourceAdapter,
  type OffroadBboxFetchInput,
  type OffroadNormalizeContext,
  type OffroadRawFeature,
  type OffroadStateFetchInput,
  type RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";
import { buildFederalOffroadRoute, featureDisplayName, geoJsonLineToTrailPoints } from "./offroadRouteBuilder.js";

export const BLM_GTLF_MAPSERVER =
  "https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer";

export const BLM_GTLF_PUBLIC_ROADS = 0;
export const BLM_GTLF_LIMITED_ROADS = 1;
export const BLM_GTLF_PUBLIC_TRAILS = 2;
export const BLM_GTLF_LIMITED_TRAILS = 3;
export const BLM_GTLF_NOT_ASSESSED_ROADS = 6;
export const BLM_GTLF_NOT_ASSESSED_TRAILS = 7;

export const BLM_GTLF_DEFAULT_LAYERS = [
  BLM_GTLF_PUBLIC_ROADS,
  BLM_GTLF_LIMITED_ROADS,
  BLM_GTLF_PUBLIC_TRAILS,
  BLM_GTLF_LIMITED_TRAILS,
];

const LAYER_META: Record<
  number,
  { accessStatus: "public" | "limited" | "unknown"; legalLabel: "Motorized route" | "Limited motorized route"; category: string }
> = {
  [BLM_GTLF_PUBLIC_ROADS]: { accessStatus: "public", legalLabel: "Motorized route", category: "blm_public_motorized_road" },
  [BLM_GTLF_LIMITED_ROADS]: { accessStatus: "limited", legalLabel: "Limited motorized route", category: "blm_limited_motorized_road" },
  [BLM_GTLF_PUBLIC_TRAILS]: { accessStatus: "public", legalLabel: "Motorized route", category: "blm_public_motorized_trail" },
  [BLM_GTLF_LIMITED_TRAILS]: { accessStatus: "limited", legalLabel: "Limited motorized route", category: "blm_limited_motorized_trail" },
  [BLM_GTLF_NOT_ASSESSED_ROADS]: { accessStatus: "unknown", legalLabel: "Motorized route", category: "blm_not_assessed_road" },
  [BLM_GTLF_NOT_ASSESSED_TRAILS]: { accessStatus: "unknown", legalLabel: "Motorized route", category: "blm_not_assessed_trail" },
};

function layerEndpoint(layerId: number): string {
  return `${BLM_GTLF_MAPSERVER}/${layerId}/query`;
}

function esriToOffroadRaw(feature: EsriQueryFeature, layerId: number): OffroadRawFeature | null {
  const converted = esriFeatureToRawLineFeature({
    feature,
    sourceId: "blm_gtlf",
    featureIdPrefix: `blm_gtlf/l${layerId}`,
    layerId,
  });
  if (!converted) return null;
  return {
    sourceId: "blm_gtlf",
    sourceType: "blm_gtlf",
    featureId: converted.featureId,
    geometryType: converted.geometryType,
    geometry: converted.geometry,
    properties: converted.properties,
    layerId,
  };
}

async function fetchLayersForBbox(input: {
  bbox: InventoryBbox;
  layerIds: number[];
  pageSize?: number;
  maxPages?: number;
}): Promise<OffroadRawFeature[]> {
  const out: OffroadRawFeature[] = [];
  for (const layerId of input.layerIds) {
    const esriFeatures = await fetchArcgisLayerPaginated({
      layerQueryEndpoint: layerEndpoint(layerId),
      bbox: input.bbox,
      pageSize: input.pageSize,
      maxPages: input.maxPages,
      userAgent: "LocavaOffroad/1.0 (BLM GTLF)",
    });
    for (const f of esriFeatures) {
      const raw = esriToOffroadRaw(f, layerId);
      if (raw) out.push(raw);
    }
  }
  return out;
}

export const blmGtlfAdapter: NationalOffroadSourceAdapter = {
  sourceId: "blm_gtlf",
  sourceName: "BLM National Ground Transportation Linear Features",
  supportsState: () => true,

  async fetchForBbox(input: OffroadBboxFetchInput & { layerIds?: number[] }): Promise<OffroadRawFeature[]> {
    const layerIds = input.layerIds ?? BLM_GTLF_DEFAULT_LAYERS;
    return fetchLayersForBbox({
      bbox: input.bbox,
      layerIds,
      pageSize: input.pageSize,
      maxPages: input.maxPages,
    });
  },

  async fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]> {
    if (!input.bbox) return [];
    const layerIds = [...BLM_GTLF_DEFAULT_LAYERS];
    if (input.includeNotAssessedBlm) {
      layerIds.push(BLM_GTLF_NOT_ASSESSED_ROADS, BLM_GTLF_NOT_ASSESSED_TRAILS);
    }
    return fetchLayersForBbox({
      bbox: input.bbox,
      layerIds,
      pageSize: input.pageSize,
      maxPages: input.maxPagesPerChunk ?? input.maxPages,
    });
  },

  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): LocavaInventoryRoute | RejectedOffroadCandidate | null {
    const layerId = feature.layerId ?? BLM_GTLF_PUBLIC_ROADS;
    const meta = LAYER_META[layerId];
    if (!meta) {
      return { kind: "rejected", sourceId: "blm_gtlf", reason: "unknown_layer", properties: feature.properties };
    }

    if (feature.geometryType !== "LineString" && feature.geometryType !== "MultiLineString") {
      return { kind: "rejected", sourceId: "blm_gtlf", reason: "not_line_geometry", properties: feature.properties };
    }

    const isNotAssessed =
      layerId === BLM_GTLF_NOT_ASSESSED_ROADS || layerId === BLM_GTLF_NOT_ASSESSED_TRAILS;
    const { segments, flat } = geoJsonLineToTrailPoints(
      feature.geometry as { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] }
    );
    const name = featureDisplayName(feature.properties, `BLM route L${layerId}`);
    const oid = feature.properties.OBJECTID ?? feature.properties.objectid;
    const sourceId = oid != null ? String(oid) : feature.featureId;

    const tags: Record<string, string> = { state: context.stateCode, blm_layer: String(layerId) };
    for (const [k, v] of Object.entries(feature.properties)) {
      if (v != null && k !== "_layerId") tags[k] = String(v);
    }

    return buildFederalOffroadRoute({
      source: "blm_gtlf",
      sourceId,
      sourceKey: `blm_gtlf/${feature.featureId}`,
      sourceDatasetName: "BLM National Ground Transportation Linear Features",
      sourceType: "arcgis_feature",
      name,
      segments,
      flat,
      importRunId: context.importRunId,
      stateCode: context.stateCode,
      accessStatus: meta.accessStatus,
      accessWarnings: [...BLM_GTLF_WARNINGS],
      legalDisplayLabel: meta.legalLabel,
      offroadCategory: meta.category,
      confidence: meta.accessStatus === "limited" ? "official_limited" : "official_federal",
      displayPriority: isNotAssessed ? "hidden" : meta.accessStatus === "limited" ? "medium" : "high",
      sourceSignals: ["blm_gtlf", `layer=${layerId}`, meta.accessStatus],
      tags,
      attribution: {
        provider: "blm",
        license: "public",
        sourceDatasetName: "BLM National Ground Transportation Linear Features",
      },
    });
  },
};

export function blmGtlfLayerQueryUrl(bbox: InventoryBbox, layerId: number): string {
  return `${layerEndpoint(layerId)}?${buildArcgisEnvelopeQueryParams({ bbox }).toString()}`;
}
