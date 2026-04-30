import { FieldPath, type Query } from "firebase-admin/firestore";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { readMaybeMillis } from "../source-of-truth/post-firestore-projection.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

export type ForYouSourceBucket = "reel" | "regular" | "fallback";

export type ForYouCursorState = {
  page: number;
  reelOffset: number;
  regularOffset: number;
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

  async fetchUnservedReelCandidates(
    _viewerId: string,
    limit: number,
    cursorState: ForYouCursorState
  ): Promise<{ candidates: ForYouCandidate[]; reads: number; queries: number; hasMore: boolean }> {
    return this.fetchCandidateWindow("reel", limit, cursorState.reelOffset);
  }

  async fetchUnservedRegularCandidates(
    _viewerId: string,
    limit: number,
    cursorState: ForYouCursorState
  ): Promise<{ candidates: ForYouCandidate[]; reads: number; queries: number; hasMore: boolean }> {
    return this.fetchCandidateWindow("regular", limit, cursorState.regularOffset);
  }

  async fetchServedPostIds(viewerId: string, candidatePostIds: string[]): Promise<Set<string>> {
    if (!this.db || !viewerId || viewerId === "anonymous") return new Set();
    const ids = [...new Set(candidatePostIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return new Set();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const out = new Set<string>();
    for (const chunk of chunks) {
      incrementDbOps("queries", 1);
      const snaps = await this.db.getAll(...chunk.map((postId) => this.getServedRef(viewerId, postId)));
      incrementDbOps("reads", snaps.length);
      for (const snap of snaps) {
        if (snap.exists) out.add(snap.id);
      }
    }
    return out;
  }

  async writeServedPosts(viewerId: string, servedRecords: ForYouServedWriteRecord[]): Promise<number> {
    if (!this.db || !viewerId || viewerId === "anonymous" || servedRecords.length === 0) return 0;
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

  private getServedRef(viewerId: string, postId: string) {
    return this.db!.collection("users").doc(viewerId).collection("feedServed").doc(postId);
  }

  private async fetchCandidateWindow(
    bucket: "reel" | "regular",
    limit: number,
    offset: number
  ): Promise<{ candidates: ForYouCandidate[]; reads: number; queries: number; hasMore: boolean }> {
    if (!this.db) throw new Error("feed_for_you_source_unavailable");
    const oversample = Math.max(limit * 4, 24);
    const cacheKey = `feed:for-you:candidates:${bucket}:${offset}:${limit}:v1`;
    const cached = await globalCache.get<{ candidates: ForYouCandidate[]; reads: number; queries: number; hasMore: boolean }>(cacheKey);
    if (cached) return cached;

    const queryBase = this.db.collection("posts").orderBy("time", "desc").select(...FEED_SELECT_FIELDS);
    const query: Query = bucket === "reel" ? queryBase.where("reel", "==", true) : queryBase;
    const snap = await query.offset(offset).limit(oversample).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    let candidates = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>)).filter(Boolean) as ForYouCandidate[];
    if (bucket === "regular") {
      candidates = candidates.filter((item) => !item.reel);
    }
    const payload = { candidates, reads: snap.docs.length, queries: 1, hasMore: snap.docs.length >= oversample };
    void globalCache.set(cacheKey, payload, 6_000);
    return payload;
  }
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
    commentCount: Math.max(
      0,
      Math.floor(
        num(data.commentsCount, data.commentCount) ??
          embeddedComments.length
      )
    )
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
        const top = typeof (value as { top?: unknown }).top === "string" ? (value as { top: string }).top.trim() : "";
        const bottom = typeof (value as { bottom?: unknown }).bottom === "string" ? (value as { bottom: string }).bottom.trim() : "";
        if (!top || !bottom) return null;
        return { top, bottom };
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
      previewUrl: pickString(sm.webp, md.webp, lg.webp, raw.thumbnail),
      posterUrl: pickString(raw.poster, thumb.webp, raw.thumbnail),
      originalUrl: pickString(raw.original, raw.downloadURL, raw.url),
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
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const c = entry as Record<string, unknown>;
      const idRaw = c.id ?? c.commentId;
      const id = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : null;
      if (!id) return null;
      const text = getCommentText(c);
      const userName = typeof c.userName === "string" ? c.userName : null;
      const userHandle = typeof c.userHandle === "string" ? c.userHandle : null;
      const userPic = typeof c.userPic === "string" ? c.userPic : null;
      const userId = typeof c.userId === "string" ? c.userId : "";
      const likedBy = Array.isArray(c.likedBy)
        ? c.likedBy.filter((v): v is string => typeof v === "string")
        : [];
      const replies = Array.isArray(c.replies) ? c.replies : [];
      return {
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
        createdAtMs:
          readMaybeMillis(c.createdAtMs) ??
          readMaybeMillis(c.createdAt) ??
          readMaybeMillis(c.time) ??
          Date.now(),
        likedBy,
        replies,
      };
    })
    .filter((row): row is Record<string, unknown> => row !== null);
}

function getCommentText(comment: Record<string, unknown>): string {
  const candidates = [
    comment.content,
    comment.text,
    comment.body,
    comment.comment,
    comment.message,
    comment.caption,
  ];
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
