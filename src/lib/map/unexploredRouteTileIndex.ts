import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  encodeGeohash,
  formatTileKey,
  latLngToTileXY,
  tilesForBboxAtZoom,
} from "../inventory/inventoryTileGrid.js";

export const UNDISCOVERED_ROUTE_TILE_MIN_Z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
export const UNDISCOVERED_ROUTE_TILE_MAX_Z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
export const UNDISCOVERED_ROUTE_PRIMARY_TILE_Z = 14;

type RouteBbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

function readRouteBbox(route: {
  bbox?: RouteBbox | null;
  center?: { lat?: unknown; lng?: unknown } | null;
}): RouteBbox | null {
  const bbox = route.bbox;
  if (
    bbox &&
    Number.isFinite(bbox.minLat) &&
    Number.isFinite(bbox.minLng) &&
    Number.isFinite(bbox.maxLat) &&
    Number.isFinite(bbox.maxLng)
  ) {
    return bbox;
  }
  const center = route.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const pad = 0.002;
  return {
    minLat: lat - pad,
    minLng: lng - pad,
    maxLat: lat + pad,
    maxLng: lng + pad,
  };
}

export function computeRouteMapTileKeys(
  route: {
    center: { lat: number; lng: number };
    bbox?: RouteBbox | null;
  },
  minZ = UNDISCOVERED_ROUTE_TILE_MIN_Z,
  maxZ = UNDISCOVERED_ROUTE_TILE_MAX_Z,
): { mapTileKeys: string[]; primaryTileKey: string; geohash: string } {
  const bbox = readRouteBbox(route);
  const mapTileKeys = new Set<string>();
  if (bbox) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (const tile of tilesForBboxAtZoom(bbox, z)) {
        mapTileKeys.add(tile.tileKey);
      }
    }
  } else {
    for (let z = minZ; z <= maxZ; z += 1) {
      const { x, y } = latLngToTileXY(route.center.lat, route.center.lng, z);
      mapTileKeys.add(formatTileKey(z, x, y));
    }
  }
  const primary = latLngToTileXY(route.center.lat, route.center.lng, UNDISCOVERED_ROUTE_PRIMARY_TILE_Z);
  return {
    mapTileKeys: [...mapTileKeys],
    primaryTileKey: formatTileKey(
      UNDISCOVERED_ROUTE_PRIMARY_TILE_Z,
      primary.x,
      primary.y,
    ),
    geohash: encodeGeohash(route.center.lat, route.center.lng, 9),
  };
}

export function attachRouteMapTileIndex<T extends { center: { lat: number; lng: number }; bbox?: RouteBbox | null }>(
  route: T,
): T & { mapTileKeys: string[]; primaryTileKey: string; geohash: string } {
  const index = computeRouteMapTileKeys(route);
  return {
    ...route,
    mapTileKeys: index.mapTileKeys,
    primaryTileKey: index.primaryTileKey,
    geohash: index.geohash,
    location:
      "location" in route && route.location && typeof route.location === "object"
        ? {
            ...(route.location as Record<string, unknown>),
            geohash: index.geohash,
          }
        : { lat: route.center.lat, lng: route.center.lng, geohash: index.geohash },
  };
}
