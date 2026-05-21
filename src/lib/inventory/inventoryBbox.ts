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
