const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 9): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = ch | (1 << (4 - bit));
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = ch | (1 << (4 - bit));
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch] ?? "0";
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function latLngToTileXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

export function formatTileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function parseTileKey(tileKey: string): { z: number; x: number; y: number } | null {
  const parts = tileKey.split("/").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [z, x, y] = parts as [number, number, number];
  if (z < 0 || x < 0 || y < 0) return null;
  return { z, x, y };
}

export function bboxToTileRange(
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  z: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  const topLeft = latLngToTileXY(bbox.maxLat, bbox.minLng, z);
  const bottomRight = latLngToTileXY(bbox.minLat, bbox.maxLng, z);
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    maxX: Math.max(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

export function tilesForBboxAtZoom(
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  z: number
): Array<{ z: number; x: number; y: number; tileKey: string }> {
  const range = bboxToTileRange(bbox, z);
  const tiles: Array<{ z: number; x: number; y: number; tileKey: string }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tiles.push({ z, x, y, tileKey: formatTileKey(z, x, y) });
    }
  }
  return tiles;
}

export function tilesForViewport(
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoom: number,
  minZoom = 10,
  maxZoom = 15
): Array<{ z: number; x: number; y: number; tileKey: string }> {
  const z = Math.max(minZoom, Math.min(maxZoom, Math.round(zoom)));
  return tilesForBboxAtZoom(bbox, z);
}

export const DEFAULT_INVENTORY_TILE_ZOOM_RANGE = { minZ: 10, maxZ: 15 } as const;
export const DEFAULT_MAX_ITEMS_PER_TILE = 200;

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
