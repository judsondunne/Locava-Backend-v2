import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";

export type EsriGeometryPaths = { paths?: number[][][] };

export type EsriQueryFeature = {
  attributes?: Record<string, unknown>;
  geometry?: EsriGeometryPaths;
};

export type ArcgisLayerQueryInput = {
  layerQueryEndpoint: string;
  bbox: InventoryBbox;
  where?: string;
  outFields?: string;
  resultRecordCount?: number;
  resultOffset?: number;
  fetchTimeoutMs?: number;
  userAgent?: string;
};

/** ArcGIS envelope order: minLng,minLat,maxLng,maxLat */
export function buildArcgisEnvelopeQueryParams(input: {
  bbox: InventoryBbox;
  where?: string;
  outFields?: string;
  resultRecordCount?: number;
  resultOffset?: number;
  f?: "json" | "geojson";
}): URLSearchParams {
  const { minLat, minLng, maxLat, maxLng } = input.bbox;
  const params = new URLSearchParams({
    where: input.where ?? "1=1",
    outFields: input.outFields ?? "*",
    returnGeometry: "true",
    outSR: "4326",
    f: input.f ?? "json",
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

export function esriPathsToGeoJsonGeometry(paths: number[][][]): {
  type: "LineString" | "MultiLineString";
  coordinates: number[][] | number[][][];
} | null {
  if (!paths.length || !paths[0]?.length) return null;
  if (paths.length === 1) {
    return {
      type: "LineString",
      coordinates: paths[0]!.map((pair) => [pair[0]!, pair[1]!] as [number, number]),
    };
  }
  return {
    type: "MultiLineString",
    coordinates: paths.map((path) => path.map((pair) => [pair[0]!, pair[1]!] as [number, number])),
  };
}

export function esriFeatureToRawLineFeature(input: {
  feature: EsriQueryFeature;
  sourceId: string;
  featureIdPrefix: string;
  layerId?: number;
}): {
  featureId: string;
  geometryType: "LineString" | "MultiLineString";
  geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
  properties: Record<string, unknown>;
} | null {
  const paths = input.feature.geometry?.paths;
  if (!paths?.length) return null;
  const geometry = esriPathsToGeoJsonGeometry(paths);
  if (!geometry) return null;
  const attrs = input.feature.attributes ?? {};
  const oid =
    attrs.OBJECTID ?? attrs.objectid ?? attrs.FID ?? attrs.fid ?? attrs.GlobalID ?? attrs.globalid;
  const featureId = oid != null ? `${input.featureIdPrefix}/${oid}` : `${input.featureIdPrefix}/unknown`;
  return {
    featureId,
    geometryType: geometry.type,
    geometry,
    properties: { ...attrs, _layerId: input.layerId },
  };
}

export async function fetchArcgisLayerPage(input: ArcgisLayerQueryInput): Promise<{
  features: EsriQueryFeature[];
  rawCount: number;
  exceeded: boolean;
}> {
  const params = buildArcgisEnvelopeQueryParams({
    bbox: input.bbox,
    where: input.where,
    outFields: input.outFields,
    resultRecordCount: input.resultRecordCount,
    resultOffset: input.resultOffset,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.fetchTimeoutMs ?? 60_000);
  try {
    const res = await fetch(`${input.layerQueryEndpoint}?${params.toString()}`, {
      headers: { "User-Agent": input.userAgent ?? "LocavaOffroad/1.0 (ArcGIS query)" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`arcgis_query_failed:http_${res.status}`);
    const json = (await res.json()) as {
      features?: EsriQueryFeature[];
      error?: { message?: string };
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`arcgis_query_error:${json.error.message ?? "unknown"}`);
    const raw = json.features ?? [];
    return { features: raw, rawCount: raw.length, exceeded: Boolean(json.exceededTransferLimit) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`arcgis_query_timeout:after_${input.fetchTimeoutMs ?? 60_000}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchArcgisLayerPaginated(input: {
  layerQueryEndpoint: string;
  bbox: InventoryBbox;
  where?: string;
  outFields?: string;
  pageSize?: number;
  maxPages?: number;
  fetchTimeoutMs?: number;
  userAgent?: string;
}): Promise<EsriQueryFeature[]> {
  const pageSize = input.pageSize ?? 1000;
  const maxPages = input.maxPages ?? 20;
  const seen = new Set<string>();
  const out: EsriQueryFeature[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await fetchArcgisLayerPage({
      layerQueryEndpoint: input.layerQueryEndpoint,
      bbox: input.bbox,
      where: input.where,
      outFields: input.outFields,
      resultRecordCount: pageSize,
      resultOffset: offset,
      fetchTimeoutMs: input.fetchTimeoutMs,
      userAgent: input.userAgent,
    });

    for (const feature of pageResult.features) {
      const attrs = feature.attributes ?? {};
      const oid = attrs.OBJECTID ?? attrs.objectid ?? attrs.FID ?? attrs.fid;
      const key = oid != null ? String(oid) : JSON.stringify(attrs).slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(feature);
    }

    if (!pageResult.exceeded || pageResult.rawCount < pageSize) break;
    offset += pageResult.rawCount;
  }

  return out;
}
