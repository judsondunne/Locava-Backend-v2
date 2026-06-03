import {
  bboxFromCenterRadiusKm,
  bboxFromCoordinates,
  bboxIntersects,
  INVENTORY_MVP_DEFAULT_RADIUS_KM,
  INVENTORY_MVP_DEFAULT_VIEWPORT,
  isPointInBbox,
} from "../../../../lib/inventory/inventoryBbox.js";
import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { PbfCopierConfig, PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

/** Hartland MVP — same default as /admin/openstreetmap OSM Classifier. */
export const HARTLAND_VT_CENTER = INVENTORY_MVP_DEFAULT_VIEWPORT.center;

/** Quechee (nearby); kept for legacy UI labels. */
export const QUECHEE_VT_CENTER = { lat: 43.646, lng: -72.418 };

/** No practical preview cap in bbox exhaustive mode — collect every accepted feature in viewport. */
export const BBOX_EXHAUSTIVE_PREVIEW_LIMIT = 1_000_000;

/** Matches the OSM Classifier admin default (Hartland MVP viewport). */
export const DEFAULT_GEO_FILTER_RADIUS_KM = INVENTORY_MVP_DEFAULT_RADIUS_KM;

/** @deprecated Use geoFilterRadiusKm — miles kept for backward-compatible API input. */
export const DEFAULT_GEO_FILTER_RADIUS_MILES = 20;

export function isGeoFilterExhaustiveMode(config: PbfCopierConfig): boolean {
  return config.geoFilterEnabled === true;
}

export function resolveGeoFilterRadiusKm(config: PbfCopierConfig): number {
  if (config.geoFilterRadiusKm != null && Number.isFinite(config.geoFilterRadiusKm)) {
    return Math.min(80, Math.max(2, config.geoFilterRadiusKm));
  }
  if (config.geoFilterRadiusMiles != null && Number.isFinite(config.geoFilterRadiusMiles)) {
    return Math.min(80, Math.max(2, config.geoFilterRadiusMiles * 1.609344));
  }
  return DEFAULT_GEO_FILTER_RADIUS_KM;
}

export function resolveGeoFilterCenter(config: PbfCopierConfig): { lat: number; lng: number } | null {
  if (!config.geoFilterEnabled) return null;
  const lat = config.geoFilterCenterLat ?? HARTLAND_VT_CENTER.lat;
  const lng = config.geoFilterCenterLng ?? HARTLAND_VT_CENTER.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Rectangular viewport bbox — same math as /admin/openstreetmap (center + radius km). */
export function resolveGeoFilterBbox(config: PbfCopierConfig): InventoryBbox | null {
  if (!config.geoFilterEnabled) return null;
  const center = resolveGeoFilterCenter(config);
  if (!center) return null;
  return bboxFromCenterRadiusKm(center, resolveGeoFilterRadiusKm(config));
}

function intersectsBbox(
  coords: Array<{ lat: number; lng: number }>,
  centerFallback: { lat: number; lng: number },
  bbox: InventoryBbox
): boolean {
  if (coords.length === 0) {
    return isPointInBbox(centerFallback.lat, centerFallback.lng, bbox);
  }
  for (const p of coords) {
    if (isPointInBbox(p.lat, p.lng, bbox)) return true;
  }
  const featureBbox = bboxFromCoordinates(coords);
  if (featureBbox && bboxIntersects(featureBbox, bbox)) return true;
  return isPointInBbox(centerFallback.lat, centerFallback.lng, bbox);
}

/** True when an OSM feature should be classified (bbox intersection, same as classifier viewport). */
export function osmFeatureWithinGeoFilter(
  feature: { lat: number; lng: number; coordinates?: Array<{ lat: number; lng: number }> },
  config: PbfCopierConfig
): boolean {
  if (!config.geoFilterEnabled) return true;
  const bbox = resolveGeoFilterBbox(config);
  if (!bbox) return true;
  const coords = feature.coordinates?.length ? feature.coordinates : [];
  return intersectsBbox(coords, { lat: feature.lat, lng: feature.lng }, bbox);
}

/** True when doc should appear in preview output for the active geo filter. */
export function previewDocWithinGeoFilter(doc: PbfCopierPreviewDoc, config: PbfCopierConfig): boolean {
  if (!config.geoFilterEnabled) return true;
  const bbox = resolveGeoFilterBbox(config);
  if (!bbox) return true;

  if (doc.kind === "unexplored_route") {
    const line = doc.routeLineCoordinates ?? [];
    return intersectsBbox(line, { lat: doc.lat, lng: doc.lng }, bbox);
  }

  return isPointInBbox(doc.lat, doc.lng, bbox);
}
