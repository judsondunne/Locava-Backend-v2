import { FieldPath } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { readMaybeMillis } from "../source-of-truth/post-firestore-projection.js";

export type SimpleFeedSortMode = "randomKey" | "docId";

export type SimpleFeedCandidate = {
  postId: string;
  sortValue: number | string;
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
  }>;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  likeCount: number;
  commentCount: number;
};

const SIMPLE_FEED_SELECT_FIELDS = [
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
    limit: number;
  }): Promise<{ items: SimpleFeedCandidate[]; rawCount: number; segmentExhausted: boolean }> {
    if (!this.db) throw new Error("feed_for_you_simple_source_unavailable");
    const boundedLimit = Math.max(1, Math.min(input.limit, 40));
    let query = this.db.collection("posts").select(...SIMPLE_FEED_SELECT_FIELDS);

    if (input.mode === "randomKey") {
      const anchor = typeof input.anchor === "number" ? input.anchor : Number(input.anchor);
      if (!Number.isFinite(anchor)) throw new Error("invalid_simple_feed_anchor");
      query = query.orderBy("randomKey", "asc");
      if (input.wrapped) {
        query = query.where("randomKey", "<", anchor);
      } else {
        query = query.where("randomKey", ">=", anchor);
      }
      if (typeof input.lastValue === "number" && Number.isFinite(input.lastValue)) {
        query = query.startAfter(input.lastValue);
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
    return {
      items: snap.docs
        .map((doc) => mapDoc(input.mode, doc.id, doc.data() as Record<string, unknown>))
        .filter((row): row is SimpleFeedCandidate => row !== null),
      rawCount: snap.docs.length,
      segmentExhausted: snap.docs.length < boundedLimit
    };
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

function mapDoc(mode: SimpleFeedSortMode, postId: string, data: Record<string, unknown>): SimpleFeedCandidate | null {
  if (!isVisible(data)) return null;
  const authorId = pickString(data.userId);
  if (!authorId) return null;
  const assets = normalizeAssets(data.assets);
  const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl, assets[0]?.posterUrl, assets[0]?.previewUrl);
  if (!posterUrl) return null;
  if (assets.length === 0 && !posterUrl) return null;
  const sortValue =
    mode === "randomKey"
      ? num(data.randomKey)
      : postId;
  if (sortValue == null) return null;
  const mediaType = String(data.mediaType ?? "").toLowerCase() === "video" ? "video" : inferFromAssets(assets);
  return {
    postId,
    sortValue,
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
    commentCount: Math.max(0, Math.floor(num(data.commentCount, data.commentsCount) ?? 0))
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

function normalizeAssets(value: unknown): SimpleFeedCandidate["assets"] {
  if (!Array.isArray(value)) return [];
  const out: SimpleFeedCandidate["assets"] = [];
  for (let i = 0; i < value.length && out.length < 1; i += 1) {
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
