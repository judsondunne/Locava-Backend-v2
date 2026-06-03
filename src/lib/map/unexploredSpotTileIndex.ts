import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  encodeGeohash,
  formatTileKey,
  latLngToTileXY,
} from "../inventory/inventoryTileGrid.js";

export const UNDISCOVERED_SPOT_TILE_MIN_Z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
export const UNDISCOVERED_SPOT_TILE_MAX_Z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
export const UNDISCOVERED_SPOT_PRIMARY_TILE_Z = 14;

export function computeSpotMapTileKeys(
  lat: number,
  lng: number,
  minZ = UNDISCOVERED_SPOT_TILE_MIN_Z,
  maxZ = UNDISCOVERED_SPOT_TILE_MAX_Z,
): { mapTileKeys: string[]; primaryTileKey: string; geohash: string } {
  const mapTileKeys: string[] = [];
  for (let z = minZ; z <= maxZ; z += 1) {
    const { x, y } = latLngToTileXY(lat, lng, z);
    mapTileKeys.push(formatTileKey(z, x, y));
  }
  const primary = latLngToTileXY(lat, lng, UNDISCOVERED_SPOT_PRIMARY_TILE_Z);
  return {
    mapTileKeys,
    primaryTileKey: formatTileKey(
      UNDISCOVERED_SPOT_PRIMARY_TILE_Z,
      primary.x,
      primary.y,
    ),
    geohash: encodeGeohash(lat, lng, 9),
  };
}

export function attachSpotMapTileIndex<T extends { lat: number; lng: number }>(
  spot: T,
): T & { mapTileKeys: string[]; primaryTileKey: string; geohash: string } {
  const index = computeSpotMapTileKeys(spot.lat, spot.lng);
  return {
    ...spot,
    mapTileKeys: index.mapTileKeys,
    primaryTileKey: index.primaryTileKey,
    geohash: index.geohash,
    location:
      "location" in spot && spot.location && typeof spot.location === "object"
        ? {
            ...(spot.location as Record<string, unknown>),
            geohash: index.geohash,
          }
        : { lat: spot.lat, lng: spot.lng, geohash: index.geohash },
  };
}
