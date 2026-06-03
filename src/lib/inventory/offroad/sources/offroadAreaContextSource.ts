import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import {
  buildArcgisEnvelopeQueryParams,
  fetchArcgisLayerPaginated,
  type EsriQueryFeature,
} from "./arcgisOffroadQuery.js";
import type {
  NationalOffroadSourceAdapter,
  OffroadAreaContext,
  OffroadBboxFetchInput,
  OffroadNormalizeContext,
  OffroadRawFeature,
  OffroadStateFetchInput,
  RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";

export const CA_BLM_OHV_ENDPOINT =
  "https://gis.blm.gov/caarcgis/rest/services/transportation/BLM_CA_OHV/FeatureServer/0/query";

function ringToBbox(ring: number[][]): InventoryBbox | null {
  if (!ring.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const [lng, lat] of ring) {
    if (lat! < minLat) minLat = lat!;
    if (lat! > maxLat) maxLat = lat!;
    if (lng! < minLng) minLng = lng!;
    if (lng! > maxLng) maxLng = lng!;
  }
  return { minLat, minLng, maxLat, maxLng };
}

function esriRingsToPolygonFeature(feature: EsriQueryFeature, sourceId: string): OffroadRawFeature | null {
  const rings = (feature.geometry as { rings?: number[][][] })?.rings;
  if (!rings?.length || !rings[0]?.length) return null;
  const attrs = feature.attributes ?? {};
  const oid = attrs.OBJECTID ?? attrs.objectid ?? attrs.FID;
  return {
    sourceId,
    sourceType: "area_context",
    featureId: `${sourceId}/${oid ?? "unknown"}`,
    geometryType: rings.length > 1 ? "MultiPolygon" : "Polygon",
    geometry: { type: "Polygon", coordinates: rings },
    properties: attrs,
  };
}

function parseOhvDesignation(value: unknown): OffroadAreaContext["designation"] {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "open") return "open";
  if (v === "limited") return "limited";
  if (v === "closed") return "closed";
  if (v === "undesignated") return "undesignated";
  return "unknown";
}

export const caBlmOhvAreaAdapter: NationalOffroadSourceAdapter = {
  sourceId: "ca_blm_ohv_areas",
  sourceName: "BLM CA Off Highway Vehicle Areas",
  supportsState: (code) => code.toUpperCase() === "CA",

  async fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]> {
    const esriFeatures = await fetchArcgisLayerPaginated({
      layerQueryEndpoint: CA_BLM_OHV_ENDPOINT,
      bbox: input.bbox,
      pageSize: input.pageSize ?? 500,
      maxPages: input.maxPages ?? 10,
      userAgent: "LocavaOffroad/1.0 (BLM CA OHV areas)",
    });
    return esriFeatures
      .map((f) => esriRingsToPolygonFeature(f, "ca_blm_ohv_areas"))
      .filter((f): f is OffroadRawFeature => f != null);
  },

  async fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]> {
    if (!input.bbox) return [];
    return this.fetchForBbox({ bbox: input.bbox, dryRun: true, importRunId: input.importRunId });
  },

  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): OffroadAreaContext | RejectedOffroadCandidate | LocavaInventoryRoute | null {
    const rings = (feature.geometry as { coordinates?: number[][][] })?.coordinates;
    const ring = rings?.[0];
    if (!ring?.length) {
      return { kind: "rejected", sourceId: "ca_blm_ohv_areas", reason: "not_polygon", properties: feature.properties };
    }
    const bbox = ringToBbox(ring);
    if (!bbox) {
      return { kind: "rejected", sourceId: "ca_blm_ohv_areas", reason: "invalid_bbox", properties: feature.properties };
    }
    const designation = parseOhvDesignation(feature.properties.LUP_OHV_DSGNTN ?? feature.properties.lup_ohv_dsgntn);
    const warnings: string[] = [];
    if (designation === "closed") {
      warnings.push("BLM OHV area designated Closed — do not assume route access inside this boundary.");
    }

    return {
      id: feature.featureId,
      sourceId: "ca_blm_ohv_areas",
      sourceDatasetName: "BLM CA Off Highway Vehicle Areas",
      stateCode: context.stateCode,
      designation,
      bbox,
      center: { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 },
      properties: feature.properties,
      warnings,
    };
  },
};

export function caBlmOhvQueryUrl(bbox: InventoryBbox): string {
  return `${CA_BLM_OHV_ENDPOINT}?${buildArcgisEnvelopeQueryParams({ bbox }).toString()}`;
}
