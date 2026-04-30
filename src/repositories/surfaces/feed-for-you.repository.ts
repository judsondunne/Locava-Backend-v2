import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { readMaybeMillis } from "../source-of-truth/post-firestore-projection.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

export type ForYouSourceBucket = "reel" | "regular";

export type FeedForYouMode = "reels" | "mixed" | "regular";

export type FeedForYouState = {
  viewerId: string;
  surface: "home_for_you";
  reelQueue: string[];
  reelQueueGeneratedAtMs: number | null;
  reelQueueSourceVersion: string;
  reelQueueCount: number;
  reelQueueIndex: number;
  regularQueue: string[];
  regularQueueGeneratedAtMs: number | null;
  regularQueueSourceVersion: string;
  regularQueueCount: number;
  regularQueueIndex: number;
  randomSeed: string;
  updatedAtMs: number | null;
  createdAtMs: number | null;
};

export type ForYouCandidate = {
  postId: string;
  authorId: string;
  reel: boolean;
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
  }>;
  comments: Array<Record<string, unknown>>;
  commentsPreview: Array<Record<string, unknown>>;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  likeCount: number;
  commentCount: number;
};

export type ForYouServedWriteRecord = {
  postId: string;
  servedAt: number;
  feedSurface: "home_for_you";
  feedRequestId: string;
  rank: number;
  sourceBucket: ForYouSourceBucket;
  authorId: string;
  reel: boolean;
};

const FEED_SELECT_FIELDS = [
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
  "commentsCount",
  "commentCount",
  "comments",
  "deleted",
  "isDeleted",
  "archived",
  "hidden",
  "privacy",
  "visibility",
  "status"
] as const;

export class FeedForYouRepository {
  private readonly db = getFirestoreSourceClient();

  isEnabled(): boolean {
    return this.db !== null;
  }

  async getFeedState(viewerId: string): Promise<FeedForYouState | null> {
    if (!this.db || !viewerId) return null;
    const ref = this.getFeedStateRef(viewerId);
    const snap = await ref.get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return null;
    return normalizeFeedState(snap.data() as Record<string, unknown>);
  }

  async saveFeedState(viewerId: string, state: FeedForYouState): Promise<void> {
    if (!this.db || !viewerId) return;
    incrementDbOps("writes", 1);
    await this.getFeedStateRef(viewerId).set(
      {
        viewerId: state.viewerId,
        surface: state.surface,
        reelQueue: state.reelQueue.slice(0, 500),
        reelQueueGeneratedAt:
          state.reelQueueGeneratedAtMs == null ? FieldValue.serverTimestamp() : Timestamp.fromMillis(state.reelQueueGeneratedAtMs),
        reelQueueSourceVersion: state.reelQueueSourceVersion,
        reelQueueCount: state.reelQueueCount,
        reelQueueIndex: state.reelQueueIndex,
        regularQueue: state.regularQueue.slice(0, 1000),
        regularQueueGeneratedAt:
          state.regularQueueGeneratedAtMs == null
            ? FieldValue.serverTimestamp()
            : Timestamp.fromMillis(state.regularQueueGeneratedAtMs),
        regularQueueSourceVersion: state.regularQueueSourceVersion,
        regularQueueCount: state.regularQueueCount,
        regularQueueIndex: state.regularQueueIndex,
        randomSeed: state.randomSeed,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: state.createdAtMs == null ? FieldValue.serverTimestamp() : Timestamp.fromMillis(state.createdAtMs)
      },
      { merge: true }
    );
  }

  async fetchEligibleReelIds(limit: number): Promise<string[]> {
    const rows = await this.fetchWindow({
      limit,
      reelOnly: true,
      postIds: null
    });
    return rows.filter((row) => row.reel === true).map((row) => row.postId);
  }

  async fetchPostsByIds(postIds: string[]): Promise<ForYouCandidate[]> {
    return this.fetchWindow({
      limit: postIds.length,
      reelOnly: false,
      postIds
    });
  }

  async fetchEligibleRegularIds(limit: number): Promise<string[]> {
    const scanLimit = Math.min(1200, Math.max(limit + 200, limit));
    const rows = await this.fetchWindow({
      limit: scanLimit,
      reelOnly: false,
      postIds: null
    });
    return rows
      .filter((row) => row.reel !== true)
      .slice(0, Math.max(1, Math.min(limit, 1000)))
      .map((row) => row.postId);
  }

  async fetchRecentWindow(limit: number): Promise<ForYouCandidate[]> {
    return this.fetchWindow({
      limit,
      reelOnly: false,
      postIds: null
    });
  }

  async writeServedPosts(viewerId: string, servedRecords: ForYouServedWriteRecord[]): Promise<number> {
    if (!this.db || !viewerId || servedRecords.length === 0) return 0;
    const unique = new Map<string, ForYouServedWriteRecord>();
    for (const row of servedRecords) unique.set(row.postId, row);
    const batch = this.db.batch();
    for (const row of unique.values()) {
      batch.set(this.getServedRef(viewerId, row.postId), row, { merge: true });
    }
    await batch.commit();
    incrementDbOps("writes", unique.size);
    return unique.size;
  }

  private getFeedStateRef(viewerId: string) {
    return this.db!.collection("users").doc(viewerId).collection("feedState").doc("home_for_you");
  }

  private getServedRef(viewerId: string, postId: string) {
    return this.db!.collection("users").doc(viewerId).collection("feedServed").doc(postId);
  }

  private async fetchWindow(input: {
    limit: number;
    reelOnly: boolean;
    postIds: string[] | null;
  }): Promise<ForYouCandidate[]> {
    if (!this.db) throw new Error("feed_for_you_source_unavailable");
    const boundedLimit = Math.max(1, Math.min(input.limit, 500));
    if (input.postIds) {
      const ids = [...new Set(input.postIds.map((id) => id.trim()).filter(Boolean))].slice(0, boundedLimit);
      if (ids.length === 0) return [];
      const snaps = await this.db.getAll(...ids.map((id) => this.db!.collection("posts").doc(id)));
      incrementDbOps("reads", snaps.length);
      return snaps
        .map((snap) => (snap.exists ? mapDoc(snap.id, snap.data() as Record<string, unknown>) : null))
        .filter((row): row is ForYouCandidate => row !== null);
    }

    let query = this.db
      .collection("posts")
      .orderBy("time", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select(...FEED_SELECT_FIELDS);
    if (input.reelOnly) query = query.where("reel", "==", true);
    incrementDbOps("queries", 1);
    const snap = await query.limit(boundedLimit).get();
    incrementDbOps("reads", snap.docs.length);
    return snap.docs
      .map((doc) => mapDoc(doc.id, doc.data() as Record<string, unknown>))
      .filter((row): row is ForYouCandidate => row !== null);
  }
}

function normalizeFeedState(data: Record<string, unknown>): FeedForYouState | null {
  const viewerId = pickString(data.viewerId);
  const surface = pickString(data.surface);
  const reelQueue = Array.isArray(data.reelQueue)
    ? data.reelQueue.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 500)
    : null;
  const reelQueueIndexRaw = Number(data.reelQueueIndex);
  const reelQueueCountRaw = Number(data.reelQueueCount);
  const regularQueue = Array.isArray(data.regularQueue)
    ? data.regularQueue.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 1000)
    : [];
  const regularQueueIndexRaw = Number(data.regularQueueIndex);
  const regularQueueCountRaw = Number(data.regularQueueCount);
  if (!viewerId || surface !== "home_for_you" || !reelQueue) return null;
  if (!Number.isFinite(reelQueueIndexRaw) || reelQueueIndexRaw < 0) return null;
  const reelQueueCount = Number.isFinite(reelQueueCountRaw) && reelQueueCountRaw >= 0 ? Math.floor(reelQueueCountRaw) : reelQueue.length;
  const reelQueueIndex = Math.min(Math.floor(reelQueueIndexRaw), reelQueue.length);
  const regularQueueCount =
    Number.isFinite(regularQueueCountRaw) && regularQueueCountRaw >= 0 ? Math.floor(regularQueueCountRaw) : regularQueue.length;
  const regularQueueIndex =
    Number.isFinite(regularQueueIndexRaw) && regularQueueIndexRaw >= 0
      ? Math.min(Math.floor(regularQueueIndexRaw), regularQueue.length)
      : 0;
  return {
    viewerId,
    surface: "home_for_you",
    reelQueue,
    reelQueueGeneratedAtMs: readMaybeMillis(data.reelQueueGeneratedAt) ?? null,
    reelQueueSourceVersion: pickString(data.reelQueueSourceVersion) ?? "",
    reelQueueCount: Math.min(reelQueueCount, reelQueue.length),
    reelQueueIndex,
    regularQueue,
    regularQueueGeneratedAtMs: readMaybeMillis(data.regularQueueGeneratedAt) ?? null,
    regularQueueSourceVersion: pickString(data.regularQueueSourceVersion) ?? "",
    regularQueueCount: Math.min(regularQueueCount, regularQueue.length),
    regularQueueIndex,
    randomSeed: pickString(data.randomSeed) ?? "",
    updatedAtMs: readMaybeMillis(data.updatedAt) ?? null,
    createdAtMs: readMaybeMillis(data.createdAt) ?? null
  };
}

function mapDoc(postId: string, data: Record<string, unknown>): ForYouCandidate | null {
  if (!isVisible(data)) return null;
  const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";
  if (!posterUrl) return null;
  const authorId = String(data.userId ?? "").trim();
  if (!authorId) return null;
  const assets = normalizeAssets(data.assets);
  const embeddedComments = normalizeEmbeddedComments(data.comments);
  const mediaType = String(data.mediaType ?? "").toLowerCase() === "video" ? "video" : inferFromAssets(assets);
  return {
    postId,
    authorId,
    reel: data.reel === true,
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
    title: pickString(data.title),
    captionPreview: pickString(data.caption, data.text, data.description),
    authorHandle: pickString(data.userHandle) ?? `user_${authorId.slice(0, 8)}`,
    authorName: pickString(data.userName),
    authorPic: pickString(data.userPic),
    activities: Array.isArray(data.activities) ? data.activities.map((v) => String(v ?? "").trim()).filter(Boolean) : [],
    address: pickString(data.address),
    geo: {
      lat: num(data.lat, data.latitude),
      long: num(data.long, data.lng, data.longitude),
      city: pickString((data.geoData as Record<string, unknown> | undefined)?.city),
      state: pickString((data.geoData as Record<string, unknown> | undefined)?.state),
      country: pickString((data.geoData as Record<string, unknown> | undefined)?.country),
      geohash: pickString((data.geoData as Record<string, unknown> | undefined)?.geohash)
    },
    assets,
    comments: embeddedComments,
    commentsPreview: embeddedComments,
    carouselFitWidth: typeof data.carouselFitWidth === "boolean" ? data.carouselFitWidth : undefined,
    layoutLetterbox: typeof data.layoutLetterbox === "boolean" ? data.layoutLetterbox : undefined,
    ...normalizeLetterboxHints(data),
    likeCount: Math.max(0, Math.floor(num(data.likesCount, data.likeCount) ?? 0)),
    commentCount: Math.max(0, Math.floor(num(data.commentsCount, data.commentCount) ?? embeddedComments.length))
  };
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
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return n;
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

function normalizeAssets(value: unknown): ForYouCandidate["assets"] {
  if (!Array.isArray(value)) return [];
  const out: ForYouCandidate["assets"] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") continue;
    const variants = (raw.variants as Record<string, unknown> | undefined) ?? {};
    const sm = (variants.sm as Record<string, unknown> | undefined) ?? {};
    const md = (variants.md as Record<string, unknown> | undefined) ?? {};
    const lg = (variants.lg as Record<string, unknown> | undefined) ?? {};
    const thumb = (variants.thumb as Record<string, unknown> | undefined) ?? {};
    out.push({
      id: pickString(raw.id) ?? `asset-${i + 1}`,
      type: String(raw.type ?? "").toLowerCase() === "video" ? "video" : "image",
      previewUrl: pickString(raw.previewUrl, variants.preview360, variants.preview360Avc, sm.webp, md.webp, lg.webp, raw.thumbnail),
      posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail),
      originalUrl: pickString(raw.original, raw.downloadURL, raw.url),
      streamUrl: pickString(variants.hls),
      mp4Url: pickString(variants.main720Avc, variants.main720, raw.original, raw.downloadURL, raw.url),
      blurhash: pickString(raw.blurhash),
      width: num(raw.width),
      height: num(raw.height),
      aspectRatio: num(raw.aspectRatio),
      orientation: pickString(raw.orientation)
    });
  }
  return out;
}

function normalizeEmbeddedComments(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    const idRaw = c.id ?? c.commentId;
    const id = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : null;
    if (!id) continue;
    const text = getCommentText(c);
    const userName = typeof c.userName === "string" ? c.userName : null;
    const userHandle = typeof c.userHandle === "string" ? c.userHandle : null;
    const userPic = typeof c.userPic === "string" ? c.userPic : null;
    const userId = typeof c.userId === "string" ? c.userId : "";
    const likedBy = Array.isArray(c.likedBy) ? c.likedBy.filter((v): v is string => typeof v === "string") : [];
    const replies = Array.isArray(c.replies) ? c.replies : [];
    out.push({
      id,
      commentId: id,
      content: text,
      text,
      userId,
      userName,
      userHandle,
      userPic,
      time: c.time ?? null,
      createdAt: c.createdAt ?? c.time ?? null,
      createdAtMs: readMaybeMillis(c.createdAtMs) ?? readMaybeMillis(c.createdAt) ?? readMaybeMillis(c.time) ?? Date.now(),
      likedBy,
      replies
    });
  }
  return out;
}

function getCommentText(comment: Record<string, unknown>): string {
  const candidates = [comment.content, comment.text, comment.body, comment.comment, comment.message, comment.caption];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function inferFromAssets(assets: ForYouCandidate["assets"]): "image" | "video" {
  if (assets.some((asset) => asset.type === "video")) return "video";
  return "image";
}
