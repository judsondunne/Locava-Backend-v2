import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "./firestore-client.js";
import {
  inferPostMediaType,
  readMaybeMillis,
  readPostThumbUrl
} from "./post-firestore-projection.js";
import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";
import { buildSafeDisplayTextBlock } from "../../lib/posts/displayText.js";

export type FirestoreProfilePostDetail = {
  postId: string;
  userId: string;
  caption?: string;
  title?: string | null;
  description?: string | null;
  activities?: string[];
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  geoData?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    geohash?: string | null;
  };
  coordinates?: {
    lat?: number | null;
    lng?: number | null;
  };
  tags?: string[];
  createdAtMs: number;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string;
  letterboxGradientBottom?: string;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  mediaType: "image" | "video";
  thumbUrl: string;
  assetsReady?: boolean;
  playbackLab?: Record<string, unknown>;
  assetLocations?: Array<{ lat?: number | null; long?: number | null }>;
  assets: Array<{
    id: string;
    type: "image" | "video";
    original?: string;
    poster?: string;
    thumbnail?: string;
    aspectRatio?: number | null;
    durationSec?: number | null;
    width?: number | null;
    height?: number | null;
    orientation?: string | null;
    hasAudio?: boolean;
    codecs?: Record<string, unknown>;
    variantMetadata?: Record<string, unknown>;
    instantPlaybackReady?: boolean;
    playbackLab?: Record<string, unknown>;
    generated?: Record<string, unknown>;
    variants?: Record<string, unknown>;
  }>;
  author: {
    userId: string;
    handle: string;
    name: string;
    profilePic: string;
  };
  social: {
    likeCount: number;
    commentCount: number;
    viewerHasLiked: boolean;
  };
  /** Firestore doc-shaped snapshot for AppPostV2 conversion. */
  sourceRawPost?: Record<string, unknown>;
};

export class ProfilePostDetailFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly FIRESTORE_TIMEOUT_MS = 400;
  private disabledUntilMs = 0;

  isEnabled(): boolean {
    if (!this.db) return false;
    return Date.now() >= this.disabledUntilMs;
  }

  markUnavailableBriefly(): void {
    this.disabledUntilMs = Date.now() + 5_000;
  }

  async getPostDetail(input: { userId: string; postId: string; viewerId: string }): Promise<{ data: FirestoreProfilePostDetail; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const { userId, postId, viewerId } = input;
    const [postDoc, userDoc, likedDoc] = await withTimeout(
      Promise.all([
        this.db.collection("posts").doc(postId).get(),
        this.db.collection("users").doc(userId).get(),
        this.db.collection("posts").doc(postId).collection("likes").doc(viewerId).get()
      ]),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-firestore"
    );
    return {
      data: mapProfilePostDetail({
        postDoc,
        userId,
        viewerId,
        userDoc,
        likedDoc
      }),
      queryCount: 3,
      readCount: 3
    };
  }

  async getPostDetailByPostId(input: {
    postId: string;
    viewerId: string;
  }): Promise<{ data: FirestoreProfilePostDetail; queryCount: number; readCount: number } | null> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const postDoc = await withTimeout(
      this.db.collection("posts").doc(input.postId).get(),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-by-id-firestore"
    );
    if (!postDoc.exists) return null;
    const raw = postDoc.data() as Record<string, unknown>;
    const userId =
      typeof raw.userId === "string" && raw.userId.trim().length > 0
        ? raw.userId.trim()
        : null;
    if (!userId) return null;
    const [userDoc, likedDoc] = await withTimeout(
      Promise.all([
        this.db.collection("users").doc(userId).get(),
        this.db.collection("posts").doc(input.postId).collection("likes").doc(input.viewerId).get()
      ]),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-by-id-hydration"
    );
    return {
      data: mapProfilePostDetail({
        postDoc,
        userId,
        viewerId: input.viewerId,
        userDoc,
        likedDoc
      }),
      queryCount: 3,
      readCount: 3
    };
  }
}

function mapProfilePostDetail(input: {
  postDoc: DocumentSnapshot;
  userId: string;
  viewerId: string;
  userDoc: DocumentSnapshot;
  likedDoc: DocumentSnapshot;
}): FirestoreProfilePostDetail {
  if (!input.postDoc.exists) throw new Error("post_not_found_for_profile");
  const raw = input.postDoc.data() as Record<string, unknown>;
  const postData = raw as {
    userId?: string;
    caption?: string;
    content?: string;
    title?: string;
    createdAtMs?: number;
    mediaType?: "image" | "video";
    thumbUrl?: string;
    assets?: FirestoreProfilePostDetail["assets"];
    likeCount?: number;
    likesCount?: number;
    commentCount?: number;
    commentsCount?: number;
    comments?: unknown[];
    likes?: unknown;
    carouselFitWidth?: unknown;
    layoutLetterbox?: unknown;
    letterboxGradientTop?: unknown;
    letterboxGradientBottom?: unknown;
    letterbox_gradient_top?: unknown;
    letterbox_gradient_bottom?: unknown;
    letterboxGradients?: unknown;
  };
  if (postData.userId !== input.userId) {
    throw new Error("post_not_found_for_profile");
  }
  const userData = (input.userDoc.data() ?? {}) as {
    handle?: string;
    name?: string;
    displayName?: string;
    profilePic?: string;
    profilePicture?: string;
    photo?: string;
  };
  const safe = buildSafeDisplayTextBlock(raw);
  const caption =
    safe.caption || safe.description || safe.content || normalizeNullable(postData.title) || undefined;
  const title = normalizeNullable(safe.title) ?? normalizeNullable(postData.title);
  const description =
    normalizeNullable(safe.description) ?? normalizeNullable(safe.caption) ?? normalizeNullable(safe.content);
  const mediaType = inferPostMediaType(raw);
  const likeCount = normalizeCounter(postData.likeCount ?? postData.likesCount);
  const likesArr = Array.isArray(postData.likes) ? postData.likes : [];
  const likedViaArray = likesArr.some(
    (value) => value === input.viewerId || (typeof value === "object" && value && "userId" in value && (value as { userId?: string }).userId === input.viewerId)
  );

  const { letterboxGradientTop, letterboxGradientBottom, letterboxGradients } = normalizeLetterboxHints(postData);
  const location = normalizeLocation(raw);
  const geoData = normalizeGeoData(raw);
  return {
    postId: input.postDoc.id,
    userId: input.userId,
    caption,
    title,
    description,
    activities: normalizeStringArray(raw.activities),
    address: location.address,
    lat: location.lat,
    lng: location.lng,
    ...(geoData ? { geoData } : {}),
    coordinates: {
      lat: location.lat,
      lng: location.lng,
    },
    tags: normalizeStringArray(raw.tags),
    createdAtMs: normalizePostCreatedMs(raw),
    carouselFitWidth: typeof postData.carouselFitWidth === "boolean" ? postData.carouselFitWidth : undefined,
    layoutLetterbox: typeof postData.layoutLetterbox === "boolean" ? postData.layoutLetterbox : undefined,
    ...(typeof letterboxGradientTop === "string" ? { letterboxGradientTop } : {}),
    ...(typeof letterboxGradientBottom === "string" ? { letterboxGradientBottom } : {}),
    ...(letterboxGradients ? { letterboxGradients } : {}),
    mediaType,
    thumbUrl: readPostThumbUrl(raw, input.postDoc.id),
    assetsReady: typeof (raw as { assetsReady?: unknown }).assetsReady === "boolean" ? ((raw as { assetsReady: boolean }).assetsReady) : undefined,
    playbackLab: asRecord((raw as { playbackLab?: unknown }).playbackLab) ?? undefined,
    assetLocations: normalizeAssetLocations((raw as { assetLocations?: unknown }).assetLocations),
    assets: normalizeAssets(raw, input.postDoc.id, mediaType),
    author: {
      userId: input.userId,
      handle: String(userData.handle ?? "").replace(/^@+/, "") || `user_${input.userId.slice(0, 8)}`,
      name: String(userData.name ?? userData.displayName ?? "").trim() || `User ${input.userId.slice(0, 8)}`,
      profilePic: pickPic(userData)
    },
    social: {
      likeCount,
      commentCount: resolveCommentCount(postData),
      viewerHasLiked: (input.likedDoc.exists || likedViaArray) && input.viewerId.length > 0
    },
    sourceRawPost: { ...raw, id: input.postDoc.id, postId: input.postDoc.id }
  };
}

function resolveCommentCount(post: {
  commentsCount?: number;
  commentCount?: number;
  comments?: unknown[];
}): number {
  const explicit = normalizeCounter(post.commentsCount ?? post.commentCount);
  if (explicit > 0) return explicit;
  if (!Array.isArray(post.comments)) return 0;
  return post.comments.filter((entry) => isTopLevelEmbeddedComment(entry)).length;
}

function isTopLevelEmbeddedComment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const wire = value as { id?: unknown; commentId?: unknown; replyingTo?: unknown };
  const commentIdRaw = wire.id ?? wire.commentId;
  const commentId = typeof commentIdRaw === "string" ? commentIdRaw.trim() : "";
  if (!commentId) return false;
  return wire.replyingTo == null;
}

function normalizeLetterboxHints(data: {
  letterboxGradientTop?: unknown;
  letterboxGradientBottom?: unknown;
  letterbox_gradient_top?: unknown;
  letterbox_gradient_bottom?: unknown;
  letterboxGradients?: unknown;
  legacy?: unknown;
}): {
  letterboxGradientTop: string | undefined;
  letterboxGradientBottom: string | undefined;
  letterboxGradients: Array<{ top: string; bottom: string }> | undefined;
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
          ? (legacy.letterboxGradientTop as string)
          : typeof legacy?.letterbox_gradient_top === "string"
            ? (legacy.letterbox_gradient_top as string)
        : "";
  const bottomRaw =
    typeof data.letterboxGradientBottom === "string"
      ? data.letterboxGradientBottom
      : typeof data.letterbox_gradient_bottom === "string"
        ? data.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? (legacy.letterboxGradientBottom as string)
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? (legacy.letterbox_gradient_bottom as string)
        : "";
  const top = topRaw.trim();
  const bottom = bottomRaw.trim();

  const gradientsRaw = Array.isArray(data.letterboxGradients)
    ? data.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? (legacy!.letterboxGradients as unknown[])
      : null;
  if (!Array.isArray(gradientsRaw)) {
    return { letterboxGradientTop: top || undefined, letterboxGradientBottom: bottom || undefined, letterboxGradients: undefined };
  }
  const out: Array<{ top: string; bottom: string }> = [];
  for (const entry of gradientsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { top?: unknown; bottom?: unknown };
    if (typeof e.top !== "string" || typeof e.bottom !== "string") continue;
    const t = e.top.trim();
    const b = e.bottom.trim();
    if (!t || !b) continue;
    out.push({ top: t, bottom: b });
  }
  return {
    letterboxGradientTop: top || undefined,
    letterboxGradientBottom: bottom || undefined,
    letterboxGradients: out.length > 0 ? out : undefined
  };
}

function normalizeCounter(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizePostCreatedMs(data: Record<string, unknown>): number {
  const ms = readMaybeMillis(data.time ?? data.lastUpdated ?? data.updatedAt ?? data.createdAtMs);
  if (ms !== null && ms > 0) return ms;
  return Date.now();
}

function pickPic(data: { profilePic?: string; profilePicture?: string; photo?: string }): string {
  const value = data.profilePic ?? data.profilePicture ?? data.photo;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed && !/placeholder/i.test(trimmed)) return trimmed;
  return "";
}

function normalizeNullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readGeoPoint(value: unknown): { latitude?: number; longitude?: number } | null {
  if (!value || typeof value !== "object") return null;
  const geo = value as { latitude?: unknown; longitude?: unknown };
  return {
    latitude: typeof geo.latitude === "number" && Number.isFinite(geo.latitude) ? geo.latitude : undefined,
    longitude: typeof geo.longitude === "number" && Number.isFinite(geo.longitude) ? geo.longitude : undefined,
  };
}

function normalizeLocation(raw: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  address: string | null;
} {
  const location = (raw.location ?? {}) as Record<string, unknown>;
  const coordinates = (raw.coordinates ?? {}) as Record<string, unknown>;
  const geo = (raw.geo ?? raw.geoData ?? {}) as Record<string, unknown>;
  const geoPoint = readGeoPoint((geo as { geopoint?: unknown }).geopoint);
  const lat = firstFiniteNumber(
      raw.lat,
      raw.latitude,
      location.lat,
      location.latitude,
      coordinates.lat,
      coordinates.latitude,
      geoPoint?.latitude,
    );
  const lng = firstFiniteNumber(
      raw.long,
      raw.lng,
      raw.longitude,
      location.long,
      location.lng,
      location.longitude,
      coordinates.long,
      coordinates.lng,
      coordinates.longitude,
      geoPoint?.longitude,
    );
  const normalized = normalizeCanonicalPostLocation({
    latitude: lat,
    longitude: lng,
    addressDisplayName:
      normalizeNullable(raw.address) ??
      normalizeNullable(location.address) ??
      normalizeNullable((geo as { address?: unknown }).address),
    city: normalizeNullable((geo as { city?: unknown }).city) ?? normalizeNullable(raw.city),
    region: normalizeNullable((geo as { state?: unknown }).state) ?? normalizeNullable(raw.state),
    country: normalizeNullable((geo as { country?: unknown }).country) ?? normalizeNullable(raw.country),
    source: raw.locationSource ?? "unknown",
    reverseGeocodeMatched: raw.reverseGeocodeStatus === "resolved"
  });
  return {
    lat: normalized.latitude,
    lng: normalized.longitude,
    address: normalized.addressDisplayName ?? "Unknown location"
  };
}

function normalizeGeoData(
  raw: Record<string, unknown>,
): {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  geohash?: string | null;
} | undefined {
  const geo = (raw.geo ?? raw.geoData ?? {}) as Record<string, unknown>;
  const city = normalizeNullable(geo.city);
  const state = normalizeNullable(geo.state);
  const country = normalizeNullable(geo.country);
  const geohash = normalizeNullable(geo.geohash);
  if (!city && !state && !country && !geohash) return undefined;
  return { city, state, country, geohash };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAssetLocations(
  value: unknown,
): Array<{ lat?: number | null; long?: number | null }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map<{ lat?: number | null; long?: number | null } | null>((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const lat = firstFiniteNumber(record.lat, record.latitude);
      const long = firstFiniteNumber(record.long, record.lng, record.longitude);
      if (lat == null && long == null) return null;
      return {
        ...(lat != null ? { lat } : {}),
        ...(long != null ? { long } : {}),
      };
    })
    .filter((entry): entry is { lat?: number | null; long?: number | null } => entry !== null);
  return out.length > 0 ? out : undefined;
}

function normalizeAssets(
  raw: Record<string, unknown>,
  postId: string,
  mediaType: "image" | "video" | undefined,
): FirestoreProfilePostDetail["assets"] {
  const thumbUrl = readPostThumbUrl(raw, postId);
  const media = asRecord(raw.media);
  const canonicalMediaAssets = Array.isArray(media?.assets) ? (media.assets as Array<Record<string, unknown>>) : [];
  const canonicalTopAssets = canonicalMediaAssets.map((asset) => {
    const image = asRecord(asset.image);
    const video = asRecord(asset.video);
    const playback = asRecord(video?.playback);
    const variants = asRecord(video?.variants);
    return {
      id:
        typeof asset.id === "string" && asset.id.trim()
          ? asset.id
          : `${postId}-asset-${String(asset.index ?? "x")}`,
      type: (String(asset.type ?? "image").toLowerCase() === "video" ? "video" : "image") as "image" | "video",
      original:
        normalizeNullable(image?.originalUrl) ??
        normalizeNullable(video?.originalUrl) ??
        normalizeNullable(playback?.primaryUrl) ??
        normalizeNullable(playback?.defaultUrl) ??
        normalizeNullable(playback?.startupUrl) ??
        undefined,
      poster:
        normalizeNullable(video?.posterHighUrl) ??
        normalizeNullable(video?.posterUrl) ??
        normalizeNullable(video?.thumbnailUrl) ??
        normalizeNullable(image?.displayUrl) ??
        normalizeNullable(image?.thumbnailUrl) ??
        thumbUrl,
      thumbnail:
        normalizeNullable(image?.thumbnailUrl) ??
        normalizeNullable(video?.thumbnailUrl) ??
        normalizeNullable(video?.posterUrl) ??
        normalizeNullable(image?.displayUrl) ??
        thumbUrl,
      aspectRatio: normalizeNullableNumber(image?.aspectRatio ?? asset.aspectRatio),
      durationSec: normalizeNullableNumber(video?.durationSec ?? asset.durationSec),
      width: normalizeNullableNumber(image?.width ?? asset.width),
      height: normalizeNullableNumber(image?.height ?? asset.height),
      orientation: normalizeNullable(image?.orientation ?? asset.orientation),
      variants: {
        ...(variants ?? {}),
        ...(playback ?? {}),
      },
    };
  });
  const rawAssets =
    canonicalTopAssets.length > 0
      ? canonicalTopAssets
      : Array.isArray(raw.assets)
        ? (raw.assets as Array<Record<string, unknown>>)
        : [];
  const playbackLabAssets = asRecord(asRecord((raw as { playbackLab?: unknown }).playbackLab)?.assets);
  if (rawAssets.length === 0) return defaultAssets(postId, mediaType);
  return rawAssets.map((asset, idx) => {
    const assetRec = asset as Record<string, unknown>;
    const assetId =
      typeof assetRec.id === "string" && assetRec.id.trim() ? assetRec.id : `${postId}-asset-${idx + 1}`;
    const labAsset = asRecord(playbackLabAssets?.[assetId]);
    const sourceSnapshot = asRecord(labAsset?.sourceSnapshot);
    return {
      id: assetId,
      type: assetRec.type === "video" ? "video" : "image",
      original:
        normalizeNullable(assetRec.original) ??
        normalizeNullable(sourceSnapshot?.original) ??
        undefined,
      poster:
        normalizeNullable(assetRec.poster) ??
        normalizeNullable(assetRec.thumbnail) ??
        normalizeNullable(sourceSnapshot?.poster) ??
        thumbUrl,
      thumbnail:
        normalizeNullable(assetRec.thumbnail) ??
        normalizeNullable(assetRec.poster) ??
        normalizeNullable(sourceSnapshot?.poster) ??
        thumbUrl,
      aspectRatio: normalizeNullableNumber(assetRec.aspectRatio),
      durationSec: normalizeNullableNumber(assetRec.durationSec),
      width: normalizeNullableNumber(assetRec.width),
      height: normalizeNullableNumber(assetRec.height),
      orientation: normalizeNullable(assetRec.orientation),
      ...(typeof assetRec.hasAudio === "boolean" ? { hasAudio: assetRec.hasAudio } : {}),
      ...(asRecord(assetRec.codecs) ? { codecs: asRecord(assetRec.codecs) ?? undefined } : {}),
      ...(asRecord(assetRec.variantMetadata)
        ? { variantMetadata: asRecord(assetRec.variantMetadata) ?? undefined }
        : {}),
      ...(typeof assetRec.instantPlaybackReady === "boolean"
        ? { instantPlaybackReady: assetRec.instantPlaybackReady }
        : {}),
      ...(asRecord(assetRec.playbackLab) ? { playbackLab: asRecord(assetRec.playbackLab) ?? undefined } : {}),
      ...(asRecord(assetRec.generated) ? { generated: asRecord(assetRec.generated) ?? undefined } : {}),
      variants: {
        ...((assetRec.variants ?? {}) as Record<string, unknown>),
        ...(asRecord(sourceSnapshot?.variants) ?? {}),
        ...(asRecord(labAsset?.generated) ?? {}),
        ...(asRecord(assetRec.generated) ?? {}),
      },
    };
  });
}

function defaultAssets(postId: string, mediaType: "image" | "video" | undefined): FirestoreProfilePostDetail["assets"] {
  if (mediaType === "video") {
    return [
      {
        id: `${postId}-asset-1`,
        type: "video"
      }
    ];
  }
  return [
    {
      id: `${postId}-asset-1`,
      type: "image"
    }
  ];
}

export function __testNormalizeProfileDetailAssetsFromRaw(input: {
  raw: Record<string, unknown>;
  postId: string;
  mediaType: "image" | "video";
}): FirestoreProfilePostDetail["assets"] {
  return normalizeAssets(input.raw, input.postId, input.mediaType);
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
