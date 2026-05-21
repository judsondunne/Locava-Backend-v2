import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";

export type LatLng = { lat: number; lng: number };

export type CoordinateWarning = {
  code: string;
  message: string;
  context?: string;
  lat?: number;
  lng?: number;
};

const UPPER_VALLEY_LAT_MIN = 42;
const UPPER_VALLEY_LAT_MAX = 46;
const UPPER_VALLEY_LNG_MIN = -74;
const UPPER_VALLEY_LNG_MAX = -71;

export function isLatLngValid(point: LatLng): boolean {
  const { lat, lng } = point;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function roundInventoryCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function roundInventoryLatLng(point: LatLng): LatLng {
  return {
    lat: roundInventoryCoordinate(point.lat),
    lng: roundInventoryCoordinate(point.lng),
  };
}

export function parseOsmNodeLatLng(node: { lat?: unknown; lon?: unknown; lng?: unknown }): LatLng | null {
  const lat = Number(node.lat);
  const lng = Number(node.lon ?? node.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function parseGeoJsonPoint(feature: { geometry?: { type?: string; coordinates?: unknown } }): LatLng | null {
  const geometry = feature.geometry;
  if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  return parseGeoJsonCoordinatePair(geometry.coordinates);
}

export function parseGeoJsonCoordinatePair(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function parseGeoJsonLineString(feature: {
  geometry?: { type?: string; coordinates?: unknown };
}): LatLng[] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    return parseGeoJsonLineCoordinates(geometry.coordinates);
  }
  if (geometry.type === "MultiLineString") {
    return parseGeoJsonMultiLineCoordinates(geometry.coordinates);
  }
  return [];
}

export function parseGeoJsonLineCoordinates(coords: unknown): LatLng[] {
  if (!Array.isArray(coords)) return [];
  if (coords.length === 0) return [];
  if (typeof coords[0] === "number") {
    const pair = parseGeoJsonCoordinatePair(coords);
    return pair ? [pair] : [];
  }
  const out: LatLng[] = [];
  for (const item of coords) {
    const pair = parseGeoJsonCoordinatePair(item);
    if (pair) out.push(pair);
  }
  return out;
}

export function parseGeoJsonMultiLineCoordinates(coords: unknown): LatLng[] {
  if (!Array.isArray(coords)) return [];
  const segments: LatLng[][] = [];
  for (const segment of coords) {
    const line = parseGeoJsonLineCoordinates(segment);
    if (line.length >= 2) segments.push(line);
  }
  if (segments.length === 0) return [];
  if (segments.length === 1) return segments[0]!;
  return segments.flat();
}

export function parseGeoJsonPolygonCenter(feature: {
  geometry?: { type?: string; coordinates?: unknown };
}): LatLng | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon") {
    return centerOfGeoJsonPolygonRings(geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    const first = Array.isArray(geometry.coordinates) ? geometry.coordinates[0] : null;
    return centerOfGeoJsonPolygonRings(first);
  }
  return null;
}

function centerOfGeoJsonPolygonRings(rings: unknown): LatLng | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const outerRing = rings[0];
  const coords = parseGeoJsonLineCoordinates(outerRing);
  return centerOfCoordinates(coords);
}

export function parseOsmWayGeometry(way: {
  geometry?: Array<{ lat?: unknown; lon?: unknown; lng?: unknown }>;
}): LatLng[] {
  if (!Array.isArray(way.geometry)) return [];
  const out: LatLng[] = [];
  for (const point of way.geometry) {
    const parsed = parseOsmNodeLatLng(point);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function centerOfCoordinates(coords: LatLng[]): LatLng | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0] ?? null;
  const bbox = bboxOfCoordinates(coords);
  if (!bbox) return null;
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lng: (bbox.minLng + bbox.maxLng) / 2,
  };
}

export function bboxOfCoordinates(coords: LatLng[]): InventoryBbox | null {
  if (coords.length === 0) return null;
  let minLat = coords[0]!.lat;
  let maxLat = coords[0]!.lat;
  let minLng = coords[0]!.lng;
  let maxLng = coords[0]!.lng;
  for (const c of coords) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLng = Math.min(minLng, c.lng);
    maxLng = Math.max(maxLng, c.lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function isLikelySwappedForUpperValley(lat: number, lng: number): boolean {
  const inExpectedRange = lat >= UPPER_VALLEY_LAT_MIN && lat <= UPPER_VALLEY_LAT_MAX && lng >= UPPER_VALLEY_LNG_MIN && lng <= UPPER_VALLEY_LNG_MAX;
  if (inExpectedRange) return false;
  const latLooksLikeLng = lat <= UPPER_VALLEY_LNG_MAX && lat >= UPPER_VALLEY_LNG_MIN;
  const lngLooksLikeLat = lng >= UPPER_VALLEY_LAT_MIN && lng <= UPPER_VALLEY_LAT_MAX;
  return latLooksLikeLng && lngLooksLikeLat;
}

export function assertLikelyNotSwapped(point: LatLng, context: string): CoordinateWarning | null {
  if (!isLikelySwappedForUpperValley(point.lat, point.lng)) return null;
  return {
    code: "likely_swapped_coordinates",
    message: `Coordinates appear swapped for Upper Valley context (${context})`,
    context,
    lat: point.lat,
    lng: point.lng,
  };
}

export function isPointInsideBbox(point: LatLng, bbox: InventoryBbox): boolean {
  return point.lat >= bbox.minLat && point.lat <= bbox.maxLat && point.lng >= bbox.minLng && point.lng <= bbox.maxLng;
}

export function doesBboxIntersect(a: InventoryBbox, b: InventoryBbox): boolean {
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLng < b.minLng || a.minLng > b.maxLng);
}

export function parseBboxString(raw: string): InventoryBbox | null {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [n0, n1, n2, n3] = parts as [number, number, number, number];

  const looksLikeLat = (n: number) => n >= -90 && n <= 90;
  const pair0IsLngLat =
    n0 <= -50 && n2 <= -50 && looksLikeLat(n1) && looksLikeLat(n3) && Math.abs(n1) < 90 && Math.abs(n3) < 90;
  if (pair0IsLngLat) {
    return normalizeBbox({
      minLat: Math.min(n1, n3),
      minLng: Math.min(n0, n2),
      maxLat: Math.max(n1, n3),
      maxLng: Math.max(n0, n2),
    });
  }
  return normalizeBbox({
    minLat: Math.min(n0, n2),
    minLng: Math.min(n1, n3),
    maxLat: Math.max(n0, n2),
    maxLng: Math.max(n1, n3),
  });
}

export function normalizeBbox(bbox: InventoryBbox): InventoryBbox {
  return {
    minLat: Math.min(bbox.minLat, bbox.maxLat),
    minLng: Math.min(bbox.minLng, bbox.maxLng),
    maxLat: Math.max(bbox.minLat, bbox.maxLat),
    maxLng: Math.max(bbox.minLng, bbox.maxLng),
  };
}

export function coordinateSanitySummary(items: Array<{ lat: number; lng: number }>): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  count: number;
} | null {
  if (items.length === 0) return null;
  let minLat = items[0]!.lat;
  let maxLat = items[0]!.lat;
  let minLng = items[0]!.lng;
  let maxLng = items[0]!.lng;
  for (const item of items) {
    minLat = Math.min(minLat, item.lat);
    maxLat = Math.max(maxLat, item.lat);
    minLng = Math.min(minLng, item.lng);
    maxLng = Math.max(maxLng, item.lng);
  }
  return { minLat, maxLat, minLng, maxLng, count: items.length };
}
