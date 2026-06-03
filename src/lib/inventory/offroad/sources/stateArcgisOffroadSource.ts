import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import { fetchArcgisLayerPaginated, type EsriQueryFeature } from "./arcgisOffroadQuery.js";
import {
  importVtransRoutesForBbox,
  normalizeVtransRoadFeatureToInventoryRoute,
  type VtransRoadFeature,
  esriFeatureToVtransRoadFeature,
} from "./vtransPublicHighwaySystemSource.js";
import type {
  NationalOffroadSourceAdapter,
  OffroadBboxFetchInput,
  OffroadNormalizeContext,
  OffroadRawFeature,
  OffroadStateFetchInput,
  RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";

export type StateArcgisSourceConfig = {
  sourceId: string;
  sourceName: string;
  stateCode: string;
  endpoint: string;
  whereClause: string;
  outFields?: string;
  /** Maps to vtrans normalizer when sourceId is vt_vtrans */
  useVtransNormalizer?: boolean;
};

export function createStateArcgisAdapter(config: StateArcgisSourceConfig): NationalOffroadSourceAdapter {
  return {
    sourceId: config.sourceId,
    sourceName: config.sourceName,
    supportsState: (code) => code.toUpperCase() === config.stateCode.toUpperCase(),

    async fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]> {
      if (config.useVtransNormalizer && config.sourceId === "vt_vtrans_public_highway_system") {
        const imported = await importVtransRoutesForBbox({
          bbox: input.bbox,
          includeClass4: true,
          includeLegalTrails: true,
          importRunId: input.importRunId,
        });
        return imported.rawFeatures.map((f) => vtransFeatureToRaw(f));
      }

      const esriFeatures = await fetchArcgisLayerPaginated({
        layerQueryEndpoint: config.endpoint,
        bbox: input.bbox,
        where: config.whereClause,
        outFields: config.outFields,
        pageSize: input.pageSize,
        maxPages: input.maxPages,
        userAgent: `LocavaOffroad/1.0 (${config.sourceId})`,
      });

      return esriFeatures
        .map((f) => esriToRaw(f, config.sourceId))
        .filter((f): f is OffroadRawFeature => f != null);
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
      if (config.useVtransNormalizer) {
        const vtransFeature = rawToVtransFeature(feature);
        if (!vtransFeature) {
          return { kind: "rejected", sourceId: config.sourceId, reason: "invalid_geometry", properties: feature.properties };
        }
        const route = normalizeVtransRoadFeatureToInventoryRoute(vtransFeature, {
          importRunId: context.importRunId,
          localityLabel: context.stateCode,
          includeRestrictedAsHidden: false,
        });
        if (!route) {
          return { kind: "rejected", sourceId: config.sourceId, reason: "normalization_failed", properties: feature.properties };
        }
        route.tags = { ...route.tags, state: context.stateCode };
        return route;
      }
      return { kind: "rejected", sourceId: config.sourceId, reason: "needs_validation", properties: feature.properties };
    },
  };
}

function vtransFeatureToRaw(f: VtransRoadFeature): OffroadRawFeature {
  return {
    sourceId: "vt_vtrans_public_highway_system",
    sourceType: "state_arcgis",
    featureId: `vtrans/${f.properties.OBJECTID ?? "unknown"}`,
    geometryType: f.geometry.type,
    geometry: f.geometry,
    properties: f.properties as Record<string, unknown>,
  };
}

function rawToVtransFeature(raw: OffroadRawFeature): VtransRoadFeature | null {
  if (!raw.geometry || (raw.geometryType !== "LineString" && raw.geometryType !== "MultiLineString")) return null;
  return {
    type: "Feature",
    properties: raw.properties as VtransRoadFeature["properties"],
    geometry: raw.geometry as VtransRoadFeature["geometry"],
  };
}

function esriToRaw(feature: EsriQueryFeature, sourceId: string): OffroadRawFeature | null {
  const vtrans = esriFeatureToVtransRoadFeature(
    feature as Parameters<typeof esriFeatureToVtransRoadFeature>[0]
  );
  if (!vtrans) return null;
  return vtransFeatureToRaw(vtrans);
}

export const vtVtransArcgisAdapter = createStateArcgisAdapter({
  sourceId: "vt_vtrans_public_highway_system",
  sourceName: "VTrans PublicHighwaySystem Local Roads",
  stateCode: "VT",
  endpoint: "https://maps.vtrans.vermont.gov/arcgis/rest/services/Layers/PublicHighwaySystem/MapServer/6/query",
  whereClause: "AOTCLASS IN (4,7)",
  outFields: "OBJECTID,SEGMENTID,PRIMARYNAME,RTNAME,RTNUMBER,RDFLNAME,AOTCLASS,SURFACETYPE,ARCMILES,AOTMILES,ROADCLOSED,PENT,TWN_LR,CERTYEAR,MAPYEAR",
  useVtransNormalizer: true,
});
