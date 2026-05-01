import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { loadEnv } from "../../config/env.js";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";

const env = loadEnv();

export type MapMarkerRecord = {
  id: string;
  postId: string;
  lat: number;
  lng: number;
  activity?: string | null;
  activities: string[];
  createdAt?: number | null;
  updatedAt?: number | null;
  visibility?: string | null;
  ownerId?: string | null;
  thumbnailUrl?: string | null;
  thumbKey?: string | null;
  followedUserPic?: string | null;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  openPayload?: Record<string, unknown> | null;
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

type ProjectOptions = {
  /**
   * When true, include all visibilities (still excluding deleted/archived/hidden).
   * When false, only include "public"-style visibilities.
   */
  includeNonPublic: boolean;
};

export type MapMarkerBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type SharedDatasetCache = {
  dataset: MapMarkersDataset;
  expiresAt: number;
  maxDocs: number;
};

let sharedDatasetCache: SharedDatasetCache | null = null;
let sharedDatasetPromise: { maxDocs: number; promise: Promise<MapMarkersDataset> } | null = null;

export class MapMarkersFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  static invalidateSharedCache(): void {
    sharedDatasetCache = null;
    sharedDatasetPromise = null;
  }

  async fetchAll(input: { maxDocs: number }): Promise<MapMarkersDataset> {
    if (!this.db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const now = Date.now();
    const cached = sharedDatasetCache;
    if (cached && cached.expiresAt > now && cached.maxDocs >= input.maxDocs) {
      return sliceDataset(cached.dataset, input.maxDocs);
    }
    const inFlight = sharedDatasetPromise;
    if (inFlight && inFlight.maxDocs >= input.maxDocs) {
      const dataset = await inFlight.promise;
      return sliceDataset(dataset, input.maxDocs);
    }

    const promise = this.fetchAllFromFirestore(input.maxDocs, { includeNonPublic: false });
    sharedDatasetPromise = { maxDocs: input.maxDocs, promise };
    try {
      const dataset = await promise;
      sharedDatasetCache = {
        dataset,
        expiresAt: Date.now() + env.MAP_MARKERS_CACHE_TTL_MS,
        maxDocs: input.maxDocs
      };
      return dataset;
    } finally {
      if (sharedDatasetPromise?.promise === promise) {
        sharedDatasetPromise = null;
      }
    }
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
      nextCursor:
        filtered.length > page.length
          ? String(page[page.length - 1]?.updatedAt ?? page[page.length - 1]?.createdAt ?? null)
          : null
    };
  }

  async fetchByOwner(input: { ownerId: string; maxDocs: number; includeNonPublic: boolean }): Promise<MapMarkersDataset> {
    if (!this.db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const ownerId = input.ownerId.trim();
    if (!ownerId) {
      return {
        markers: [],
        count: 0,
        generatedAt: Date.now(),
        version: "map-markers-v2-owner",
        etag: "\"empty\"",
        queryCount: 0,
        readCount: 0,
        invalidCoordinateDrops: 0
      };
    }
    return this.fetchByOwnerFromFirestore({
      ownerId,
      maxDocs: input.maxDocs,
      includeNonPublic: input.includeNonPublic
    });
  }

  static resetSharedCacheForTests(): void {
    MapMarkersFirestoreAdapter.invalidateSharedCache();
  }

  private async fetchAllFromFirestore(maxDocs: number, options: ProjectOptions): Promise<MapMarkersDataset> {
    const db = this.db;
    if (!db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const query = db
      .collection("posts")
      .orderBy("time", "desc")
      .select(
        "time",
        "createdAt",
        "createdAtMs",
        "updatedAt",
        "updatedAtMs",
        "lastUpdated",
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
        "deleted",
        "isDeleted",
        "archived",
        "hidden"
      )
      .limit(maxDocs);
    incrementDbOps("queries", 1);
    const snapshot = await query.get();
    incrementDbOps("reads", snapshot.docs.length);
    const projected = project(snapshot.docs, options);
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

  private async fetchByOwnerFromFirestore(input: {
    ownerId: string;
    maxDocs: number;
    includeNonPublic: boolean;
  }): Promise<MapMarkersDataset> {
    const db = this.db;
    if (!db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const selectFields = [
      "time",
      "createdAt",
      "createdAtMs",
      "updatedAt",
      "updatedAtMs",
      "lastUpdated",
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
      "deleted",
      "isDeleted",
      "archived",
      "hidden"
    ] as const;

    const queryByField = async (field: "userId" | "ownerId"): Promise<QueryDocumentSnapshot[]> => {
      const base = db.collection("posts").where(field, "==", input.ownerId);
      incrementDbOps("queries", 1);
      try {
        const snapshot = await base.orderBy("time", "desc").select(...selectFields).limit(input.maxDocs).get();
        incrementDbOps("reads", snapshot.docs.length);
        return snapshot.docs;
      } catch (error) {
        // Some environments may be missing the composite index (<field> + time). Fall back
        // to an unsorted query rather than returning no markers for profile minimaps.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("index")) {
          throw error;
        }
        const snapshot = await base.select(...selectFields).limit(input.maxDocs).get();
        incrementDbOps("reads", snapshot.docs.length);
        return snapshot.docs;
      }
    };
    const [userIdDocs, ownerIdDocs] = await Promise.all([queryByField("userId"), queryByField("ownerId")]);
    const dedupedDocs = new Map<string, QueryDocumentSnapshot>();
    for (const doc of userIdDocs) dedupedDocs.set(doc.id, doc);
    for (const doc of ownerIdDocs) dedupedDocs.set(doc.id, doc);
    const projected = project([...dedupedDocs.values()], { includeNonPublic: input.includeNonPublic });
    const limitedMarkers = projected.markers.slice(0, input.maxDocs);
    const generatedAt = Date.now();
    const etag = buildEtag(limitedMarkers);
    return {
      markers: limitedMarkers,
      count: limitedMarkers.length,
      generatedAt,
      version: "map-markers-v2-owner",
      etag,
      queryCount: 2,
      readCount: userIdDocs.length + ownerIdDocs.length,
      invalidCoordinateDrops: projected.invalidCoordinateDrops
    };
  }
}

function sliceDataset(dataset: MapMarkersDataset, maxDocs: number): MapMarkersDataset {
  if (dataset.markers.length <= maxDocs) {
    return {
      ...dataset,
      queryCount: 0,
      readCount: 0
    };
  }
  const markers = dataset.markers.slice(0, maxDocs);
  return {
    markers,
    count: markers.length,
    generatedAt: dataset.generatedAt,
    version: dataset.version,
    etag: buildEtag(markers),
    queryCount: 0,
    readCount: 0,
    invalidCoordinateDrops: dataset.invalidCoordinateDrops
  };
}

function project(
  docs: QueryDocumentSnapshot[],
  options: ProjectOptions
): { markers: MapMarkerRecord[]; invalidCoordinateDrops: number } {
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
    const updatedAt = readMillis(data.updatedAt ?? data.updatedAtMs ?? data.lastUpdated ?? data.time ?? data.createdAt ?? data.createdAtMs);
    const visibility = normalizeText(data.visibility ?? data.privacy);
    if (!options.includeNonPublic && !isEligibleVisibility(visibility)) continue;
    const ownerId = normalizeText(data.ownerId ?? data.userId);
    const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);
    const thumbKey = normalizeText((data as { thumbKey?: unknown }).thumbKey);
    const media = inferMedia(data);
    markers.push({
      id: doc.id,
      postId: doc.id,
      lat: coords.lat,
      lng: coords.lng,
      activity: readActivity(data.activity) ?? activities[0] ?? null,
      activities,
      createdAt,
      updatedAt,
      visibility,
      ownerId,
      thumbnailUrl,
      thumbKey,
      followedUserPic: null,
      hasPhoto: media.hasPhoto,
      hasVideo: media.hasVideo,
      openPayload: buildPostEnvelope({
        postId: doc.id,
        seed: {
          postId: doc.id,
          id: doc.id,
          thumbUrl: thumbnailUrl,
          displayPhotoLink: thumbnailUrl,
          mediaType: media.hasVideo ? "video" : "image",
          activities,
          activity: readActivity(data.activity),
          lat: coords.lat,
          long: coords.lng,
          userId: ownerId,
          authorId: ownerId,
          visibility,
          updatedAtMs: updatedAt ?? createdAt ?? Date.now(),
          createdAtMs: createdAt ?? updatedAt ?? Date.now(),
        },
        hydrationLevel: "marker",
        sourceRoute: "map.markers",
        debugSource: "MapMarkersFirestoreAdapter.project",
      }),
    });
  }
  markers.sort((a, b) => {
    const at = a.updatedAt ?? a.createdAt ?? 0;
    const bt = b.updatedAt ?? b.createdAt ?? 0;
    if (bt !== at) return bt - at;
    return a.postId.localeCompare(b.postId);
  });
  return { markers, invalidCoordinateDrops };
}

function isEligibleVisibility(value: string | null): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "public" || normalized === "public spot";
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
  const hasVideo = mediaType === "video";
  const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));
  return { hasPhoto, hasVideo };
}

function buildEtag(markers: MapMarkerRecord[]): string {
  const hash = createHash("sha1").update(JSON.stringify(markers)).digest("hex");
  return `"map-markers-v2-${hash}"`;
}
