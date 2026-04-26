import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";

export type MapMarkerRecord = {
  id: string;
  postId: string;
  lat: number;
  lng: number;
  activity?: string | null;
  activities: string[];
  createdAt?: number | null;
  visibility?: string | null;
  ownerId?: string | null;
  thumbnailUrl?: string | null;
  hasPhoto?: boolean;
  hasVideo?: boolean;
};

export type MapMarkersDataset = {
  markers: MapMarkerRecord[];
  count: number;
  generatedAt: number;
  version: string;
  etag: string;
  queryCount: number;
  readCount: number;
  invalidCoordinateDrops: number;
};

export type MapMarkerBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export class MapMarkersFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  async fetchAll(input: { maxDocs: number }): Promise<MapMarkersDataset> {
    if (!this.db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const query = this.db
      .collection("posts")
      .orderBy("time", "desc")
      .select(
        "time",
        "createdAt",
        "createdAtMs",
        "lat",
        "lng",
        "latitude",
        "longitude",
        "long",
        "activity",
        "activities",
        "privacy",
        "visibility",
        "userId",
        "ownerId",
        "thumbUrl",
        "displayPhotoLink",
        "photoLink",
        "mediaType",
        "assets",
        "deleted",
        "isDeleted",
        "archived",
        "hidden"
      )
      .limit(input.maxDocs);
    incrementDbOps("queries", 1);
    const snapshot = await query.get();
    incrementDbOps("reads", snapshot.docs.length);
    const projected = project(snapshot.docs);
    const generatedAt = Date.now();
    const etag = buildEtag(projected.markers);
    return {
      markers: projected.markers,
      count: projected.markers.length,
      generatedAt,
      version: "map-markers-v2",
      etag,
      queryCount: 1,
      readCount: snapshot.docs.length,
      invalidCoordinateDrops: projected.invalidCoordinateDrops
    };
  }

  async fetchWindow(input: { maxDocs: number; bounds: MapMarkerBounds; limit: number }): Promise<MapMarkersDataset & { hasMore: boolean; nextCursor: string | null }> {
    const base = await this.fetchAll({ maxDocs: input.maxDocs });
    const filtered = base.markers.filter(
      (marker) =>
        marker.lng >= input.bounds.minLng &&
        marker.lng <= input.bounds.maxLng &&
        marker.lat >= input.bounds.minLat &&
        marker.lat <= input.bounds.maxLat
    );
    const page = filtered.slice(0, input.limit);
    return {
      ...base,
      markers: page,
      count: page.length,
      hasMore: filtered.length > page.length,
      nextCursor: filtered.length > page.length ? String(page[page.length - 1]?.createdAt ?? null) : null
    };
  }
}

function project(docs: QueryDocumentSnapshot[]): { markers: MapMarkerRecord[]; invalidCoordinateDrops: number } {
  const markers: MapMarkerRecord[] = [];
  let invalidCoordinateDrops = 0;
  for (const doc of docs) {
    const data = doc.data() as Record<string, unknown>;
    if (Boolean(data.deleted) || Boolean(data.isDeleted) || Boolean(data.archived) || Boolean(data.hidden)) continue;
    const coords = readCoords(data);
    if (!coords) {
      invalidCoordinateDrops += 1;
      continue;
    }
    const activities = readActivities(data.activities);
    const createdAt = readMillis(data.time ?? data.createdAt ?? data.createdAtMs);
    const visibility = normalizeText(data.visibility ?? data.privacy);
    const ownerId = normalizeText(data.ownerId ?? data.userId);
    const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);
    const media = inferMedia(data);
    markers.push({
      id: doc.id,
      postId: doc.id,
      lat: coords.lat,
      lng: coords.lng,
      activity: readActivity(data.activity) ?? activities[0] ?? null,
      activities,
      createdAt,
      visibility,
      ownerId,
      thumbnailUrl,
      hasPhoto: media.hasPhoto,
      hasVideo: media.hasVideo
    });
  }
  markers.sort((a, b) => {
    const at = a.createdAt ?? 0;
    const bt = b.createdAt ?? 0;
    if (bt !== at) return bt - at;
    return a.postId.localeCompare(b.postId);
  });
  return { markers, invalidCoordinateDrops };
}

function readActivities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const token = readActivity(entry);
    if (!token) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function readActivity(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const candidates = [rec.id, rec.activityId, rec.slug, rec.key, rec.name, rec.label];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const t = candidate.trim();
    if (t.length > 0) return t;
  }
  return null;
}

function readCoords(data: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = normalizeNumber(data.lat ?? data.latitude);
  const lng = normalizeNumber(data.lng ?? data.longitude ?? data.long);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function readMillis(value: unknown): number | null {
  if (typeof value === "number") return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  if (!value || typeof value !== "object") return null;
  const rec = value as { seconds?: number; _seconds?: number; toMillis?: () => number };
  if (typeof rec.toMillis === "function") return Math.floor(rec.toMillis());
  if (typeof rec.seconds === "number") return Math.floor(rec.seconds * 1000);
  if (typeof rec._seconds === "number") return Math.floor(rec._seconds * 1000);
  return null;
}

function inferMedia(data: Record<string, unknown>): { hasPhoto: boolean; hasVideo: boolean } {
  const mediaType = normalizeText(data.mediaType)?.toLowerCase();
  let hasVideo = mediaType === "video";
  let hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));
  if (Array.isArray(data.assets)) {
    for (const raw of data.assets) {
      if (!raw || typeof raw !== "object") continue;
      const asset = raw as Record<string, unknown>;
      const assetType = normalizeText(asset.type)?.toLowerCase();
      if (assetType === "video") hasVideo = true;
      if (assetType === "image") hasPhoto = true;
    }
  }
  return { hasPhoto, hasVideo };
}

function buildEtag(markers: MapMarkerRecord[]): string {
  const hash = createHash("sha1").update(JSON.stringify(markers)).digest("hex");
  return `"map-markers-v2-${hash}"`;
}
