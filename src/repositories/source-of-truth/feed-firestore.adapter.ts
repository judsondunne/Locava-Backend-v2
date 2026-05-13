import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { globalCache } from "../../cache/global-cache.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { logFirestoreDebug } from "./firestore-debug.js";
import { readPostOrderMillis } from "./post-firestore-projection.js";
import { normalizeLetterboxHintsFromFirestorePost } from "../../lib/feed/normalizeLetterboxHintsFromPost.js";
import { buildSafeDisplayTextBlock, sanitizeDisplayFieldValue } from "../../lib/posts/displayText.js";
import { getFollowingFeedCacheGeneration } from "../../lib/feed/following-feed-cache-generation.js";

export type FirestoreFeedCandidate = {
  /** Firestore document ID — canonical post id */
  postId: string;
  /** Post author uid when present */
  authorId: string;
  slot: number;
  updatedAtMs: number;
  createdAtMs: number;
  mediaType: "image" | "video";
  posterUrl: string;
  firstAssetUrl: string | null;
  title: string | null;
  description: string | null;
  captionPreview: string | null;
  tags: string[];
  authorHandle: string | null;
  authorName: string | null;
  authorPic: string | null;
  activities: string[];
  address: string | null;
  geo: {
    lat: number | null;
    long: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    geohash: string | null;
  };
  assets: Array<{
    id: string;
    type: "image" | "video";
    previewUrl: string | null;
    posterUrl: string | null;
    originalUrl: string | null;
    blurhash: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    orientation: string | null;
  }>;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }> | null;
  likeCount: number;
  commentCount: number;
  likedByUserIds: string[];
  rawPost?: Record<string, unknown> | null;
  sourcePost?: Record<string, unknown> | null;
  comments?: Array<Record<string, unknown>>;
  commentsPreview?: Array<Record<string, unknown>>;
};

export type FirestoreFeedCandidatesPage = {
  items: FirestoreFeedCandidate[];
  hasMore: boolean;
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
};

type FeedTabMode = "explore" | "following";

type EmbeddedCommentWire = {
  id?: unknown;
  commentId?: unknown;
  replyingTo?: unknown;
};

const FEED_CANDIDATE_SELECT_FIELDS = [
  "feedSlot",
  "time",
  "createdAtMs",
  "updatedAtMs",
  "lastUpdated",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "userId",
  "mediaType",
  "thumbUrl",
  "displayPhotoLink",
  "photoLink",
  "photoLinks2",
  "photoLinks3",
  "title",
  "content",
  "caption",
  "text",
  "description",
  "tags",
  "userHandle",
  "userName",
  "userPic",
  "activities",
  "address",
  "long",
  "geoData",
  "likesCount",
  "likes",
  "commentsCount",
  "likeCount",
  "commentCount",
  "assets",
  "carouselFitWidth",
  "layoutLetterbox",
  "letterboxGradientTop",
  "letterboxGradientBottom",
  "letterboxGradients",
  "letterbox_gradient_top",
  "letterbox_gradient_bottom",
  "legacy",
  "deleted",
  "isDeleted",
  "archived",
  "hidden",
  "privacy"
] as const;

/** Extra fields so following-tab postcards match For You simple `tryMapSimpleFeedCandidate` + AppPostV2 wiring. */
const FEED_FOLLOWING_EXTRA_SELECT_FIELDS = [
  "media",
  "schema",
  "classification",
  "compatibility",
  "randomKey",
  "reel",
  "moderatorTier",
  "assetsReady",
  "instantPlaybackReady",
  "videoProcessingStatus",
  "location",
  "coordinates",
  "visibility",
  "status"
] as const;

const FOLLOWING_FEED_SELECT_FIELDS = [...new Set([...FEED_CANDIDATE_SELECT_FIELDS, ...FEED_FOLLOWING_EXTRA_SELECT_FIELDS])];

function followingFeedCandidateFieldList(): readonly string[] {
  return FOLLOWING_FEED_SELECT_FIELDS;
}

export class FeedFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly MAX_SCAN_LIMIT = 320;
  private static readonly FOLLOWING_MAX_READS = 80;
  private static readonly FOLLOWING_MAX_QUERIES = 8;
  private static readonly FOLLOWING_MAX_IDS = 50;
  private static readonly QUERY_CHUNK_LIMIT = 80;
  private static readonly PAGE_BUFFER = 24;
  private static readonly FIRST_PAGE_BUFFER = 8;
  private static readonly FIRST_PAGE_SCAN_FLOOR = 14;
  private static readonly FILTERED_SCAN_FLOOR = 24;
  private static readonly FIRESTORE_TIMEOUT_MS = 1500;

  isEnabled(): boolean {
    return this.db !== null;
  }

  async getFeedCandidatesPage(input: {
    viewerId: string;
    tab: FeedTabMode;
    cursorOffset: number;
    limit: number;
    lat?: number;
    lng?: number;
    radiusKm?: number;
  }): Promise<FirestoreFeedCandidatesPage> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const { viewerId, tab, cursorOffset, limit, lat, lng, radiusKm } = input;
    const radiusActive =
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng) &&
      typeof radiusKm === "number" &&
      Number.isFinite(radiusKm) &&
      radiusKm > 0 &&
      radiusKm < Infinity;
    const radiusRotationMsRaw = Number(process.env.FEED_RADIUS_ROTATION_BUCKET_MS ?? 300_000);
    const radiusRotationMs =
      Number.isFinite(radiusRotationMsRaw) && radiusRotationMsRaw >= 30_000 ? radiusRotationMsRaw : 300_000;
    const radiusRotationBucket = radiusActive ? Math.floor(Date.now() / radiusRotationMs) : null;
    const cacheRotationSuffix =
      radiusRotationBucket !== null ? `rb${radiusRotationBucket}` : new Date().toISOString().slice(0, 10);
    const followingFeedCacheGen =
      tab === "following" && viewerId !== "anonymous" ? await getFollowingFeedCacheGeneration(viewerId) : 0;
    const cacheKey = `feed:candidates:${viewerId}:${tab}:${lat ?? "_"}:${lng ?? "_"}:${radiusKm ?? "_"}:${cacheRotationSuffix}:g${followingFeedCacheGen}`;
    const requiredCandidateCount = cursorOffset + limit + 1;
    const cached = await globalCache.get<{ ranked: FirestoreFeedCandidate[]; sourceExhausted: boolean }>(cacheKey);
    if (cached && (cached.sourceExhausted || cached.ranked.length >= requiredCandidateCount) && cursorOffset <= cached.ranked.length) {
      const endExclusive = Math.min(cached.ranked.length, cursorOffset + limit);
      return {
        items: cached.ranked.slice(cursorOffset, endExclusive),
        hasMore: endExclusive < cached.ranked.length || cached.sourceExhausted === false,
        nextCursor: endExclusive < cached.ranked.length || cached.sourceExhausted === false ? `cursor:${endExclusive}` : null,
        queryCount: 0,
        readCount: 0
      };
    }
    const pageBuffer = cursorOffset === 0 ? FeedFirestoreAdapter.FIRST_PAGE_BUFFER : FeedFirestoreAdapter.PAGE_BUFFER;
    const scanFloor =
      tab === "following" || radiusActive
        ? FeedFirestoreAdapter.FILTERED_SCAN_FLOOR
        : cursorOffset === 0
          ? FeedFirestoreAdapter.FIRST_PAGE_SCAN_FLOOR
          : FeedFirestoreAdapter.FILTERED_SCAN_FLOOR;
    const basePerPageMultiplier = cursorOffset === 0 ? 3 : 6;
    let scanLimit = Math.min(
      FeedFirestoreAdapter.MAX_SCAN_LIMIT,
      Math.max(requiredCandidateCount + pageBuffer, limit * basePerPageMultiplier, scanFloor)
    );
    const startedAt = Date.now();
    let queryCount = 0;
    let readCount = 0;
    let sourceExhausted = false;
    const rankedBase: FirestoreFeedCandidate[] = [];
    let lastDoc: QueryDocumentSnapshot | undefined;
    try {
      if (tab === "following") {
        const bounded = await this.getFollowingCandidatesBounded({
          viewerId,
          requiredCandidateCount,
          cursorOffset,
          limit
        });
        rankedBase.push(...bounded.items);
        queryCount += bounded.queryCount;
        readCount += bounded.readCount;
        sourceExhausted = bounded.sourceExhausted;
      } else {
        logFirestoreDebug("feed_candidates_firestore_start", {
          collectionPath: "posts",
          queryShape: "orderBy(time desc).select(feed fields).limit(chunkedScan)",
          cursorOffset,
          limit,
          scanLimit,
          timeoutMs: FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS
        });
        while (readCount < scanLimit) {
          const chunkLimit = Math.min(FeedFirestoreAdapter.QUERY_CHUNK_LIMIT, scanLimit - readCount);
          let queryRef = this.db
            .collection("posts")
            .orderBy("time", "desc")
            .select(...FEED_CANDIDATE_SELECT_FIELDS)
            .limit(chunkLimit);
          if (lastDoc) {
            queryRef = queryRef.startAfter(lastDoc);
          }
          const snapshot = await withTimeout(
            queryRef.get(),
            FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "feed-firestore-candidates-query"
          );
          queryCount += 1;
          readCount += snapshot.docs.length;
          if (snapshot.docs.length === 0) {
            sourceExhausted = true;
            break;
          }
          rankedBase.push(
            ...snapshot.docs
              .filter((doc) => {
                const data = doc.data() as Record<string, unknown>;
                if (Boolean(data.deleted) || Boolean(data.isDeleted) || Boolean(data.archived) || Boolean(data.hidden)) return false;
                const privacy = typeof data.privacy === "string" ? data.privacy.toLowerCase() : "public";
                if (privacy === "private") return false;
                const thumb =
                  typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()
                    ? data.displayPhotoLink
                    : typeof data.thumbUrl === "string" && data.thumbUrl.trim()
                      ? data.thumbUrl
                      : null;
                const hasAssets = Array.isArray(data.assets) && data.assets.length > 0;
                if (!thumb && !hasAssets) return false;
                if (!radiusActive) return true;
                const postLat = normalizeGeo(data.lat ?? data.latitude);
                const postLng = normalizeGeo(data.long ?? data.lng ?? data.longitude);
                if (postLat == null || postLng == null) return false;
                const distance = computeDistanceKm(lat as number, lng as number, postLat, postLng);
                return distance != null && distance <= (radiusKm as number);
              })
              .map(mapDocToCandidate)
          );
          lastDoc = snapshot.docs[snapshot.docs.length - 1];
          if (snapshot.docs.length < chunkLimit) {
            sourceExhausted = true;
            break;
          }
          if (rankedBase.length >= requiredCandidateCount) {
            break;
          }
        }
      }
      logFirestoreDebug("feed_candidates_firestore_success", {
        collectionPath: "posts",
        elapsedMs: Date.now() - startedAt,
        docsRead: readCount,
        queryCount,
        timeoutMs: FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS
      });
    } catch (error) {
      logFirestoreDebug("feed_candidates_firestore_error", {
        collectionPath: "posts",
        elapsedMs: Date.now() - startedAt,
        timeoutMs: FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
    const dailyExploreSeed = `${viewerId}:${new Date().toISOString().slice(0, 10)}`;
    const exploreRotationSeed =
      tab === "explore" && radiusActive && radiusRotationBucket !== null
        ? `${viewerId}:geo:${(lat as number).toFixed(3)}:${(lng as number).toFixed(3)}:${Math.round((radiusKm as number) * 10)}:${radiusRotationBucket}`
        : dailyExploreSeed;
    const ranked =
      tab === "explore" ? rotateDeterministically(rankedBase, exploreRotationSeed) : rankedBase;
    void globalCache.set(cacheKey, { ranked, sourceExhausted }, 6_000).catch(() => undefined);
    if (cursorOffset >= ranked.length) {
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        queryCount,
        readCount
      };
    }
    const endExclusive = Math.min(ranked.length, cursorOffset + limit);
    return {
      items: ranked.slice(cursorOffset, endExclusive),
      hasMore: endExclusive < ranked.length || sourceExhausted === false,
      nextCursor: endExclusive < ranked.length || sourceExhausted === false ? `cursor:${endExclusive}` : null,
      queryCount,
      readCount
    };
  }

  private async loadFollowingIds(viewerId: string): Promise<Set<string>> {
    if (!this.db || !viewerId || viewerId === "anonymous") return new Set();
    const viewerDoc = await withTimeout(
      this.db.collection("users").doc(viewerId).get(),
      FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "feed-firestore-following-viewer-doc"
    );
    if (viewerDoc.exists) {
      const data = (viewerDoc.data() ?? {}) as { following?: unknown };
      if (Array.isArray(data.following)) {
        const ids = data.following
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .slice(0, FeedFirestoreAdapter.FOLLOWING_MAX_IDS);
        if (ids.length > 0) {
          return new Set(ids);
        }
      }
    }
    const snap = await withTimeout(
      this.db.collection("users").doc(viewerId).collection("following").limit(FeedFirestoreAdapter.FOLLOWING_MAX_IDS).get(),
      FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "feed-firestore-following-query"
    );
    return new Set(snap.docs.map((doc) => doc.id).filter(Boolean));
  }

  private async getFollowingCandidatesBounded(input: {
    viewerId: string;
    requiredCandidateCount: number;
    cursorOffset: number;
    limit: number;
  }): Promise<{ items: FirestoreFeedCandidate[]; queryCount: number; readCount: number; sourceExhausted: boolean }> {
    const target = Math.min(Math.max(input.requiredCandidateCount + 8, input.limit + 4), FeedFirestoreAdapter.FOLLOWING_MAX_READS);
    let queryCount = 0;
    let readCount = 0;
    const byId = new Map<string, FirestoreFeedCandidate>();

    // Option A: viewer fanout feed collection if present.
    const fanoutSnap = await withTimeout(
      this.db!.collection("users").doc(input.viewerId).collection("feed").orderBy("time", "desc").limit(Math.min(target, 24)).get(),
      700,
      "feed-following-fanout-query"
    ).catch(() => null);
    if (fanoutSnap) {
      queryCount += 1;
      readCount += fanoutSnap.size;
      const fanoutIds = fanoutSnap.docs
        .map((doc) => {
          const data = (doc.data() ?? {}) as Record<string, unknown>;
          const postId = typeof data.postId === "string" && data.postId.trim() ? data.postId.trim() : doc.id;
          return postId;
        })
        .filter(Boolean);
      if (fanoutIds.length > 0 && readCount < FeedFirestoreAdapter.FOLLOWING_MAX_READS) {
        const rows = await this.getCandidatesByPostIds(fanoutIds.slice(0, FeedFirestoreAdapter.FOLLOWING_MAX_READS - readCount), {
          selectMode: "following"
        });
        queryCount += rows.queryCount;
        readCount += rows.readCount;
        for (const row of rows.items) byId.set(row.postId, row);
      }
    }

    // Option B: bounded following queries.
    if (byId.size < target && readCount < FeedFirestoreAdapter.FOLLOWING_MAX_READS && queryCount < FeedFirestoreAdapter.FOLLOWING_MAX_QUERIES) {
      const followingIds = [...(await this.loadFollowingIds(input.viewerId))].slice(0, FeedFirestoreAdapter.FOLLOWING_MAX_IDS);
      const chunks: string[][] = [];
      for (let i = 0; i < followingIds.length; i += 10) chunks.push(followingIds.slice(i, i + 10));
      for (const chunk of chunks) {
        if (chunk.length === 0) continue;
        if (readCount >= FeedFirestoreAdapter.FOLLOWING_MAX_READS || queryCount >= FeedFirestoreAdapter.FOLLOWING_MAX_QUERIES || byId.size >= target) break;
        const perChunkLimit = Math.max(4, Math.min(12, target - byId.size));
        const snap = await withTimeout(
          this.db!
            .collection("posts")
            .where("userId", "in", chunk)
            .orderBy("time", "desc")
            .select(...followingFeedCandidateFieldList())
            .limit(perChunkLimit)
            .get(),
          900,
          "feed-following-bounded-query"
        ).catch(() => null);
        if (!snap) continue;
        queryCount += 1;
        readCount += snap.size;
        for (const doc of snap.docs) {
          const candidate = mapDocToCandidate(doc);
          byId.set(candidate.postId, candidate);
        }
      }
    }

    const ordered = [...byId.values()].sort((a, b) =>
      a.createdAtMs === b.createdAtMs ? b.postId.localeCompare(a.postId) : b.createdAtMs - a.createdAtMs
    );
    return {
      items: ordered.slice(0, target),
      queryCount,
      readCount,
      sourceExhausted: readCount < FeedFirestoreAdapter.FOLLOWING_MAX_READS
    };
  }

  async getCandidatesByPostIds(
    postIds: string[],
    options?: { selectMode?: "default" | "following" }
  ): Promise<{ items: FirestoreFeedCandidate[]; queryCount: number; readCount: number }> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const uniqueIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { items: [], queryCount: 0, readCount: 0 };
    }
    const fieldMask =
      options?.selectMode === "following" ? followingFeedCandidateFieldList() : FEED_CANDIDATE_SELECT_FIELDS;
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += 50) {
      chunks.push(uniqueIds.slice(i, i + 50));
    }
    let queryCount = 0;
    let readCount = 0;
    const items: FirestoreFeedCandidate[] = [];
    for (const chunk of chunks) {
      const refs = chunk.map((id) => this.db!.collection("posts").doc(id));
      const docs = await withTimeout(
        this.db.getAll(...refs, { fieldMask: [...fieldMask] }),
        Math.min(500, FeedFirestoreAdapter.FIRESTORE_TIMEOUT_MS),
        "feed-firestore-candidates-by-id"
      );
      readCount += docs.length;
      items.push(
        ...docs
          .filter((doc) => doc.exists)
          .filter((doc) => {
            const data = doc.data() as Record<string, unknown>;
            if (Boolean(data.deleted) || Boolean(data.isDeleted) || Boolean(data.archived) || Boolean(data.hidden)) return false;
            const privacy = typeof data.privacy === "string" ? data.privacy.toLowerCase() : "public";
            if (privacy === "private") return false;
            const thumb =
              typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()
                ? data.displayPhotoLink
                : typeof data.thumbUrl === "string" && data.thumbUrl.trim()
                  ? data.thumbUrl
                  : null;
            const hasAssets = Array.isArray(data.assets) && data.assets.length > 0;
            return Boolean(thumb || hasAssets);
          })
          .map((doc) => mapDocToCandidate(doc as QueryDocumentSnapshot))
      );
    }
    return { items, queryCount, readCount };
  }
}

function rotateDeterministically<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return items;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  const offset = hash % items.length;
  if (offset === 0) return items;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function mapDocToCandidate(doc: QueryDocumentSnapshot): FirestoreFeedCandidate {
  const data = doc.data() as Record<string, unknown> & { feedSlot?: number };
  const fallbackSlot = (hashToInt(doc.id, 160) % 160) + 1;
  const slot = normalizeSlot(data.feedSlot, fallbackSlot);
  const orderMs = readPostOrderMillis(data);
  const createdAtMs =
    typeof data.createdAtMs === "number" && Number.isFinite(data.createdAtMs) && data.createdAtMs > 0
      ? Math.floor(data.createdAtMs)
      : orderMs > 0
        ? orderMs
        : Date.now();
  const updatedAtMs = orderMs > 0 ? orderMs : Date.now();
  const authorId = typeof data.userId === "string" && data.userId.trim() ? data.userId.trim() : "";
  const mediaType = inferMediaType(data);
  const posterUrl = readPosterUrl(data);
  const safeText = buildSafeDisplayTextBlock(data as Record<string, unknown>);
  const legacyText =
    typeof data.text === "string" && data.text.trim()
      ? sanitizeDisplayFieldValue(data.text, data as Record<string, unknown>)
      : "";
  const captionPreview = safeText.caption || safeText.description || safeText.content || legacyText || null;
  const title = safeText.title || null;
  const description = safeText.description || null;
  const firstAssetUrl = readFirstAssetUrl(data);
  const activities = Array.isArray(data.activities)
    ? data.activities.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(data.tags) ? data.tags.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
  const geoData = (data.geoData ?? {}) as Record<string, unknown>;
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const topLevelEmbeddedCommentCount = comments.filter((entry) => isTopLevelEmbeddedComment(entry)).length;
  const { letterboxGradientTop, letterboxGradientBottom, letterboxGradients } =
    normalizeLetterboxHintsFromFirestorePost(data);
  return {
    postId: doc.id,
    authorId,
    slot,
    updatedAtMs,
    createdAtMs,
    mediaType,
    posterUrl,
    firstAssetUrl,
    title,
    description,
    captionPreview,
    tags,
    authorHandle: normalizeText(data.userHandle),
    authorName: normalizeText(data.userName),
    authorPic: normalizeText(data.userPic),
    activities,
    address: normalizeText(data.address),
    geo: {
      lat: normalizeGeo(data.lat ?? data.latitude),
      long: normalizeGeo(data.long ?? data.lng ?? data.longitude),
      city: normalizeText(geoData.city),
      state: normalizeText(geoData.state),
      country: normalizeText(geoData.country),
      geohash: normalizeText(geoData.geohash)
    },
    assets: normalizeAssetsForCard(data.assets),
    carouselFitWidth: typeof data.carouselFitWidth === "boolean" ? data.carouselFitWidth : undefined,
    layoutLetterbox: typeof data.layoutLetterbox === "boolean" ? data.layoutLetterbox : undefined,
    letterboxGradientTop,
    letterboxGradientBottom,
    letterboxGradients,
    likeCount: normalizeCount(data.likesCount ?? data.likeCount),
    commentCount: resolveCommentCount(
      data.commentsCount ?? data.commentCount,
      topLevelEmbeddedCommentCount,
    ),
    likedByUserIds: normalizeIdArray(data.likes),
    rawPost: data,
    sourcePost: data,
    comments: comments as Array<Record<string, unknown>>,
    commentsPreview: comments.filter((entry) => isTopLevelEmbeddedComment(entry)) as Array<Record<string, unknown>>,
  };
}

function isTopLevelEmbeddedComment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const wire = value as EmbeddedCommentWire;
  const commentIdRaw = wire.id ?? wire.commentId;
  const commentId = typeof commentIdRaw === "string" ? commentIdRaw.trim() : "";
  if (!commentId) return false;
  return wire.replyingTo == null;
}

function inferMediaType(data: Record<string, unknown>): "image" | "video" {
  const raw = typeof data.mediaType === "string" ? data.mediaType.toLowerCase() : "";
  if (raw === "video") return "video";
  if (Array.isArray(data.assets) && data.assets.length > 0) {
    const first = data.assets[0] as Record<string, unknown>;
    if (String(first?.type ?? "").toLowerCase() === "video") return "video";
  }
  return "image";
}

function readPosterUrl(data: Record<string, unknown>): string {
  const direct = [data.displayPhotoLink, data.thumbUrl];
  for (const item of direct) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  if (Array.isArray(data.assets) && data.assets.length > 0 && typeof data.assets[0] === "object") {
    const first = data.assets[0] as Record<string, unknown>;
    const fromAsset = [first.downloadURL, first.url, first.poster, first.thumbnail];
    for (const item of fromAsset) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return "";
}

function readFirstAssetUrl(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.assets) || data.assets.length === 0 || typeof data.assets[0] !== "object") {
    return null;
  }
  const first = data.assets[0] as Record<string, unknown>;
  const variants = (first.variants ?? {}) as Record<string, unknown>;
  const sm = (variants.sm ?? {}) as Record<string, unknown>;
  const md = (variants.md ?? {}) as Record<string, unknown>;
  const lg = (variants.lg ?? {}) as Record<string, unknown>;
  const thumb = (variants.thumb ?? {}) as Record<string, unknown>;
  const candidates = [
    sm.webp,
    md.webp,
    lg.webp,
    thumb.webp,
    first.original,
    first.url,
    first.downloadURL
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function normalizeCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function resolveCommentCount(value: unknown, embeddedTopLevelCount: number): number {
  const explicit = normalizeCount(value);
  if (explicit > 0) return explicit;
  return Math.max(0, Math.floor(embeddedTopLevelCount));
}

function normalizeIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object" && typeof (entry as { userId?: unknown }).userId === "string") {
        return String((entry as { userId: string }).userId).trim();
      }
      return "";
    })
    .filter(Boolean);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function isLikelyVideoUrlString(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(value.trim());
}

function inferCardAssetIsVideo(asset: Record<string, unknown>): boolean {
  if (String(asset.type ?? "").toLowerCase() === "video") return true;
  const id = normalizeText(asset.id) ?? "";
  if (/^video_/i.test(id)) return true;
  const direct =
    normalizeText(asset.original) ?? normalizeText(asset.url) ?? normalizeText(asset.downloadURL as string | undefined);
  if (isLikelyVideoUrlString(direct)) return true;
  const variants = (asset.variants ?? {}) as Record<string, unknown>;
  return Object.values(variants).some((v) => typeof v === "string" && isLikelyVideoUrlString(v));
}

function normalizeAssetsForCard(value: unknown): FirestoreFeedCandidate["assets"] {
  if (!Array.isArray(value)) return [];
  const out: FirestoreFeedCandidate["assets"] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== "object") continue;
    const asset = raw as Record<string, unknown>;
    const variants = (asset.variants ?? {}) as Record<string, unknown>;
    const sm = (variants.sm ?? {}) as Record<string, unknown>;
    const md = (variants.md ?? {}) as Record<string, unknown>;
    const lg = (variants.lg ?? {}) as Record<string, unknown>;
    const thumb = (variants.thumb ?? {}) as Record<string, unknown>;
    out.push({
      id: normalizeText(asset.id) ?? `asset-${i + 1}`,
      type: inferCardAssetIsVideo(asset) ? "video" : "image",
      previewUrl: normalizeText(sm.webp) ?? normalizeText(md.webp) ?? normalizeText(lg.webp),
      posterUrl: normalizeText(thumb.webp) ?? normalizeText(sm.webp),
      originalUrl: normalizeText(asset.original) ?? normalizeText(asset.url) ?? normalizeText(asset.downloadURL),
      blurhash: normalizeText(asset.blurhash),
      width: normalizeGeo(asset.width),
      height: normalizeGeo(asset.height),
      aspectRatio: normalizeGeo(asset.aspectRatio),
      orientation: normalizeText(asset.orientation)
    });
  }
  return out;
}

function normalizeSlot(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const slot = Math.floor(value);
  if (slot < 1 || slot > 160) return fallback;
  return slot;
}

function hashToInt(seed: string, mod: number): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) {
    n = (n + seed.charCodeAt(i) * (i + 19)) % 1_000_003;
  }
  return n % Math.max(1, mod);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

function normalizeGeo(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function computeDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(n))) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}
