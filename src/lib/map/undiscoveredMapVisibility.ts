/**
 * Zoom / density rules for undiscovered OSM map layer (server + shared with native via mirrored constants).
 * `mapZoom` is Web Mercator-style integer zoom (10 = regional, 14 = neighborhood, 16 = trail detail).
 */
/** When false, all public undiscovered features pass through (no zoom hide / cluster-only mode). */
export const UNDISCOVERED_MARKER_ZOOM_GATING_ENABLED = true;

export function isUndiscoveredMarkerZoomGatingEnabled(): boolean {
  return UNDISCOVERED_MARKER_ZOOM_GATING_ENABLED;
}

export const MIN_ZOOM_SHOW_INDIVIDUAL_POIS = 13;
export const MIN_ZOOM_SHOW_ROUTE_ANCHORS = 14;
export const MIN_ZOOM_SHOW_ROUTE_LINES = 15;
export const MIN_ZOOM_SHOW_ROUTE_LABELS = 16;

export const MAX_INDIVIDUAL_UNDISCOVERED_MARKERS_PER_VIEWPORT = 48;
export const MAX_ROUTE_ANCHORS_PER_VIEWPORT = 24;
export const MAX_ROUTE_LINES_PER_VIEWPORT = 18;

/** Grid cell size in degrees by zoom bucket — used for server-side cluster synthesis. */
export const CLUSTER_GRID_SIZE_BY_ZOOM: Record<string, number> = {
  z8: 0.45,
  z10: 0.22,
  z12: 0.11,
  z14: 0.045,
  z16: 0.018,
};

/** Screen-consistent route stroke widths by map zoom (points on native maps). */
export const ROUTE_LINE_STROKE_WIDTH_BY_ZOOM: Array<{ minZoom: number; width: number; dashed: boolean }> = [
  { minZoom: 16, width: 2.5, dashed: true },
  { minZoom: 15, width: 2, dashed: true },
  { minZoom: 14, width: 1.75, dashed: false },
];

export const ROUTE_DASH_PATTERN = [6, 5] as const;

/** Max polyline vertices returned for map preview at a given zoom (render perf). */
export function routePreviewPointCapForZoom(zoom: number): number {
  const z = Math.max(1, Math.min(20, Math.round(zoom)));
  if (z >= 16) return 500;
  if (z >= 14) return 280;
  if (z >= 12) return 120;
  return 0;
}

export function routeLinePresentationForZoom(zoom: number): {
  width: number;
  dashed: boolean;
  visible: boolean;
} {
  const z = Math.max(1, Math.min(20, Math.round(zoom)));
  if (z < MIN_ZOOM_SHOW_ROUTE_LINES) {
    return { width: 0, dashed: false, visible: false };
  }
  let best = ROUTE_LINE_STROKE_WIDTH_BY_ZOOM[ROUTE_LINE_STROKE_WIDTH_BY_ZOOM.length - 1]!;
  for (const row of ROUTE_LINE_STROKE_WIDTH_BY_ZOOM) {
    if (z >= row.minZoom) {
      best = row;
      break;
    }
  }
  return { width: best.width, dashed: best.dashed, visible: best.width > 0 };
}

/** Coarse zoom buckets used to invalidate undiscovered layer cache when the user crosses thresholds. */
export function undiscoveredZoomFetchBucket(zoom: number): number {
  const z = Math.max(1, Math.min(20, Math.round(zoom)));
  if (z <= 10) return 10;
  if (z <= 12) return 12;
  if (z <= 14) return 14;
  if (z <= 16) return 16;
  return 18;
}

export type UndiscoveredFeatureKind = "poi" | "route";

export function mapZoomFromLatitudeDelta(latitudeDelta: number): number {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return 13;
  const zoom = Math.log2(360 / latitudeDelta);
  return Math.max(1, Math.min(20, Math.round(zoom)));
}

export function latitudeDeltaFromMapZoom(zoom: number): number {
  const z = Math.max(1, Math.min(20, zoom));
  return 360 / 2 ** z;
}

export function clusterGridSizeForZoom(zoom: number): number {
  if (zoom <= 9) return CLUSTER_GRID_SIZE_BY_ZOOM.z8!;
  if (zoom <= 11) return CLUSTER_GRID_SIZE_BY_ZOOM.z10!;
  if (zoom <= 13) return CLUSTER_GRID_SIZE_BY_ZOOM.z12!;
  if (zoom <= 15) return CLUSTER_GRID_SIZE_BY_ZOOM.z14!;
  return CLUSTER_GRID_SIZE_BY_ZOOM.z16!;
}

export function readConfidence(data: Record<string, unknown>): "high" | "medium" | "low" {
  const raw = String(data.confidence ?? "").toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  const score = Number(data.locavaScore);
  if (Number.isFinite(score)) {
    if (score >= 70) return "high";
    if (score >= 50) return "medium";
  }
  return "low";
}

export function readShowAtZoom(data: Record<string, unknown>, confidence: "high" | "medium" | "low"): number {
  const showAt = Number(data.showAtZoom);
  if (Number.isFinite(showAt) && showAt >= 1 && showAt <= 20) return showAt;
  if (confidence === "high") return 11;
  if (confidence === "medium") return 13;
  return 15;
}

export function minZoomForPoi(confidence: "high" | "medium" | "low", showAtZoom: number): number {
  const base = Math.max(MIN_ZOOM_SHOW_INDIVIDUAL_POIS, showAtZoom);
  if (confidence === "high") return Math.min(base, 12);
  if (confidence === "medium") return Math.min(base, 13);
  return Math.max(base, 14);
}

export function minZoomForRouteAnchor(confidence: "high" | "medium" | "low", showAtZoom: number): number {
  const base = Math.max(MIN_ZOOM_SHOW_ROUTE_ANCHORS, showAtZoom);
  if (confidence === "high") return Math.min(base, 13);
  if (confidence === "medium") return Math.min(base, 14);
  return Math.max(base, 15);
}

export function shouldShowRouteLinesAtZoom(zoom: number, confidence: "high" | "medium" | "low"): boolean {
  if (zoom < MIN_ZOOM_SHOW_ROUTE_LINES) return false;
  if (confidence === "low" && zoom < MIN_ZOOM_SHOW_ROUTE_LINES + 1) return false;
  return true;
}

export function isLowConfidenceHiddenAtZoom(
  confidence: "high" | "medium" | "low",
  zoom: number,
  kind: UndiscoveredFeatureKind,
): boolean {
  const minZoom = kind === "route" ? minZoomForRouteAnchor(confidence, 99) : minZoomForPoi(confidence, 99);
  return zoom < minZoom;
}
