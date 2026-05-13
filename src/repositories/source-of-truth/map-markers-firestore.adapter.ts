import { FieldPath, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { loadEnv } from "../../config/env.js";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import {
  clampConfiguredMapMarkersMaxDocs,
  clampMapMarkerIndexPageFirestoreLimit,
  resolveMapMarkerViewportCandidateLimit
} from "../../lib/map/map-marker-budgets.js";

const env = loadEnv();

function encodeGlobalMapCursor(lastDocId: string | null | undefined): string | null {
  const id = typeof lastDocId === "string" ? lastDocId.trim() : "";
  if (!id) return null;
  return Buffer.from(JSON.stringify({ v: 2, i: id }), "utf8").toString("base64url");
}

function decodeGlobalMapCursor(raw: string | null | undefined): { id: string } | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const o = JSON.parse(Buffer.from(raw.trim(), "base64url").toString("utf8")) as {
      v?: unknown;
      i?: unknown;
      t?: unknown;
    };
    if (o?.v === 2) {
      const id = String(o.i ?? "").trim();
      return id ? { id } : null;
    }
    if (o?.v === 1) {
      const id = String(o.i ?? "").trim();
      return id ? { id } : null;
    }
    return null;
  } catch {
    return null;
  }
}

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
  docsScanned: number;
  candidateLimit: number;
  sourceQueryMode: string;
  degradedReason: string | null;
  invalidCoordinateDrops: number;
};

type ProjectOptions = {
  /**
   * When true, include all visibilities (still excluding deleted/archived/hidden).
   * When false, only include "public"-style visibilities.
   */
  includeNonPublic: boolean;
  includeOpenPayload: boolean;
  /**
   * When false, keep Firestore read order (required for stable `startAfter` pagination).
   * Default true for owner/bounds surfaces that don't paginate with post-id cursors.
   */
  sortMarkers?: boolean;
};

export type MapMarkerBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type SharedDatasetCache = {
  dataset: MapMarkersDataset;
  page: GlobalMarkerPageMeta;
  expiresAt: number;
  maxDocs: number;
  includeOpenPayload: boolean;
};

let sharedDatasetCache: SharedDatasetCache | null = null;
let sharedDatasetPromise: {
  maxDocs: number;
  includeOpenPayload: boolean;
  promise: Promise<MapMarkersDataset & { page: GlobalMarkerPageMeta }>;
} | null = null;

type GlobalMarkerPageMeta = {
  lastReadDocId: string | null;
  firestoreReadSize: number;
};

const MAP_MARKER_SELECT_FIELDS = [
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
  "photoLinks2",
  "photoLinks3",
  "assets",
  "mediaType",
  "deleted",
  "isDeleted",
  "archived",
  "hidden"
] as const;

export class MapMarkersFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  static invalidateSharedCache(): void {
    sharedDatasetCache = null;
    sharedDatasetPromise = null;
  }

  async fetchAll(input: {
    maxDocs: number;
    includeOpenPayload?: boolean;
    /** Pagination: opaque cursor from prior `nextCursor` (global posts collection, document-id order). */
    cursor?: string | null;
  }): Promise<MapMarkersDataset & { hasMore: boolean; nextCursor: string | null }> {
    if (!this.db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const safeMaxDocs = clampMapMarkerIndexPageFirestoreLimit(input.maxDocs);
    const includeOpenPayload = input.includeOpenPayload ?? true;
    const cursorDecoded = decodeGlobalMapCursor(input.cursor ?? null);
    const now = Date.now();
    if (!cursorDecoded) {
      const cached = sharedDatasetCache;
      if (
        cached &&
        cached.expiresAt > now &&
        cached.maxDocs >= safeMaxDocs &&
        cached.includeOpenPayload === includeOpenPayload
      ) {
        const sliced = sliceDataset(cached.dataset, safeMaxDocs);
        const hasMore =
          cached.page.firestoreReadSize >= cached.maxDocs || cached.dataset.markers.length > sliced.markers.length;
        /** Always page by last raw Firestore doc in the chunk — `lastMarker.postId` can lag when trailing docs are filtered, skipping eligible posts. */
        const pageEndId = cached.page.lastReadDocId;
        return {
          ...sliced,
          hasMore,
          nextCursor: hasMore && pageEndId ? encodeGlobalMapCursor(pageEndId) : null
        };
      }
      const inFlight = sharedDatasetPromise;
      if (
        inFlight &&
        inFlight.maxDocs >= safeMaxDocs &&
        inFlight.includeOpenPayload === includeOpenPayload
      ) {
        const full = await inFlight.promise;
        const { page, ...dataset } = full;
        const sliced = sliceDataset(dataset, safeMaxDocs);
        const hasMore =
          page.firestoreReadSize >= inFlight.maxDocs || dataset.markers.length > sliced.markers.length;
        const pageEndId = page.lastReadDocId;
        return {
          ...sliced,
          hasMore,
          nextCursor: hasMore && pageEndId ? encodeGlobalMapCursor(pageEndId) : null
        };
      }

      const promise = this.fetchAllFromFirestore(
        safeMaxDocs,
        { includeNonPublic: false, includeOpenPayload },
        null
      );
      sharedDatasetPromise = { maxDocs: safeMaxDocs, includeOpenPayload, promise };
      try {
        const full = await promise;
        const { page, ...dataset } = full;
        sharedDatasetCache = {
          dataset,
          page,
          expiresAt: Date.now() + env.MAP_MARKERS_CACHE_TTL_MS,
          maxDocs: safeMaxDocs,
          includeOpenPayload
        };
        const hasMore = page.firestoreReadSize >= safeMaxDocs;
        return {
          ...dataset,
          hasMore,
          nextCursor: hasMore && page.lastReadDocId ? encodeGlobalMapCursor(page.lastReadDocId) : null
        };
      } finally {
        if (sharedDatasetPromise?.promise === promise) {
          sharedDatasetPromise = null;
        }
      }
    }

    const pagedFull = await this.fetchAllFromFirestore(
      safeMaxDocs,
      { includeNonPublic: false, includeOpenPayload },
      cursorDecoded.id
    );
    const { page: pagedPage, ...pagedDataset } = pagedFull;
    const hasMore = pagedPage.firestoreReadSize >= safeMaxDocs;
    return {
      ...pagedDataset,
      hasMore,
      nextCursor: hasMore && pagedPage.lastReadDocId ? encodeGlobalMapCursor(pagedPage.lastReadDocId) : null
    };
  }

  async fetchWindow(input: {
    maxDocs: number;
    bounds: MapMarkerBounds;
    limit: number;
    includeOpenPayload?: boolean;
  }): Promise<MapMarkersDataset & { hasMore: boolean; nextCursor: string | null }> {
    if (!this.db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const includeOpenPayload = input.includeOpenPayload ?? true;
    const safeCandidateLimit = resolveMapMarkerViewportCandidateLimit({
      pageLimit: input.limit,
      configuredMaxDocs: input.maxDocs
    });
    const attempt = await this.fetchWindowFromFirestore({
      bounds: input.bounds,
      candidateLimit: safeCandidateLimit,
      includeOpenPayload
    });
    if (attempt != null) {
      const filtered = attempt.markers.filter(
        (marker) =>
          marker.lng >= input.bounds.minLng &&
          marker.lng <= input.bounds.maxLng &&
          marker.lat >= input.bounds.minLat &&
          marker.lat <= input.bounds.maxLat
      );
      const hitReadCap = attempt.readCount >= safeCandidateLimit;
      const page = filtered.slice(0, input.limit);
      return {
        ...attempt,
        markers: page,
        count: page.length,
        hasMore: filtered.length > page.length || hitReadCap,
        nextCursor:
          filtered.length > page.length || hitReadCap
            ? encodeGlobalMapCursor(page[page.length - 1]?.postId ?? null)
            : null
      };
    }
    const fallback = await this.fetchAll({ maxDocs: safeCandidateLimit, includeOpenPayload });
    const filtered = fallback.markers.filter(
      (marker) =>
        marker.lng >= input.bounds.minLng &&
        marker.lng <= input.bounds.maxLng &&
        marker.lat >= input.bounds.minLat &&
        marker.lat <= input.bounds.maxLat
    );
    const hitReadCap = fallback.readCount >= safeCandidateLimit;
    const page = filtered.slice(0, input.limit);
    return {
      ...fallback,
      markers: page,
      count: page.length,
      candidateLimit: safeCandidateLimit,
      degradedReason: "bounds_query_failed_global_slice",
      sourceQueryMode: "global_latest_fallback",
      hasMore: filtered.length > page.length || hitReadCap,
      nextCursor:
        filtered.length > page.length || hitReadCap
          ? encodeGlobalMapCursor(page[page.length - 1]?.postId ?? null)
          : null
    };
  }

  async fetchByOwner(input: { ownerId: string; maxDocs: number; includeNonPublic: boolean; includeOpenPayload?: boolean }): Promise<MapMarkersDataset> {
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
        docsScanned: 0,
        candidateLimit: 0,
        sourceQueryMode: "owner_lookup",
        degradedReason: null,
        invalidCoordinateDrops: 0
      };
    }
    return this.fetchByOwnerFromFirestore({
      ownerId,
      maxDocs: input.maxDocs,
      includeNonPublic: input.includeNonPublic,
      includeOpenPayload: input.includeOpenPayload ?? true
    });
  }

  static resetSharedCacheForTests(): void {
    MapMarkersFirestoreAdapter.invalidateSharedCache();
  }

  private async fetchAllFromFirestore(
    maxDocs: number,
    options: ProjectOptions,
    startAfterPostId: string | null
  ): Promise<MapMarkersDataset & { page: GlobalMarkerPageMeta }> {
    const db = this.db;
    if (!db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    let startSnap: DocumentSnapshot | null = null;
    if (startAfterPostId) {
      startSnap = await db.collection("posts").doc(startAfterPostId).get();
      incrementDbOps("reads", 1);
      if (!startSnap.exists) {
        const generatedAt = Date.now();
        return {
          markers: [],
          count: 0,
          generatedAt,
          version: "map-markers-v2",
          etag: buildEtag([]),
          queryCount: 1,
          readCount: 0,
          docsScanned: 0,
          candidateLimit: maxDocs,
          sourceQueryMode: "global_document_id",
          degradedReason: "map_marker_start_after_doc_missing",
          invalidCoordinateDrops: 0,
          page: {
            lastReadDocId: null,
            firestoreReadSize: 0
          }
        };
      }
    }
    /**
     * Walk **every** `posts/{id}` document (document-id order). locava.app/home usually serves from the
     * legacy in-memory posts cache; its Firestore fallback uses `orderBy("time")`, which omits docs
     * without `time`. Map index here prefers completeness over matching that fallback query shape.
     */
    let query = db
      .collection("posts")
      .orderBy(FieldPath.documentId())
      .select(...MAP_MARKER_SELECT_FIELDS)
      .limit(maxDocs);
    if (startSnap?.exists) {
      query = query.startAfter(startSnap);
    }
    incrementDbOps("queries", 1);
    const snapshot = await query.get();
    incrementDbOps("reads", snapshot.docs.length);
    const projected = project(snapshot.docs, {
      ...options,
      sortMarkers: false
    });
    const generatedAt = Date.now();
    const etag = buildEtag(projected.markers);
    const lastReadDocId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1]!.id : null;
    return {
      markers: projected.markers,
      count: projected.markers.length,
      generatedAt,
      version: "map-markers-v2",
      etag,
      queryCount: startSnap?.exists ? 2 : 1,
      readCount: snapshot.docs.length + (startSnap?.exists ? 1 : 0),
      docsScanned: snapshot.docs.length,
      candidateLimit: maxDocs,
      sourceQueryMode: "global_document_id",
      degradedReason: null,
      invalidCoordinateDrops: projected.invalidCoordinateDrops,
      page: {
        lastReadDocId,
        firestoreReadSize: snapshot.size
      }
    };
  }

  private async fetchByOwnerFromFirestore(input: {
    ownerId: string;
    maxDocs: number;
    includeNonPublic: boolean;
    includeOpenPayload: boolean;
  }): Promise<MapMarkersDataset> {
    const db = this.db;
    if (!db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const queryByField = async (field: "userId" | "ownerId"): Promise<QueryDocumentSnapshot[]> => {
      const base = db.collection("posts").where(field, "==", input.ownerId);
      incrementDbOps("queries", 1);
      try {
        const snapshot = await base.orderBy("time", "desc").select(...MAP_MARKER_SELECT_FIELDS).limit(input.maxDocs).get();
        incrementDbOps("reads", snapshot.docs.length);
        return snapshot.docs;
      } catch (error) {
        // Some environments may be missing the composite index (<field> + time). Fall back
        // to an unsorted query rather than returning no markers for profile minimaps.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("index")) {
          throw error;
        }
        const snapshot = await base.select(...MAP_MARKER_SELECT_FIELDS).limit(input.maxDocs).get();
        incrementDbOps("reads", snapshot.docs.length);
        return snapshot.docs;
      }
    };
    const [userIdDocs, ownerIdDocs] = await Promise.all([queryByField("userId"), queryByField("ownerId")]);
    const dedupedDocs = new Map<string, QueryDocumentSnapshot>();
    for (const doc of userIdDocs) dedupedDocs.set(doc.id, doc);
    for (const doc of ownerIdDocs) dedupedDocs.set(doc.id, doc);
    const projected = project([...dedupedDocs.values()], {
      includeNonPublic: input.includeNonPublic,
      includeOpenPayload: input.includeOpenPayload
    });
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
      docsScanned: userIdDocs.length + ownerIdDocs.length,
      candidateLimit: input.maxDocs,
      sourceQueryMode: "owner_lookup",
      degradedReason: null,
      invalidCoordinateDrops: projected.invalidCoordinateDrops
    };
  }

  private async fetchWindowFromFirestore(input: {
    bounds: MapMarkerBounds;
    candidateLimit: number;
    includeOpenPayload: boolean;
  }): Promise<MapMarkersDataset | null> {
    const db = this.db;
    if (!db) {
      throw new Error("map_markers_firestore_unavailable");
    }
    const docs = new Map<string, QueryDocumentSnapshot>();
    let queryCount = 0;
    let readCount = 0;
    let failedQueries = 0;
    for (const latField of ["lat", "latitude"] as const) {
      try {
        incrementDbOps("queries", 1);
        queryCount += 1;
        const snapshot = await db
          .collection("posts")
          .where(latField, ">=", input.bounds.minLat)
          .where(latField, "<=", input.bounds.maxLat)
          .select(...MAP_MARKER_SELECT_FIELDS)
          .limit(input.candidateLimit)
          .get();
        incrementDbOps("reads", snapshot.docs.length);
        readCount += snapshot.docs.length;
        for (const doc of snapshot.docs) {
          docs.set(doc.id, doc);
        }
      } catch {
        failedQueries += 1;
      }
    }
    if (docs.size === 0 && failedQueries > 0) {
      return null;
    }
    const projected = project([...docs.values()], {
      includeNonPublic: false,
      includeOpenPayload: input.includeOpenPayload
    });
    const generatedAt = Date.now();
    const etag = buildEtag(projected.markers);
    return {
      markers: projected.markers,
      count: projected.markers.length,
      generatedAt,
      version: "map-markers-v2-bounds",
      etag,
      queryCount,
      readCount,
      docsScanned: readCount,
      candidateLimit: input.candidateLimit,
      sourceQueryMode: "viewport_bounds",
      degradedReason: failedQueries > 0 ? "bounds_partial_query_failure" : null,
      invalidCoordinateDrops: projected.invalidCoordinateDrops
    };
  }
}

function sliceDataset(dataset: MapMarkersDataset, maxDocs: number): MapMarkersDataset {
  if (dataset.markers.length <= maxDocs) {
    return {
      ...dataset,
      queryCount: 0,
      readCount: 0,
      docsScanned: 0,
      candidateLimit: Math.min(dataset.candidateLimit, maxDocs),
      sourceQueryMode: "cache_slice",
      degradedReason: dataset.degradedReason
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
    docsScanned: 0,
    candidateLimit: Math.min(dataset.candidateLimit, maxDocs),
    sourceQueryMode: "cache_slice",
    degradedReason: dataset.degradedReason,
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
      openPayload: options.includeOpenPayload
        ? buildMarkerOpenPayload({
            postId: doc.id,
            ownerId,
            thumbnailUrl,
            lat: coords.lat,
            lng: coords.lng,
            activities,
            activity: readActivity(data.activity),
            visibility,
            createdAt,
            updatedAt,
            hasVideo: media.hasVideo
          })
        : undefined,
    });
  }
  if (options.sortMarkers !== false) {
    markers.sort((a, b) => {
      const at = a.updatedAt ?? a.createdAt ?? 0;
      const bt = b.updatedAt ?? b.createdAt ?? 0;
      if (bt !== at) return bt - at;
      return a.postId.localeCompare(b.postId);
    });
  }
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

function buildMarkerOpenPayload(input: {
  postId: string;
  ownerId: string | null;
  thumbnailUrl: string | null;
  lat: number;
  lng: number;
  activities: string[];
  activity: string | null;
  visibility: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  hasVideo: boolean;
}): Record<string, unknown> {
  return buildPostEnvelope({
    postId: input.postId,
    seed: {
      postId: input.postId,
      id: input.postId,
      thumbUrl: input.thumbnailUrl,
      displayPhotoLink: input.thumbnailUrl,
      photoLink: input.thumbnailUrl,
      mediaType: input.hasVideo ? "video" : "image",
      activity: input.activity,
      activities: input.activities,
      lat: input.lat,
      lng: input.lng,
      long: input.lng,
      userId: input.ownerId,
      authorId: input.ownerId,
      visibility: input.visibility,
      likeCount: 0,
      likesCount: 0,
      commentCount: 0,
      commentsCount: 0,
      viewerHasLiked: false,
      viewerHasSaved: false,
      user: input.ownerId
        ? {
            userId: input.ownerId,
            handle: null,
            name: null,
            pic: null
          }
        : undefined,
      author: input.ownerId
        ? {
            userId: input.ownerId,
            handle: null,
            name: null,
            pic: null
          }
        : undefined,
      assets: input.thumbnailUrl
        ? [
            input.hasVideo
              ? {
                  id: `${input.postId}:marker-video`,
                  type: "video",
                  poster: input.thumbnailUrl,
                  thumbnail: input.thumbnailUrl,
                  variants: {}
                }
              : {
                  id: `${input.postId}:marker-image`,
                  type: "image",
                  original: input.thumbnailUrl,
                  thumbnail: input.thumbnailUrl,
                  poster: input.thumbnailUrl
                }
          ]
        : [],
      updatedAtMs: input.updatedAt ?? input.createdAt ?? Date.now(),
      createdAtMs: input.createdAt ?? input.updatedAt ?? Date.now()
    },
    hydrationLevel: "marker",
    sourceRoute: "map.markers",
    debugSource: "MapMarkersFirestoreAdapter.project"
  });
}

function buildEtag(markers: MapMarkerRecord[]): string {
  const hash = createHash("sha1").update(JSON.stringify(markers)).digest("hex");
  return `"map-markers-v2-${hash}"`;
}
