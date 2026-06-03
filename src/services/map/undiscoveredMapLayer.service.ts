import { createHash } from "node:crypto";
import {
  MAP_LAYER_UNDISCOVERED_V1_ID,
  type UndiscoveredMapLayerResponse,
} from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import { globalCache } from "../../cache/global-cache.js";
import { loadEnv } from "../../config/env.js";
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { normalizeUnexploredLayerDocs } from "./undiscoveredMapLayer.normalizer.js";
import { applyUndiscoveredZoomFilter } from "./undiscoveredMapLayer.zoomFilter.js";
import { mergeRouteFragmentFeatures } from "./undiscoveredMapLayer.mergeRoutes.js";
import { mapZoomFromLatitudeDelta } from "../../lib/map/undiscoveredMapVisibility.js";

const env = loadEnv();

export const UNDISCOVERED_LAYER_VERSION_BASE = "undiscovered-osm-v1";

function parseBbox(raw: string): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} | null {
  const parts = raw.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

function layerVersionForFeatures(features: { updatedAt?: string | number }[]): string {
  const stamps = features
    .map((f) => f.updatedAt)
    .filter((v) => v != null)
    .map((v) => String(v))
    .sort();
  if (stamps.length === 0) return UNDISCOVERED_LAYER_VERSION_BASE;
  const tail = stamps.slice(-50).join("|");
  const hash = createHash("sha1").update(tail).digest("hex").slice(0, 12);
  return `${UNDISCOVERED_LAYER_VERSION_BASE}:${hash}`;
}

function etagFor(layerVersion: string, bboxKey: string): string {
  return `"${createHash("sha1").update(`${layerVersion}:${bboxKey}`).digest("hex").slice(0, 16)}"`;
}

export async function fetchUndiscoveredMapLayer(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  zoom?: number;
  mode?: "durable" | "viewport";
  layerVersionHint?: string | null;
}): Promise<{
  response: UndiscoveredMapLayerResponse;
  cacheHit: boolean;
  reads: number;
  docsScanned: number;
}> {
  const started = Date.now();
  const bboxKey = `${input.bbox.minLng},${input.bbox.minLat},${input.bbox.maxLng},${input.bbox.maxLat}`;
  const cacheKey = `map:layer:undiscovered:v1:${bboxKey}:z${input.zoom ?? 0}:${input.mode ?? "durable"}`;
  const cached = await globalCache.get<UndiscoveredMapLayerResponse>(cacheKey);
  if (cached) {
    return {
      response: {
        ...cached,
        diagnostics: {
          ...cached.diagnostics,
          cacheHit: true,
          cacheSource: "hit",
          fetchMs: Date.now() - started,
        },
      },
      cacheHit: true,
      reads: 0,
      docsScanned: 0,
    };
  }

  const limit = Math.min(4000, Math.max(500, env.MAP_MARKERS_MAX_DOCS));
  const spots = await queryUnexploredSpotsInBbox({
    bbox: input.bbox,
    limit,
    publicOnly: true,
  });
  const routes = await queryUnexploredRoutesInBbox({
    bbox: input.bbox,
    limit: Math.min(2000, limit),
    publicOnly: true,
  });
  const reads = 2;
  const docsScanned = spots.length + routes.length;
  const normalized = await normalizeUnexploredLayerDocs({ spots, routes });
  const merged = mergeRouteFragmentFeatures(normalized.features);
  const sourceDocs = new Map<string, Record<string, unknown>>();
  for (const doc of [...spots, ...routes]) {
    const id = typeof doc.id === "string" ? doc.id : "";
    if (id) sourceDocs.set(id, doc);
  }
  const bboxSpanLat = input.bbox.maxLat - input.bbox.minLat;
  const mapZoom =
    input.zoom ??
    mapZoomFromLatitudeDelta(Math.max(bboxSpanLat, (input.bbox.maxLng - input.bbox.minLng) * 0.7));
  const filtered = applyUndiscoveredZoomFilter({
    features: merged.features,
    zoom: mapZoom,
    sourceDocs,
    mergedRouteFragmentCount: merged.mergedRouteFragmentCount,
  });
  const layerVersion = input.layerVersionHint?.trim() || layerVersionForFeatures(normalized.features);
  const points = filtered.features.filter((f) => f.featureKind === "point").length;
  const routesCount = filtered.features.filter((f) => f.featureKind === "route").length;
  const routeGeometries = filtered.features.filter(
    (f) => f.featureKind === "route" && f.routeSummary.routePreviewCoordinates.length >= 2,
  ).length;
  const payload: UndiscoveredMapLayerResponse = {
    routeName: "map.layers.undiscovered.get",
    layerId: MAP_LAYER_UNDISCOVERED_V1_ID,
    layerVersion,
    bbox: [input.bbox.minLng, input.bbox.minLat, input.bbox.maxLng, input.bbox.maxLat],
    zoom: input.zoom,
    mode: input.mode ?? "durable",
    source: "bbox",
    features: filtered.features,
    counts: {
      points,
      routes: routesCount,
      routeGeometries,
      ...filtered.counts,
    },
    diagnostics: {
      reads,
      docsScanned,
      cacheHit: false,
      cacheSource: "miss",
      droppedInvalid: normalized.dropped.length,
      fetchMs: Date.now() - started,
    },
    etag: etagFor(layerVersion, bboxKey),
    generatedAt: Date.now(),
  };
  payload.diagnostics!.payloadBytes = Buffer.byteLength(JSON.stringify(payload.features), "utf8");
  const ttlMs = Math.max(env.MAP_MARKERS_CACHE_TTL_MS, 120_000);
  await globalCache.set(cacheKey, payload, ttlMs);
  return { response: payload, cacheHit: false, reads, docsScanned };
}

export function parseUndiscoveredLayerBbox(raw: string) {
  return parseBbox(raw);
}
