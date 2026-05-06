import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { FEED_READ_NORMALIZED_ASSET_MAX } from "../../constants/feed-read-assets.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { readMaybeMillis } from "../source-of-truth/post-firestore-projection.js";

export type SimpleFeedSortMode = "randomKey" | "docId";
export const FOR_YOU_SIMPLE_SURFACE = "for_you_simple" as const;
const READY_DECK_COLLECTION = "feedDecks";
const SERVED_RECENT_COLLECTION = "feedServedRecent";

/** Bounded durable seen read for simple feed (avoid 500-read pages). */
export const FOR_YOU_SIMPLE_SEEN_READ_CAP = 120;

export type SimpleFeedCandidate = {
  postId: string;
  sortValue: number | string;
  reel: boolean;
  authorId: string;
  createdAtMs: number;
  updatedAtMs: number;
  mediaType: "image" | "video";
  posterUrl: string;
  firstAssetUrl: string | null;
  title: string | null;
  captionPreview: string | null;
  authorHandle: string;
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
    streamUrl: string | null;
    mp4Url: string | null;
    blurhash: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    orientation: string | null;
    /** Plain https variant URLs from Firestore (no metadata blobs) — used for ladder selection on cards. */
    playbackVariantUrls?: Record<string, string>;
  }>;
  assetsReady?: boolean;
  instantPlaybackReady?: boolean;
  videoProcessingStatus?: string | null;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  likeCount: number;
  commentCount: number;
  /** Original Firestore `assets[]` length (before normalize cap); used to detect slim deck rows vs multi-asset posts. */
  sourceFirestoreAssetArrayLen?: number;
  /** Raw Firestore fields for AppPostV2 (`toFeedCardDTO` sourceRawPost). */
  rawFirestore?: Record<string, unknown>;
};

export type SimpleFeedBatchSliceStats = {
  rawDocCount: number;
  filteredInvisible: number;
  filteredMissingAuthor: number;
  filteredMissingMedia: number;
  filteredInvalidContract: number;
  filteredInvalidSort: number;
  playableMapped: number;
};

export type SimpleFeedBatchResult = {
  items: SimpleFeedCandidate[];
  rawCount: number;
  segmentExhausted: boolean;
  readCount: number;
  stats: SimpleFeedBatchSliceStats;
  /** Firestore tail (for pagination when every doc in the page is filtered out). */
  tailRandomKey: number | null;
  tailDocId: string | null;
};

export type SimpleReadyDeckDoc = {
  viewerId: string;
  surface: string;
  generation: number;
  updatedAtMs: number;
  expiresAtMs: number;
  refillReason: string | null;
  /** v2+ decks store full normalized `assets[]` (see `FEED_READ_NORMALIZED_ASSET_MAX`). Omit or <2 = legacy cover-only deck — ignored at read. */
  deckFormat?: number;
  items: SimpleFeedCandidate[];
};

const SIMPLE_FEED_SELECT_FIELDS = [
  "schema",
  "classification",
  "compatibility",
  "media",
  "randomKey",
  "userId",
  "reel",
  "time",
  "createdAtMs",
  "updatedAtMs",
  "lastUpdated",
  "mediaType",
  "thumbUrl",
  "displayPhotoLink",
  "title",
  "caption",
  "text",
  "description",
  "userHandle",
  "userName",
  "userPic",
  "activities",
  "address",
  "lat",
  "lng",
  "long",
  "latitude",
  "longitude",
  "geoData",
  "assets",
  "carouselFitWidth",
  "layoutLetterbox",
  "letterboxGradientTop",
  "letterboxGradientBottom",
  "letterboxGradients",
  "letterbox_gradient_top",
  "letterbox_gradient_bottom",
  "legacy",
  "likesCount",
  "likeCount",
  "commentCount",
  "commentsCount",
  "assetsReady",
  "instantPlaybackReady",
  "videoProcessingStatus",
  "deleted",
  "isDeleted",
  "archived",
  "hidden",
  "privacy",
  "visibility",
  "status"
] as const;

export class FeedForYouSimpleRepository {
  private readonly db = getFirestoreSourceClient();
  private randomKeySupportCache: { checkedAtMs: number; available: boolean } | null = null;

  isEnabled(): boolean {
    return this.db !== null;
  }

  async resolveSortMode(): Promise<SimpleFeedSortMode> {
    return (await this.hasRandomKeySupport()) ? "randomKey" : "docId";
  }

  async fetchBatch(input: {
    mode: SimpleFeedSortMode;
    anchor: number | string;
    wrapped: boolean;
    lastValue: number | string | null;
    lastPostId?: string | null;
    limit: number;
    reelOnly?: boolean;
  }): Promise<SimpleFeedBatchResult> {
    if (!this.db) throw new Error("feed_for_you_simple_source_unavailable");
    const boundedLimit = Math.max(1, Math.min(input.limit, 40));
    let query = this.db.collection("posts").select(...SIMPLE_FEED_SELECT_FIELDS);
    if (input.reelOnly) {
      query = query.where("reel", "==", true);
    }

    if (input.mode === "randomKey") {
      const anchor = typeof input.anchor === "number" ? input.anchor : Number(input.anchor);
      if (!Number.isFinite(anchor)) throw new Error("invalid_simple_feed_anchor");
      query = query.orderBy("randomKey", "asc").orderBy(FieldPath.documentId(), "asc");
      if (input.wrapped) {
        query = query.where("randomKey", "<", anchor);
      } else {
        query = query.where("randomKey", ">=", anchor);
      }
      if (typeof input.lastValue === "number" && Number.isFinite(input.lastValue)) {
        const lastPostId = typeof input.lastPostId === "string" ? input.lastPostId.trim() : "";
        query = lastPostId ? query.startAfter(input.lastValue, lastPostId) : query.startAfter(input.lastValue);
      }
    } else {
      const anchor = typeof input.anchor === "string" ? input.anchor : String(input.anchor ?? "");
      query = query.orderBy(FieldPath.documentId(), "asc");
      if (input.wrapped) {
        if (typeof input.lastValue === "string" && input.lastValue.trim()) {
          query = query.startAfter(input.lastValue.trim());
        }
        query = query.endBefore(anchor);
      } else {
        if (typeof input.lastValue === "string" && input.lastValue.trim()) {
          query = query.startAfter(input.lastValue.trim());
        } else {
          query = query.startAt(anchor);
        }
      }
    }

    incrementDbOps("queries", 1);
    const snap = await query.limit(boundedLimit).get();
    incrementDbOps("reads", snap.docs.length);

    const stats: SimpleFeedBatchSliceStats = {
      rawDocCount: snap.docs.length,
      filteredInvisible: 0,
      filteredMissingAuthor: 0,
      filteredMissingMedia: 0,
      filteredInvalidContract: 0,
      filteredInvalidSort: 0,
      playableMapped: 0
    };
    const items: SimpleFeedCandidate[] = [];
    let tailRandomKey: number | null = null;
    let tailDocId: string | null = null;
    for (const doc of snap.docs) {
      const raw = doc.data() as Record<string, unknown>;
      tailDocId = doc.id;
      tailRandomKey = num(raw.randomKey);
      const mapped = tryMapSimpleFeedCandidate(input.mode, doc.id, raw);
      if ("reject" in mapped) {
        switch (mapped.reject) {
          case "invisible":
            stats.filteredInvisible += 1;
            break;
          case "no_author":
            stats.filteredMissingAuthor += 1;
            break;
          case "no_media":
            stats.filteredMissingMedia += 1;
            break;
          case "invalid_contract":
            stats.filteredInvalidContract += 1;
            break;
          case "bad_sort":
            stats.filteredInvalidSort += 1;
            break;
          default:
            stats.filteredInvalidContract += 1;
        }
        continue;
      }
      stats.playableMapped += 1;
      items.push(mapped.candidate);
    }

    return {
      items,
      rawCount: snap.docs.length,
      segmentExhausted: snap.docs.length < boundedLimit,
      readCount: snap.docs.length,
      stats,
      tailRandomKey,
      tailDocId
    };
  }

  /**
   * Last-resort bounded scan: recent public posts with playable media only (same visibility rules as map).
   */
  async fetchEmergencyPlayableSlice(input: { limit: number }): Promise<SimpleFeedBatchResult> {
    if (!this.db) throw new Error("feed_for_you_simple_source_unavailable");
    const boundedLimit = Math.max(1, Math.min(input.limit, 40));
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await this.db
        .collection("posts")
        .select(...SIMPLE_FEED_SELECT_FIELDS)
        .orderBy("time", "desc")
        .limit(boundedLimit)
        .get();
    } catch {
      incrementDbOps("queries", 1);
      snap = await this.db
        .collection("posts")
        .select(...SIMPLE_FEED_SELECT_FIELDS)
        .orderBy(FieldPath.documentId(), "desc")
        .limit(boundedLimit)
        .get();
    }
    incrementDbOps("reads", snap.docs.length);
    const stats: SimpleFeedBatchSliceStats = {
      rawDocCount: snap.docs.length,
      filteredInvisible: 0,
      filteredMissingAuthor: 0,
      filteredMissingMedia: 0,
      filteredInvalidContract: 0,
      filteredInvalidSort: 0,
      playableMapped: 0
    };
    const items: SimpleFeedCandidate[] = [];
    let tailRandomKey: number | null = null;
    let tailDocId: string | null = null;
    for (const doc of snap.docs) {
      const raw = doc.data() as Record<string, unknown>;
      tailDocId = doc.id;
      tailRandomKey = num(raw.randomKey);
      const mapped = tryMapSimpleFeedCandidate("docId", doc.id, raw);
      if ("reject" in mapped) {
        switch (mapped.reject) {
          case "invisible":
            stats.filteredInvisible += 1;
            break;
          case "no_author":
            stats.filteredMissingAuthor += 1;
            break;
          case "no_media":
            stats.filteredMissingMedia += 1;
            break;
          case "invalid_contract":
            stats.filteredInvalidContract += 1;
            break;
          case "bad_sort":
            stats.filteredInvalidSort += 1;
            break;
          default:
            stats.filteredInvalidContract += 1;
        }
        continue;
      }
      stats.playableMapped += 1;
      items.push(mapped.candidate);
    }
    return {
      items,
      rawCount: snap.docs.length,
      segmentExhausted: true,
      readCount: snap.docs.length,
      stats,
      tailRandomKey,
      tailDocId
    };
  }

  async fetchCandidatesByPostIds(postIds: string[]): Promise<SimpleFeedCandidate[]> {
    if (!this.db) throw new Error("feed_for_you_simple_source_unavailable");
    const ordered = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
    if (ordered.length === 0) return [];
    const refs = ordered.map((postId) => this.db!.collection("posts").doc(postId));
    incrementDbOps("queries", 1);
    const snaps = await this.db.getAll(...refs);
    incrementDbOps("reads", snaps.length);
    const mappedById = new Map<string, SimpleFeedCandidate>();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const raw = (snap.data() ?? {}) as Record<string, unknown>;
      const mapped = tryMapSimpleFeedCandidate("docId", snap.id, raw);
      if ("candidate" in mapped) mappedById.set(snap.id, mapped.candidate);
    }
    return ordered.map((id) => mappedById.get(id)).filter((row): row is SimpleFeedCandidate => Boolean(row));
  }

  async loadBlockedAuthorIdsForViewer(viewerId: string): Promise<{ blocked: Set<string>; readCount: number }> {
    if (!this.db) return { blocked: new Set(), readCount: 0 };
    const id = viewerId.trim();
    if (!id) return { blocked: new Set(), readCount: 0 };
    incrementDbOps("queries", 1);
    const doc = await this.db.collection("users").doc(id).get();
    incrementDbOps("reads", doc.exists ? 1 : 0);
    if (!doc.exists) return { blocked: new Set(), readCount: 1 };
    const data = doc.data() as { blockedUsers?: unknown };
    const blocked = new Set<string>(
      Array.isArray(data.blockedUsers) ? data.blockedUsers.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []
    );
    return { blocked, readCount: 1 };
  }

  async listRecentSeenPostIdsForViewer(input: {
    viewerId: string;
    surface: string;
    limit: number;
  }): Promise<{ postIds: Set<string>; readCount: number }> {
    if (!this.db) return { postIds: new Set(), readCount: 0 };
    const viewerId = input.viewerId.trim();
    const surface = input.surface.trim();
    if (!viewerId || !surface) return { postIds: new Set(), readCount: 0 };
    const boundedLimit = Math.max(1, Math.min(Math.floor(input.limit), FOR_YOU_SIMPLE_SEEN_READ_CAP));
    incrementDbOps("queries", 1);
    const snap = await this.db
      .collection("feedSeen")
      .where("viewerId", "==", viewerId)
      .where("surface", "==", surface)
      .orderBy("lastServedAt", "desc")
      .limit(boundedLimit)
      .get();
    incrementDbOps("reads", snap.docs.length);
    const postIds = new Set<string>();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const postId = pickString(data.postId);
      if (postId) postIds.add(postId);
    }
    return { postIds, readCount: snap.docs.length };
  }

  async markPostsServedForViewer(input: {
    viewerId: string;
    postIds: string[];
    surface: string;
  }): Promise<void> {
    if (!this.db) return;
    const viewerId = input.viewerId.trim();
    const surface = input.surface.trim();
    if (!viewerId || !surface) return;
    const uniquePostIds = [...new Set(input.postIds.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
    if (uniquePostIds.length === 0) return;
    const batch = this.db.batch();
    for (const postId of uniquePostIds) {
      batch.set(
        this.db.collection("feedSeen").doc(`${viewerId}_${postId}`),
        {
          viewerId,
          postId,
          surface,
          firstServedAt: FieldValue.serverTimestamp(),
          lastServedAt: FieldValue.serverTimestamp(),
          servedCount: FieldValue.increment(1)
        },
        { merge: true }
      );
    }
    await batch.commit();
    incrementDbOps("writes", uniquePostIds.length);
  }

  async readServedRecentForViewer(input: {
    viewerId: string;
    surface: string;
    limit: number;
    ttlMs: number;
  }): Promise<{ postIds: Set<string>; readCount: number }> {
    if (!this.db) return { postIds: new Set(), readCount: 0 };
    const viewerId = input.viewerId.trim();
    const surface = input.surface.trim();
    if (!viewerId || !surface) return { postIds: new Set(), readCount: 0 };
    const docId = `${viewerId}_${surface}`;
    incrementDbOps("queries", 1);
    const snap = await this.db.collection(SERVED_RECENT_COLLECTION).doc(docId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return { postIds: new Set(), readCount: 1 };
    const now = Date.now();
    const data = (snap.data() ?? {}) as { entries?: unknown };
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const keep = entries
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const postId = pickString((row as { postId?: unknown }).postId);
        const servedAtMs = num((row as { servedAtMs?: unknown }).servedAtMs) ?? 0;
        if (!postId || servedAtMs <= 0) return null;
        if (now - servedAtMs > input.ttlMs) return null;
        return { postId, servedAtMs };
      })
      .filter((row): row is { postId: string; servedAtMs: number } => row !== null)
      .sort((a, b) => b.servedAtMs - a.servedAtMs)
      .slice(0, Math.max(1, Math.min(input.limit, 400)));
    return { postIds: new Set(keep.map((row) => row.postId)), readCount: 1 };
  }

  async markPostsServedRecentForViewer(input: {
    viewerId: string;
    surface: string;
    postIds: string[];
    maxEntries: number;
    ttlMs: number;
  }): Promise<{ ok: boolean; writes: number }> {
    if (!this.db) return { ok: false, writes: 0 };
    const viewerId = input.viewerId.trim();
    const surface = input.surface.trim();
    if (!viewerId || !surface) return { ok: false, writes: 0 };
    const nextPostIds = [...new Set(input.postIds.map((id) => id.trim()).filter(Boolean))];
    if (nextPostIds.length === 0) return { ok: true, writes: 0 };
    const docRef = this.db.collection(SERVED_RECENT_COLLECTION).doc(`${viewerId}_${surface}`);
    const now = Date.now();
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const current = (snap.data() ?? {}) as { entries?: unknown };
      const entries = Array.isArray(current.entries) ? current.entries : [];
      const map = new Map<string, number>();
      for (const row of entries) {
        if (!row || typeof row !== "object") continue;
        const postId = pickString((row as { postId?: unknown }).postId);
        const servedAtMs = num((row as { servedAtMs?: unknown }).servedAtMs) ?? 0;
        if (!postId || servedAtMs <= 0) continue;
        if (now - servedAtMs > input.ttlMs) continue;
        map.set(postId, Math.max(map.get(postId) ?? 0, servedAtMs));
      }
      for (const postId of nextPostIds) {
        map.set(postId, now);
      }
      const compact = [...map.entries()]
        .map(([postId, servedAtMs]) => ({ postId, servedAtMs }))
        .sort((a, b) => b.servedAtMs - a.servedAtMs)
        .slice(0, Math.max(20, Math.min(input.maxEntries, 500)));
      tx.set(
        docRef,
        {
          viewerId,
          surface,
          entries: compact,
          updatedAtMs: now
        },
        { merge: true }
      );
    });
    incrementDbOps("writes", 1);
    return { ok: true, writes: 1 };
  }

  async readReadyDeck(viewerId: string, surface: string): Promise<SimpleReadyDeckDoc | null> {
    if (!this.db) return null;
    const id = viewerId.trim();
    const s = surface.trim();
    if (!id || !s) return null;
    incrementDbOps("queries", 1);
    const snap = await this.db.collection(READY_DECK_COLLECTION).doc(`${id}_${s}`).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return null;
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    if (Number(raw.deckFormat) !== 2) {
      return null;
    }
    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
    const mode: SimpleFeedSortMode = "docId";
    const items = itemsRaw
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const postId = pickString((value as { postId?: unknown }).postId);
        const sortValue = postId;
        if (!postId) return null;
        const mapped = tryMapSimpleFeedCandidate(mode, postId, value as Record<string, unknown>);
        return "candidate" in mapped ? mapped.candidate : null;
      })
      .filter((row): row is SimpleFeedCandidate => row !== null);
    return {
      viewerId: pickString(raw.viewerId) ?? id,
      surface: pickString(raw.surface) ?? s,
      generation: Math.max(1, Math.floor(num(raw.generation) ?? 1)),
      updatedAtMs: Math.floor(num(raw.updatedAtMs) ?? Date.now()),
      expiresAtMs: Math.floor(num(raw.expiresAtMs) ?? Date.now()),
      refillReason: pickString(raw.refillReason),
      deckFormat: 2,
      items
    };
  }

  async writeReadyDeck(input: SimpleReadyDeckDoc): Promise<void> {
    if (!this.db) return;
    const viewerId = input.viewerId.trim();
    const surface = input.surface.trim();
    if (!viewerId || !surface) return;
    const items = input.items.slice(0, 60).map((item) => ({
      postId: item.postId,
      userId: item.authorId,
      reel: item.reel,
      time: item.createdAtMs,
      createdAtMs: item.createdAtMs,
      updatedAtMs: item.updatedAtMs,
      mediaType: item.mediaType,
      thumbUrl: item.posterUrl,
      displayPhotoLink: item.posterUrl,
      title: item.title,
      caption: item.captionPreview,
      userHandle: item.authorHandle,
      userName: item.authorName,
      userPic: item.authorPic,
      activities: item.activities,
      address: item.address,
      lat: item.geo.lat,
      long: item.geo.long,
      geoData: item.geo,
      assets: item.assets,
      randomKey: typeof item.sortValue === "number" ? item.sortValue : null,
      likeCount: item.likeCount,
      commentCount: item.commentCount,
      ...(item.assetsReady === true ? { assetsReady: true } : {}),
      ...(item.instantPlaybackReady === true ? { instantPlaybackReady: true } : {}),
      ...(item.videoProcessingStatus?.trim()
        ? { videoProcessingStatus: item.videoProcessingStatus.trim() }
        : {})
    }));
    await this.db
      .collection(READY_DECK_COLLECTION)
      .doc(`${viewerId}_${surface}`)
      .set(
        {
          viewerId,
          surface,
          deckFormat: 2,
          generation: input.generation,
          updatedAtMs: input.updatedAtMs,
          expiresAtMs: input.expiresAtMs,
          refillReason: input.refillReason,
          items
        },
        { merge: true }
      );
    incrementDbOps("writes", 1);
  }

  private async hasRandomKeySupport(): Promise<boolean> {
    if (!this.db) return false;
    const now = Date.now();
    if (this.randomKeySupportCache && now - this.randomKeySupportCache.checkedAtMs < 300_000) {
      return this.randomKeySupportCache.available;
    }
    try {
      incrementDbOps("queries", 1);
      const snap = await this.db.collection("posts").orderBy("randomKey", "asc").select("randomKey").limit(1).get();
      incrementDbOps("reads", snap.docs.length);
      const available = snap.docs.length > 0;
      this.randomKeySupportCache = { checkedAtMs: now, available };
      return available;
    } catch {
      this.randomKeySupportCache = { checkedAtMs: now, available: false };
      return false;
    }
  }
}

type SimpleFeedRejectReason = "invisible" | "no_author" | "no_media" | "invalid_contract" | "bad_sort";

function tryMapSimpleFeedCandidate(
  mode: SimpleFeedSortMode,
  postId: string,
  data: Record<string, unknown>
): { candidate: SimpleFeedCandidate } | { reject: SimpleFeedRejectReason } {
  if (!isVisible(data)) return { reject: "invisible" };
  const authorId = pickString(data.userId);
  if (!authorId) return { reject: "no_author" };
  const sourceFirestoreAssetArrayLen = Array.isArray(data.assets) ? data.assets.length : 0;
  const assets = normalizeAssets(data.assets);
  const posterUrl = pickString(
    data.displayPhotoLink,
    data.thumbUrl,
    assets[0]?.posterUrl,
    assets[0]?.previewUrl,
    assets[0]?.originalUrl,
    assets[0]?.mp4Url,
    assets[0]?.streamUrl
  );
  if (!posterUrl) return { reject: "no_media" };
  let sortValue: number | string;
  if (mode === "randomKey") {
    const rk = num(data.randomKey);
    if (rk == null || !Number.isFinite(rk)) return { reject: "bad_sort" };
    sortValue = rk;
  } else {
    sortValue = postId;
  }
  const mediaObj = (data.media as Record<string, unknown> | undefined) ?? undefined;
  const classObj = (data.classification as Record<string, unknown> | undefined) ?? undefined;
  const canonicalMediaAssets = Array.isArray(mediaObj?.assets) ? (mediaObj?.assets as Record<string, unknown>[]) : [];
  const canonicalHasVideo = canonicalMediaAssets.some((asset) => String(asset?.type ?? "").toLowerCase() === "video");
  const canonicalMediaKind = String(classObj?.mediaKind ?? "").toLowerCase();
  const mediaType =
    canonicalHasVideo || canonicalMediaKind === "video" || canonicalMediaKind === "mixed"
      ? "video"
      : String(data.mediaType ?? "").toLowerCase() === "video"
        ? "video"
        : inferFromAssets(assets);
  try {
    const candidate: SimpleFeedCandidate = {
      postId,
      sortValue,
      reel: data.reel === true,
      authorId,
      createdAtMs: readMaybeMillis(data.createdAtMs) ?? readMaybeMillis(data.createdAt) ?? readMaybeMillis(data.time) ?? Date.now(),
      updatedAtMs:
        readMaybeMillis(data.updatedAtMs) ??
        readMaybeMillis(data.lastUpdated) ??
        readMaybeMillis(data.updatedAt) ??
        readMaybeMillis(data.time) ??
        Date.now(),
      mediaType,
      posterUrl,
      firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,
      title: trimPreviewText(pickString(data.title), 80),
      captionPreview: trimPreviewText(pickString(data.caption, data.text, data.description), 160),
      authorHandle: pickString(data.userHandle) ?? `user_${authorId.slice(0, 8)}`,
      authorName: trimPreviewText(pickString(data.userName), 48),
      authorPic: pickString(data.userPic),
      activities: Array.isArray(data.activities) ? data.activities.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 4) : [],
      address: trimPreviewText(pickString(data.address), 72),
      geo: {
        lat: num(data.lat, data.latitude),
        long: num(data.long, data.lng, data.longitude),
        city: pickString((data.geoData as Record<string, unknown> | undefined)?.city),
        state: pickString((data.geoData as Record<string, unknown> | undefined)?.state),
        country: pickString((data.geoData as Record<string, unknown> | undefined)?.country),
        geohash: pickString((data.geoData as Record<string, unknown> | undefined)?.geohash)
      },
      assets,
      carouselFitWidth: typeof data.carouselFitWidth === "boolean" ? data.carouselFitWidth : undefined,
      layoutLetterbox: typeof data.layoutLetterbox === "boolean" ? data.layoutLetterbox : undefined,
      ...normalizeLetterboxHints(data),
      likeCount: Math.max(0, Math.floor(num(data.likesCount, data.likeCount) ?? 0)),
      commentCount: Math.max(0, Math.floor(num(data.commentCount, data.commentsCount) ?? 0)),
      sourceFirestoreAssetArrayLen,
      assetsReady: data.assetsReady === true ? true : undefined,
      instantPlaybackReady: data.instantPlaybackReady === true ? true : undefined,
      videoProcessingStatus: pickString(data.videoProcessingStatus),
      rawFirestore: { ...data, id: postId, postId }
    };
    return { candidate };
  } catch {
    return { reject: "invalid_contract" };
  }
}

function isVisible(data: Record<string, unknown>): boolean {
  if (data.deleted === true || data.isDeleted === true || data.archived === true || data.hidden === true) return false;
  const privacy = String(data.privacy ?? data.visibility ?? "public").toLowerCase();
  if (privacy === "private" || privacy === "followers") return false;
  const status = String(data.status ?? "active").toLowerCase();
  return status !== "deleted" && status !== "archived";
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function num(...values: unknown[]): number | null {
  for (const value of values) {
    const candidate = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function normalizeLetterboxHints(data: Record<string, unknown>): {
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
} {
  const legacy = (data as { legacy?: unknown }).legacy as
    | {
        letterboxGradientTop?: unknown;
        letterboxGradientBottom?: unknown;
        letterboxGradients?: unknown;
        letterbox_gradient_top?: unknown;
        letterbox_gradient_bottom?: unknown;
      }
    | undefined;
  const topRaw =
    typeof data.letterboxGradientTop === "string"
      ? data.letterboxGradientTop
      : typeof data.letterbox_gradient_top === "string"
        ? data.letterbox_gradient_top
        : typeof legacy?.letterboxGradientTop === "string"
          ? legacy.letterboxGradientTop
          : typeof legacy?.letterbox_gradient_top === "string"
            ? legacy.letterbox_gradient_top
            : null;
  const bottomRaw =
    typeof data.letterboxGradientBottom === "string"
      ? data.letterboxGradientBottom
      : typeof data.letterbox_gradient_bottom === "string"
        ? data.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? legacy.letterboxGradientBottom
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? legacy.letterbox_gradient_bottom
            : null;
  const top = topRaw?.trim() ? topRaw.trim() : null;
  const bottom = bottomRaw?.trim() ? bottomRaw.trim() : null;
  const out: {
    letterboxGradientTop?: string | null;
    letterboxGradientBottom?: string | null;
    letterboxGradients?: Array<{ top: string; bottom: string }>;
  } = {};
  if (top !== null) out.letterboxGradientTop = top;
  if (bottom !== null) out.letterboxGradientBottom = bottom;
  const gradientsRaw = Array.isArray(data.letterboxGradients)
    ? data.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? legacy.letterboxGradients
      : null;
  if (Array.isArray(gradientsRaw)) {
    const gradients = gradientsRaw
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const topValue = typeof (value as { top?: unknown }).top === "string" ? (value as { top: string }).top.trim() : "";
        const bottomValue =
          typeof (value as { bottom?: unknown }).bottom === "string" ? (value as { bottom: string }).bottom.trim() : "";
        if (!topValue || !bottomValue) return null;
        return { top: topValue, bottom: bottomValue };
      })
      .filter((value): value is { top: string; bottom: string } => value !== null);
    if (gradients.length > 0) out.letterboxGradients = gradients;
  }
  return out;
}

function collectHttpVariantStrings(variants: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(variants)) {
    if (typeof val !== "string") continue;
    const t = val.trim();
    if (/^https?:\/\//i.test(t)) out[key] = t;
  }
  return out;
}

function normalizeAssets(value: unknown): SimpleFeedCandidate["assets"] {
  if (!Array.isArray(value)) return [];
  const out: SimpleFeedCandidate["assets"] = [];
  for (let i = 0; i < value.length && out.length < FEED_READ_NORMALIZED_ASSET_MAX; i += 1) {
    const raw = value[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") continue;
    const variants = (raw.variants as Record<string, unknown> | undefined) ?? {};
    const playbackVariantUrls: Record<string, string> = { ...collectHttpVariantStrings(variants) };
    const persistedMap = raw.playbackVariantUrls;
    if (persistedMap && typeof persistedMap === "object") {
      for (const [key, val] of Object.entries(persistedMap as Record<string, unknown>)) {
        if (typeof val !== "string") continue;
        const t = val.trim();
        if (/^https?:\/\//i.test(t)) playbackVariantUrls[key] = t;
      }
    }
    const sm = (variants.sm as Record<string, unknown> | undefined) ?? {};
    const md = (variants.md as Record<string, unknown> | undefined) ?? {};
    const lg = (variants.lg as Record<string, unknown> | undefined) ?? {};
    const thumb = (variants.thumb as Record<string, unknown> | undefined) ?? {};
    /** Deck persistence stores compact URLs on the asset (`streamUrl` / `mp4Url`) — re-read paths must keep them when `variants.*` is absent. */
    const streamUrl = pickString(raw.streamUrl, typeof variants.hls === "string" ? variants.hls : null);
    const mp4Url = pickString(
      variants.main1080Avc,
      variants.main1080,
      variants.main720Avc,
      variants.main720,
      variants.startup1080FaststartAvc,
      variants.startup1080Faststart,
      variants.startup720FaststartAvc,
      variants.startup720Faststart,
      variants.startup540FaststartAvc,
      variants.startup540Faststart,
      raw.mp4Url,
      raw.original,
      raw.downloadURL,
      raw.url
    );
    if (streamUrl && !playbackVariantUrls.hls) playbackVariantUrls.hls = streamUrl;
    out.push({
      id: pickString(raw.id) ?? `asset-${i + 1}`,
      type: String(raw.type ?? "").toLowerCase() === "video" ? "video" : "image",
      previewUrl: pickString(
        raw.previewUrl,
        variants.preview360,
        variants.preview360Avc,
        sm.webp,
        md.webp,
        lg.webp,
        raw.thumbnail,
        raw.original,
        raw.downloadURL,
        raw.url
      ),
      posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail, raw.original, raw.downloadURL, raw.url),
      originalUrl: pickString(raw.original, raw.downloadURL, raw.url),
      streamUrl,
      mp4Url,
      blurhash: pickString(raw.blurhash),
      width: num(raw.width),
      height: num(raw.height),
      aspectRatio: num(raw.aspectRatio),
      orientation: pickString(raw.orientation),
      ...(Object.keys(playbackVariantUrls).length > 0 ? { playbackVariantUrls } : {})
    });
  }
  return out;
}

function trimPreviewText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function inferFromAssets(assets: SimpleFeedCandidate["assets"]): "image" | "video" {
  if (assets.some((asset) => asset.type === "video")) return "video";
  return "image";
}
