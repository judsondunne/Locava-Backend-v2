import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import { isUndiscoveredFirestoreMapEligible } from "../../lib/map/undiscoveredFirestoreEligibility.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";

const COLLECTION = "unexploredTiles";

export async function getUnexploredTilesByKeys(tileKeys: string[]): Promise<UnexploredTile[]> {
  const db = getFirestoreSourceClient();
  if (!db || tileKeys.length === 0) return [];
  const unique = [...new Set(tileKeys.filter(Boolean))];
  const tiles: UnexploredTile[] = [];
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    incrementDbOps("reads", chunk.length);
    incrementDbOps("queries", 1);
    const snaps = await db.getAll(...chunk.map((key) => db.collection(COLLECTION).doc(key)));
    for (const snap of snaps) {
      if (snap.exists) tiles.push(snap.data() as UnexploredTile);
    }
  }
  return tiles;
}

function lngInBbox(lng: number, bbox: { minLng: number; maxLng: number }): boolean {
  if (bbox.minLng <= bbox.maxLng) {
    return lng >= bbox.minLng && lng <= bbox.maxLng;
  }
  return lng >= bbox.minLng || lng <= bbox.maxLng;
}

/**
 * Source-of-truth fallback when `unexploredTiles` is missing or stale.
 * Uses a lat-range Firestore query and filters lng + eligibility in memory.
 */
export async function queryUnexploredRoutesByTileKey(
  tileKey: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const cap = Math.max(1, Math.min(limit, 400));
  incrementDbOps("queries", 1);
  let snap;
  try {
    snap = await db
      .collection("unexploredRoutes")
      .where("mapTileKeys", "array-contains", tileKey)
      .limit(cap)
      .get();
  } catch {
    return [];
  }
  incrementDbOps("reads", snap.size);
  const out: Record<string, unknown>[] = [];
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) };
    if (!isUndiscoveredFirestoreMapEligible(data)) continue;
    out.push(data);
    if (out.length >= cap) break;
  }
  return out;
}

export async function queryUnexploredSpotsByTileKey(
  tileKey: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const cap = Math.max(1, Math.min(limit, 400));
  incrementDbOps("queries", 1);
  let snap;
  try {
    snap = await db
      .collection("unexploredSpots")
      .where("mapTileKeys", "array-contains", tileKey)
      .limit(cap)
      .get();
  } catch {
    return [];
  }
  incrementDbOps("reads", snap.size);
  const out: Record<string, unknown>[] = [];
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) };
    if (!isUndiscoveredFirestoreMapEligible(data)) continue;
    out.push(data);
    if (out.length >= cap) break;
  }
  return out;
}

export async function queryUnexploredSpotsInBbox(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  limit?: number;
  publicOnly?: boolean;
}): Promise<Record<string, unknown>[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 2000, 4000));
  const publicOnly = input.publicOnly !== false;
  incrementDbOps("queries", 1);
  const snap = await db
    .collection("unexploredSpots")
    .where("lat", ">=", input.bbox.minLat)
    .where("lat", "<=", input.bbox.maxLat)
    .limit(limit)
    .get();
  incrementDbOps("reads", snap.size);
  const out: Record<string, unknown>[] = [];
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) };
    const lat = Number(data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat);
    const lng = Number(
      data.lng ??
        data.long ??
        (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
        (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!lngInBbox(lng, input.bbox)) continue;
    if (publicOnly && !isUndiscoveredFirestoreMapEligible(data)) continue;
    out.push(data);
    if (out.length >= limit) break;
  }
  return out;
}

export async function queryUnexploredRoutesInBbox(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  limit?: number;
  publicOnly?: boolean;
}): Promise<Record<string, unknown>[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 500, 2000));
  const publicOnly = input.publicOnly !== false;
  incrementDbOps("queries", 1);
  let snap;
  try {
    snap = await db
      .collection("unexploredRoutes")
      .where("center.lat", ">=", input.bbox.minLat)
      .where("center.lat", "<=", input.bbox.maxLat)
      .limit(limit)
      .get();
  } catch {
    return [];
  }
  incrementDbOps("reads", snap.size);
  const out: Record<string, unknown>[] = [];
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...(doc.data() as Record<string, unknown>) };
    const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
    const location = data.location as { lat?: unknown; lng?: unknown } | undefined;
    const lat = Number(center?.lat ?? location?.lat);
    const lng = Number(center?.lng ?? location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!lngInBbox(lng, input.bbox)) continue;
    if (publicOnly && !isUndiscoveredFirestoreMapEligible(data)) continue;
    out.push(data);
    if (out.length >= limit) break;
  }
  return out;
}

export async function getUnexploredSpotById(spotId: string): Promise<Record<string, unknown> | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection("unexploredSpots").doc(spotId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

export async function getUnexploredRouteById(routeId: string): Promise<Record<string, unknown> | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection("unexploredRoutes").doc(routeId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

export async function getUnexploredRouteGeometryChunks(
  routeId: string,
): Promise<Array<{ latitude: number; longitude: number }>> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  incrementDbOps("queries", 1);
  const snap = await db
    .collection("unexploredRoutes")
    .doc(routeId)
    .collection("geometryChunks")
    .orderBy("__name__")
    .get();
  incrementDbOps("reads", snap.size);
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { coordinates?: unknown };
    const chunkCoords = normalizeChunkCoordinates(data.coordinates);
    out.push(...chunkCoords);
  }
  return out;
}

function normalizeChunkCoordinates(raw: unknown): Array<{ latitude: number; longitude: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const value of raw) {
    if (Array.isArray(value) && value.length >= 2) {
      const a = Number(value[0]);
      const b = Number(value[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const looksLikeGeoJson = Math.abs(a) <= 180 && Math.abs(b) <= 90 && Math.abs(a) > Math.abs(b);
      out.push(
        looksLikeGeoJson
          ? { latitude: b, longitude: a }
          : { latitude: a, longitude: b },
      );
      continue;
    }
    if (value != null && typeof value === "object") {
      const row = value as Record<string, unknown>;
      const lat = Number(row.lat ?? row.latitude);
      const lng = Number(row.lng ?? row.longitude ?? row.lon ?? row.long);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ latitude: lat, longitude: lng });
    }
  }
  return out;
}
