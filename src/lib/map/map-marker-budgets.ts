export type MapMarkerPayloadMode = "compact" | "full";

export const MAP_MARKERS_MIN_DOCS = 20;
export const MAP_MARKERS_SAFE_DEFAULT_MAX_DOCS = 180;
export const MAP_MARKERS_SAFE_HARD_MAX_DOCS = 300;
export const MAP_MARKERS_SAFE_FULL_PAYLOAD_MAX_DOCS = 80;
export const MAP_MARKERS_VIEWPORT_HEADROOM_DOCS = 40;
export const MAP_MARKERS_VIEWPORT_MULTIPLIER = 2;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function clampConfiguredMapMarkersMaxDocs(value: number): number {
  return clampInt(value, MAP_MARKERS_MIN_DOCS, MAP_MARKERS_SAFE_HARD_MAX_DOCS);
}

export function resolveMapMarkerLimit(input: {
  requestedLimit?: number | null;
  configuredMaxDocs: number;
  payloadMode: MapMarkerPayloadMode;
}): {
  requestedLimit: number | null;
  configuredLimit: number;
  effectiveLimit: number;
  hardCap: number;
  hardCapApplied: boolean;
} {
  const hardCap =
    input.payloadMode === "full"
      ? MAP_MARKERS_SAFE_FULL_PAYLOAD_MAX_DOCS
      : MAP_MARKERS_SAFE_HARD_MAX_DOCS;
  const configuredLimit = clampInt(
    clampConfiguredMapMarkersMaxDocs(input.configuredMaxDocs),
    MAP_MARKERS_MIN_DOCS,
    hardCap
  );
  const requestedLimit =
    typeof input.requestedLimit === "number" && Number.isFinite(input.requestedLimit)
      ? Math.floor(input.requestedLimit)
      : null;
  const effectiveLimit =
    requestedLimit != null
      ? clampInt(requestedLimit, MAP_MARKERS_MIN_DOCS, configuredLimit)
      : configuredLimit;
  return {
    requestedLimit,
    configuredLimit,
    effectiveLimit,
    hardCap,
    hardCapApplied:
      configuredLimit !== clampConfiguredMapMarkersMaxDocs(input.configuredMaxDocs) ||
      (requestedLimit != null && requestedLimit !== effectiveLimit),
  };
}

export function resolveMapMarkerViewportCandidateLimit(input: {
  pageLimit: number;
  configuredMaxDocs: number;
}): number {
  const safeConfigured = clampConfiguredMapMarkersMaxDocs(input.configuredMaxDocs);
  const requested = clampInt(input.pageLimit, MAP_MARKERS_MIN_DOCS, safeConfigured);
  const candidateBudget = Math.max(
    requested,
    requested * MAP_MARKERS_VIEWPORT_MULTIPLIER + MAP_MARKERS_VIEWPORT_HEADROOM_DOCS
  );
  return clampInt(candidateBudget, MAP_MARKERS_MIN_DOCS, safeConfigured);
}

export type MapBBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

/** Hard cap on requested bbox span (degrees) — avoids world-sized queries and payload_bytes_exceeded. */
export const MAP_MARKERS_MAX_BBOX_LAT_SPAN = 1.35;
export const MAP_MARKERS_MAX_BBOX_LNG_SPAN = 1.35;

export function formatBoundsCsv(bounds: MapBBox): string {
  return `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`;
}

/**
 * Shrinks oversized bbox requests toward the viewport center while preserving read caps elsewhere.
 */
export function clampMapRequestBounds(bounds: MapBBox): {
  bounds: MapBBox;
  clamped: boolean;
  bboxArea: number;
  zoomBucket: string;
} {
  const latSpan = bounds.maxLat - bounds.minLat;
  const lngSpan = bounds.maxLng - bounds.minLng;
  let clamped = false;
  let b: MapBBox = bounds;
  if (latSpan > MAP_MARKERS_MAX_BBOX_LAT_SPAN || lngSpan > MAP_MARKERS_MAX_BBOX_LNG_SPAN) {
    clamped = true;
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const midLng = (bounds.minLng + bounds.maxLng) / 2;
    const halfLat = Math.min(latSpan, MAP_MARKERS_MAX_BBOX_LAT_SPAN) / 2;
    const halfLng = Math.min(lngSpan, MAP_MARKERS_MAX_BBOX_LNG_SPAN) / 2;
    b = {
      minLat: midLat - halfLat,
      maxLat: midLat + halfLat,
      minLng: midLng - halfLng,
      maxLng: midLng + halfLng
    };
  }
  const zbLat = b.maxLat - b.minLat;
  const zbLng = b.maxLng - b.minLng;
  const zm = Math.max(zbLat, zbLng);
  const zoomBucket =
    zm < 0.02 ? "tile_close" : zm < 0.12 ? "region" : zm < 0.6 ? "city" : "coarse";
  return {
    bounds: b,
    clamped,
    bboxArea: Math.max(0, zbLat) * Math.max(0, zbLng),
    zoomBucket
  };
}
