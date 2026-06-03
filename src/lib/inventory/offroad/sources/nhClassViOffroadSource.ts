import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import {
  importNhdotClass6RoutesForBbox,
  normalizeNhdotRoadFeatureToInventoryRoute,
  type NhdotRoadFeature,
  NHDOT_LEGISLATIVE_CLASS_ENDPOINT,
} from "./nhNhdotLegislativeClassSource.js";
import type {
  NationalOffroadSourceAdapter,
  OffroadBboxFetchInput,
  OffroadNormalizeContext,
  OffroadRawFeature,
  OffroadStateFetchInput,
  RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";

function nhdotFeatureToRaw(f: NhdotRoadFeature): OffroadRawFeature {
  return {
    sourceId: "nh_class_vi_roads",
    sourceType: "state_arcgis",
    featureId: `nhdot/${f.properties.OBJECTID ?? "unknown"}`,
    geometryType: f.geometry.type,
    geometry: f.geometry,
    properties: f.properties as Record<string, unknown>,
  };
}

function rawToNhdotFeature(raw: OffroadRawFeature): NhdotRoadFeature | null {
  if (!raw.geometry || (raw.geometryType !== "LineString" && raw.geometryType !== "MultiLineString")) return null;
  return {
    type: "Feature",
    properties: raw.properties as NhdotRoadFeature["properties"],
    geometry: raw.geometry as NhdotRoadFeature["geometry"],
  };
}

export const nhClassViOffroadAdapter: NationalOffroadSourceAdapter = {
  sourceId: "nh_class_vi_roads",
  sourceName: "NHDOT Legislative Class VI roads",
  supportsState: (code) => code.toUpperCase() === "NH",

  async fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]> {
    const imported = await importNhdotClass6RoutesForBbox({
      bbox: input.bbox,
      includeClass6: true,
      importRunId: input.importRunId,
      resultRecordCount: input.pageSize ?? 1000,
      maxPages: input.maxPages ?? 50,
    });
    return imported.rawFeatures.map(nhdotFeatureToRaw);
  },

  async fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]> {
    if (!input.bbox) return [];
    return this.fetchForBbox({
      bbox: input.bbox,
      dryRun: true,
      importRunId: input.importRunId,
      pageSize: input.pageSize,
      maxPages: input.maxPagesPerChunk ?? 50,
    });
  },

  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): LocavaInventoryRoute | RejectedOffroadCandidate | null {
    const nhdotFeature = rawToNhdotFeature(feature);
    if (!nhdotFeature) {
      return { kind: "rejected", sourceId: "nh_class_vi_roads", reason: "invalid_geometry", properties: feature.properties };
    }
    const route = normalizeNhdotRoadFeatureToInventoryRoute(nhdotFeature, {
      importRunId: context.importRunId,
      localityLabel: context.stateCode,
    });
    if (!route) {
      return { kind: "rejected", sourceId: "nh_class_vi_roads", reason: "normalization_failed", properties: feature.properties };
    }
    route.tags = { ...route.tags, state: context.stateCode };
    return route;
  },
};

export { NHDOT_LEGISLATIVE_CLASS_ENDPOINT };
