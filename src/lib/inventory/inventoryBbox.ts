import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import {
  bboxOfCoordinates,
  doesBboxIntersect,
  isPointInsideBbox,
  normalizeBbox,
  parseBboxString,
  type LatLng,
} from "./inventoryCoordinates.js";

export type InventoryDefaultViewport = {
  label: string;
  regionKey: string;
  center: LatLng;
  bbox: InventoryBbox;
};

export const INVENTORY_MVP_DEFAULT_VIEWPORT: InventoryDefaultViewport = {
  label: "Hartland, Vermont",
  regionKey: "hartland_vt_mvp",
  center: { lat: 43.54063, lng: -72.39898 },
  bbox: {
    minLat: 43.45,
    minLng: -72.55,
    maxLat: 43.63,
    maxLng: -72.25,
  },
};

/** Approximate radius of the default Hartland MVP bbox (km). */
export const INVENTORY_MVP_DEFAULT_RADIUS_KM = 12;

export function bboxFromCenterRadiusKm(center: LatLng, radiusKm: number): InventoryBbox {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

export type AdminViewportInput = {
  centerLat?: number;
  centerLng?: number;
  radiusKm?: number;
  label?: string;
  regionKey?: string;
};

export function resolveAdminViewport(input?: AdminViewportInput): InventoryDefaultViewport {
  const base = INVENTORY_MVP_DEFAULT_VIEWPORT;
  const centerLat = input?.centerLat ?? base.center.lat;
  const centerLng = input?.centerLng ?? base.center.lng;
  const radiusKm = input?.radiusKm ?? INVENTORY_MVP_DEFAULT_RADIUS_KM;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm)) {
    return base;
  }
  const clampedRadius = Math.min(80, Math.max(2, radiusKm));
  const center = { lat: centerLat, lng: centerLng };
  return {
    label: input?.label?.trim() || base.label,
    regionKey: input?.regionKey?.trim() || base.regionKey,
    center,
    bbox: bboxFromCenterRadiusKm(center, clampedRadius),
  };
}

export function isPointInBbox(lat: number, lng: number, bbox: InventoryBbox): boolean {
  return isPointInsideBbox({ lat, lng }, bbox);
}

export function bboxFromCoordinates(coords: Array<{ lat: number; lng: number }>): InventoryBbox | null {
  return bboxOfCoordinates(coords);
}

export function bboxIntersects(a: InventoryBbox, b: InventoryBbox): boolean {
  return doesBboxIntersect(a, b);
}

export function resolveInventoryRegion(regionKey?: string | null): InventoryDefaultViewport {
  const key = regionKey?.trim();
  if (!key || key === INVENTORY_MVP_DEFAULT_VIEWPORT.regionKey) {
    assertDefaultRegionBbox(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox);
    return INVENTORY_MVP_DEFAULT_VIEWPORT;
  }
  assertDefaultRegionBbox(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox);
  return INVENTORY_MVP_DEFAULT_VIEWPORT;
}

export function assertDefaultRegionBbox(bbox: InventoryBbox): void {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;
  const nearHartland = centerLat >= 43.4 && centerLat <= 43.7 && centerLng <= -72.2 && centerLng >= -72.6;
  if (!nearHartland) {
    throw new Error(
      `inventory_bbox_center_not_hartland: center=${centerLat.toFixed(5)},${centerLng.toFixed(5)} expected lat~43.54 lng~-72.40`
    );
  }
}

export { parseBboxString, normalizeBbox };
