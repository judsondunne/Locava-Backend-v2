import { slimFeedWireCard } from "./compact-wire-slim.js";
import { isBackendAppPostV2ResponsesEnabled } from "../lib/posts/app-post-v2/flags.js";
import { toAppPostV2FromAny } from "../lib/posts/app-post-v2/toAppPostV2.js";
import { logForYouAssetTrace, logForYouFullMediaRepair } from "../observability/for-you-asset-trace.js";
import type { CanonicalPost } from "../contracts/posts/canonical-post.contract.js";
import { debugLog } from "../lib/logging/debug-log.js";
import { LOG_VIDEO_DEBUG } from "../lib/logging/log-config.js";

type Nullable<T> = T | null;

type CompactAssetSeed = {
  id?: string | null;
  type?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  originalUrl?: string | null;
  streamUrl?: string | null;
  mp4Url?: string | null;
  blurhash?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: number | null;
  orientation?: string | null;
  /** Firestore/Wasabi variant map (md/sm/thumb webp, etc.) — preserved for faithful client render. */
  variants?: Record<string, unknown> | null;
};

type CompactAuthorSeed = {
  userId?: string | null;
  handle?: string | null;
  name?: string | null;
  pic?: string | null;
};

type CompactCardSeed = {
  postId: string;
  rankToken: string;
  /** Full Firestore post payload when available — preferred source for {@link AppPostV2} conversion. */
  sourceRawPost?: Record<string, unknown> | null;
  author: CompactAuthorSeed;
  activities?: string[] | null;
  address?: string | null;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }> | null;
  geo?: {
    lat?: number | null;
    long?: number | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    geohash?: string | null;
  } | null;
  assets?: CompactAssetSeed[] | null;
  /**
   * Feed/list surfaces default to 1 asset for payload size. Search/mix surfaces should pass 8–12
   * so playback shells and open transitions match real multi-photo posts.
   */
  compactAssetLimit?: number | null;
  title?: string | null;
  captionPreview?: string | null;
  firstAssetUrl?: string | null;
  media: {
    type: "image" | "video";
    posterUrl: string;
    aspectRatio?: number | null;
    startupHint: "poster_only" | "poster_then_preview";
  };
  social?: {
    likeCount?: number | null;
    commentCount?: number | null;
  } | null;
  viewer?: {
    liked?: boolean | null;
    saved?: boolean | null;
  } | null;
  createdAtMs: number;
  updatedAtMs: number;
  mediaStatus?: "processing" | "ready" | "failed";
  assetsReady?: boolean;
  posterReady?: boolean;
  playbackReady?: boolean;
  playbackUrlPresent?: boolean;
  playbackUrl?: string | null;
  fallbackVideoUrl?: string | null;
  posterUrl?: string | null;
  hasVideo?: boolean;
  aspectRatio?: number | null;
  width?: number | null;
  height?: number | null;
  resizeMode?: string | null;
  /** Canonical asset count from Firestore normalizer (may exceed slim `assets[]` on cards). */
  assetCount?: number | null;
  hasMultipleAssets?: boolean | null;
  /** Firestore-backed `assets[]` length clamped — pairs with canonical `assetCount` for carousel probes. */
  rawFirestoreAssetCount?: number | null;
  mediaCompleteness?: "full" | "cover_only" | null;
  requiresAssetHydration?: boolean | null;
  photoLink?: string | null;
  displayPhotoLink?: string | null;
  /**
   * Compatibility alias strategy for canonical post mirrors.
   * `full_compat` preserves legacy duplicate aliases.
   * Compact surfaces should prefer `app_post_v2_only` to avoid repeating the same canonical payload.
   */
  canonicalAliasMode?: "full_compat" | "app_post_only" | "app_post_v2_only";
  /**
   * When set, variants maps on {@link CompactAssetSeed} rows are stripped and AppPost mirrors are slimmed on the wire.
   * Preserves startup/poster/display image URLs required for cold feed + profile thumbnails.
   */
  compactSurfaceWireMode?: "feed_first_paint" | "profile_grid_tile";
};

/** Default max assets serialized on carousel-capable postcards when callers omit compactAssetLimit. */
export const DEFAULT_CARD_CAROUSEL_ASSET_CAP = 12;

export type FeedCardDTO = {
  /** Canonical app-facing post (locava.appPost v2). */
  appPost?: Record<string, unknown>;
  appPostV2?: Record<string, unknown>;
  canonicalPost?: Record<string, unknown>;
  post?: Record<string, unknown>;
  postContractVersion?: 2 | 3;
  postId: string;
  rankToken: string;
  author: {
    userId: string;
    handle: string;
    name: string | null;
    pic: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  activities?: string[];
  address?: string | null;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  geo?: {
    lat: number | null;
    long: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    geohash: string | null;
  };
  assets?: Array<{
    id: string;
    type: "image" | "video";
    previewUrl: string | null;
    posterUrl: string | null;
    originalUrl: string | null;
    streamUrl?: string | null;
    mp4Url?: string | null;
    blurhash: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    orientation: string | null;
    variants?: Record<string, unknown> | null;
  }>;
  title: string | null;
  captionPreview: string | null;
  firstAssetUrl: string | null;
  media: {
    type: "image" | "video";
    posterUrl: string;
    aspectRatio: number;
    startupHint: "poster_only" | "poster_then_preview";
  };
  social: {
    likeCount: number;
    commentCount: number;
  };
  viewer: {
    liked: boolean;
    saved: boolean;
  };
  createdAtMs: number;
  updatedAtMs: number;
  mediaStatus?: "processing" | "ready" | "failed";
  assetsReady?: boolean;
  posterReady?: boolean;
  playbackReady?: boolean;
  playbackUrlPresent?: boolean;
  playbackUrl?: string | null;
  fallbackVideoUrl?: string | null;
  posterUrl?: string | null;
  hasVideo?: boolean;
  aspectRatio?: number | null;
  width?: number | null;
  height?: number | null;
  resizeMode?: string | null;
  /** Canonical count: max(serialized assets[], server assetCount hint). */
  derivedAssetCount?: number;
  /** Firestore-normalized total assets when known (may exceed `assets[]` on slim cards). */
  assetCount?: number;
  hasMultipleAssets?: boolean;
  /** Firestore-backed `assets[]` length clamped — serialized even when slim cards omit bulky `rawPost`. */
  rawFirestoreAssetCount?: number;
  photoLink?: string | null;
  displayPhotoLink?: string | null;
  /** Slim card is cover-only / first-asset slice; clients should hydrate detail for full carousel. */
  mediaCompleteness?: "full" | "cover_only";
  requiresAssetHydration?: boolean;
};

export type SearchMixPreviewDTO = FeedCardDTO & {
  locationSummary?: string | null;
};

export type PlaybackPostShellDTO = {
  postId: string;
  userId: string;
  caption: string | null;
  title?: string | null;
  description?: string | null;
  activities?: string[];
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  mediaType: "image" | "video";
  thumbUrl: string;
  createdAtMs: number;
  updatedAtMs: number;
  assetsReady: boolean;
  /** Hints merged from feed envelope for playback carousel completeness checks. */
  assetCount?: number;
  hasMultipleAssets?: boolean;
  rawFirestoreAssetCount?: number;
  photoLink?: string | null;
  displayPhotoLink?: string | null;
  mediaCompleteness?: "full" | "cover_only";
  requiresAssetHydration?: boolean;
  assetLocations?: Array<{ lat?: number | null; long?: number | null }>;
  assets: Array<{
    id: string;
    type: "image" | "video";
    original: string | null;
    poster: string | null;
    thumbnail: string | null;
    aspectRatio?: number | null;
    width?: number | null;
    height?: number | null;
    orientation?: string | null;
    variants?: Record<string, unknown>;
  }>;
  cardSummary: FeedCardDTO;
};

export type MapMarkerCompactDTO = {
  id: string;
  postId: string;
  lat: number;
  lng: number;
  activity: string | null;
  activities: string[];
  title?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  visibility?: string | null;
  ownerId?: string | null;
  thumbnailUrl?: string | null;
  thumbKey?: string | null;
  followedUserPic?: string | null;
  hasPhoto?: boolean;
  hasVideo?: boolean;
};

export type ProfileHeaderDTO = {
  userId: string;
  handle: string;
  name: string;
  profilePic: string | null;
  profilePicSmallPath?: string | null;
  profilePicLargePath?: string | null;
  bio?: string | null;
  updatedAtMs?: number | null;
  profileVersion?: string | null;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
};

type DiagnosticWalkIssue = {
  path: string;
  reason: string;
};

const FORBIDDEN_FIELD_NAMES = new Set([
  "rawPost",
  "sourcePost",
  "comments",
  "commentsPreview",
  "followers",
  "following",
  "followingIds",
  "followerIds",
  "collections",
  "collectionMembership",
  "socialSummary",
  "fullUser",
  "userDoc",
]);

const FORBIDDEN_PATH_PARTS = [
  "comments",
  "commentspreview",
  "followers",
  "following",
  "collections",
  "collectionmembership",
  "socialpayload",
  "fulluser",
  "userdoc",
];

function clampText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanBool(value: boolean | null | undefined, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanStringArray(values: string[] | null | undefined, max = 4): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

function toCompactAssets(
  assets: CompactAssetSeed[] | null | undefined,
  max = 1,
  stripVariants = false
): FeedCardDTO["assets"] {
  if (!Array.isArray(assets)) return [];
  return assets.slice(0, max).map((asset, index) => ({
    id: cleanString(asset.id) ?? `asset-${index + 1}`,
    type: asset.type === "video" ? "video" : "image",
    previewUrl: cleanString(asset.previewUrl),
    posterUrl: cleanString(asset.posterUrl),
    originalUrl: cleanString(asset.originalUrl),
    streamUrl: cleanString(asset.streamUrl),
    mp4Url: cleanString(asset.mp4Url),
    blurhash: cleanString(asset.blurhash),
    width: cleanNumber(asset.width),
    height: cleanNumber(asset.height),
    aspectRatio: cleanNumber(asset.aspectRatio),
    orientation: cleanString(asset.orientation),
    ...(!stripVariants &&
    asset.variants &&
    typeof asset.variants === "object" &&
    Object.keys(asset.variants).length > 0
      ? { variants: asset.variants }
      : {}),
  }));
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Maps native Firestore post `assets[]` (image/video + Wasabi variants) into compact card seeds.
 * Keeps stable ids and full `variants` so playback shells are not collapsed to a single synthetic row.
 */
export function firestoreAssetsToCompactSeeds(
  rawAssets: unknown[] | null | undefined,
  postId: string,
  max = 12,
): CompactAssetSeed[] {
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) return [];
  const cap = Math.max(1, Math.min(24, Math.floor(max)));
  return rawAssets.slice(0, cap).map((raw, index) => {
    const asset = asUnknownRecord(raw) ?? {};
    const variants = asUnknownRecord(asset.variants) ?? {};
    const md = asUnknownRecord(variants.md);
    const sm = asUnknownRecord(variants.sm);
    const thumb = asUnknownRecord(variants.thumb);
    const lg = asUnknownRecord(variants.lg);
    const fallbackJpg = asUnknownRecord(variants.fallbackJpg);
    const typeRaw = String(asset.type ?? asset.mediaType ?? "image").toLowerCase();
    const type = typeRaw === "video" ? "video" : "image";
    const original =
      cleanString(typeof asset.original === "string" ? asset.original : null) ??
      cleanString(typeof asset.url === "string" ? asset.url : null);
    const poster =
      cleanString(typeof asset.poster === "string" ? asset.poster : null) ??
      cleanString(typeof asset.thumbnail === "string" ? asset.thumbnail : null);
    const previewUrl =
      cleanString(typeof md?.webp === "string" ? md.webp : null) ??
      cleanString(typeof sm?.webp === "string" ? sm.webp : null) ??
      cleanString(typeof thumb?.webp === "string" ? thumb.webp : null) ??
      cleanString(typeof lg?.webp === "string" ? lg.webp : null) ??
      (fallbackJpg && typeof fallbackJpg.jpg === "string" ? cleanString(fallbackJpg.jpg) : null) ??
      original ??
      poster;
    const streamUrl = cleanString(typeof variants.hls === "string" ? variants.hls : null);
    const mp4Url =
      cleanString(typeof variants.main1080Avc === "string" ? variants.main1080Avc : null) ??
      cleanString(typeof variants.main1080 === "string" ? variants.main1080 : null) ??
      cleanString(typeof variants.main720Avc === "string" ? variants.main720Avc : null) ??
      cleanString(typeof variants.main720 === "string" ? variants.main720 : null) ??
      cleanString(typeof variants.startup1080FaststartAvc === "string" ? variants.startup1080FaststartAvc : null) ??
      cleanString(typeof variants.startup720FaststartAvc === "string" ? variants.startup720FaststartAvc : null) ??
      cleanString(typeof variants.startup540FaststartAvc === "string" ? variants.startup540FaststartAvc : null) ??
      (type === "video" ? original : null);
    const id =
      cleanString(typeof asset.id === "string" ? asset.id : null) ?? `${postId}-asset-${index + 1}`;
    return {
      id,
      type,
      previewUrl,
      posterUrl: poster,
      originalUrl: original,
      streamUrl,
      mp4Url,
      blurhash: cleanString(typeof asset.blurhash === "string" ? asset.blurhash : null),
      width: cleanNumber(typeof asset.width === "number" ? asset.width : undefined),
      height: cleanNumber(typeof asset.height === "number" ? asset.height : undefined),
      aspectRatio: cleanNumber(typeof asset.aspectRatio === "number" ? asset.aspectRatio : undefined),
      orientation: cleanString(typeof asset.orientation === "string" ? asset.orientation : null),
      variants: Object.keys(variants).length > 0 ? variants : undefined,
    };
  });
}

function toCompactAuthor(seed: CompactAuthorSeed): FeedCardDTO["author"] {
  const handle = cleanString(seed.handle)?.replace(/^@+/, "") ?? "unknown";
  const name = cleanString(seed.name);
  const pic = cleanString(seed.pic);
  return {
    userId: cleanString(seed.userId) ?? "",
    handle,
    name,
    pic,
    displayName: name,
    avatarUrl: pic,
  };
}

function normalizeAspectRatio(value: number | null | undefined, fallback = 9 / 16): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function pickCompactSeedImageDisplayUrl(asset: CompactAssetSeed): string | null {
  const variants = asUnknownRecord(asset.variants) ?? {};
  const lg = asUnknownRecord(variants.lg);
  const fallbackJpg = asUnknownRecord(variants.fallbackJpg);
  return (
    cleanString(typeof lg?.webp === "string" ? lg.webp : null) ??
    cleanString(typeof lg?.jpg === "string" ? lg.jpg : null) ??
    cleanString(typeof fallbackJpg?.jpg === "string" ? fallbackJpg.jpg : null) ??
    cleanString(asset.originalUrl) ??
    cleanString(asset.previewUrl) ??
    cleanString(asset.posterUrl)
  );
}

function pickCompactSeedImageThumbnailUrl(asset: CompactAssetSeed): string | null {
  const variants = asUnknownRecord(asset.variants) ?? {};
  const thumb = asUnknownRecord(variants.thumb);
  const sm = asUnknownRecord(variants.sm);
  const md = asUnknownRecord(variants.md);
  const lg = asUnknownRecord(variants.lg);
  const fallbackJpg = asUnknownRecord(variants.fallbackJpg);
  return (
    cleanString(typeof thumb?.webp === "string" ? thumb.webp : null) ??
    cleanString(typeof sm?.webp === "string" ? sm.webp : null) ??
    cleanString(typeof md?.webp === "string" ? md.webp : null) ??
    cleanString(typeof lg?.webp === "string" ? lg.webp : null) ??
    cleanString(typeof fallbackJpg?.jpg === "string" ? fallbackJpg.jpg : null) ??
    cleanString(asset.previewUrl) ??
    cleanString(asset.posterUrl) ??
    cleanString(asset.originalUrl)
  );
}

function syntheticRawFromCompactSeed(seed: CompactCardSeed): Record<string, unknown> {
  const assets = Array.isArray(seed.assets) ? seed.assets : [];
  const firstImageAsset = assets.find((asset) => asset?.type !== "video") ?? assets[0] ?? null;
  const imageCoverUrl =
    firstImageAsset && firstImageAsset.type !== "video"
      ? pickCompactSeedImageDisplayUrl(firstImageAsset)
      : null;
  const imageThumbUrl =
    firstImageAsset && firstImageAsset.type !== "video"
      ? pickCompactSeedImageThumbnailUrl(firstImageAsset)
      : null;
  const coverUrl = seed.media.type === "image" ? imageCoverUrl ?? seed.media.posterUrl : seed.media.posterUrl;
  const coverThumbUrl =
    seed.media.type === "image"
      ? imageThumbUrl ?? imageCoverUrl ?? seed.media.posterUrl
      : seed.media.posterUrl;
  const canonicalMediaAssets = assets.map((a, index) => {
    const playbackUrl = a.mp4Url ?? a.originalUrl ?? null;
    if (a.type === "video") {
      return {
        id: a.id ?? `${seed.postId}-asset-${index + 1}`,
        index,
        type: "video",
        image: null,
        video: {
          originalUrl: playbackUrl,
          posterUrl: a.posterUrl ?? null,
          posterHighUrl: a.posterUrl ?? null,
          thumbnailUrl: a.previewUrl ?? a.posterUrl ?? null,
          playback: {
            startupUrl: playbackUrl,
            defaultUrl: playbackUrl,
            primaryUrl: playbackUrl,
            goodNetworkUrl: playbackUrl,
            weakNetworkUrl: playbackUrl,
            poorNetworkUrl: playbackUrl,
            highQualityUrl: playbackUrl,
            upgradeUrl: playbackUrl,
            hlsUrl: a.streamUrl ?? null,
            previewUrl: a.previewUrl ?? null,
            fallbackUrl: playbackUrl,
            selectedReason: "synthetic_seed_playback"
          },
          variants: {
            ...(a.streamUrl ? { hls: a.streamUrl } : {}),
            ...(a.mp4Url ? { main720Avc: a.mp4Url, main720: a.mp4Url } : {}),
          },
          readiness: {
            assetsReady: true,
            instantPlaybackReady: true,
            faststartVerified: true,
            processingStatus: "completed"
          },
          technical: {
            sourceCodec: null,
            playbackCodec: null,
            audioCodec: null,
            width: a.width ?? null,
            height: a.height ?? null,
            bitrateKbps: null,
            sizeBytes: null
          }
        },
        presentation: {
          letterboxGradient:
            Array.isArray(seed.letterboxGradients) && seed.letterboxGradients[index]
              ? seed.letterboxGradients[index]
              : null
        }
      };
    }
    return {
      id: a.id ?? `${seed.postId}-asset-${index + 1}`,
      index,
      type: "image",
      image: {
        originalUrl: a.originalUrl ?? null,
        displayUrl: pickCompactSeedImageDisplayUrl(a),
        thumbnailUrl: pickCompactSeedImageThumbnailUrl(a),
        blurhash: a.blurhash ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        aspectRatio: a.aspectRatio ?? null,
        orientation: a.orientation ?? null
      },
      video: null,
      presentation: {
        letterboxGradient:
          Array.isArray(seed.letterboxGradients) && seed.letterboxGradients[index]
            ? seed.letterboxGradients[index]
            : null
      }
    };
  });
  return {
    id: seed.postId,
    postId: seed.postId,
    userId: seed.author.userId,
    userHandle: seed.author.handle,
    userName: seed.author.name,
    userPic: seed.author.pic,
    title: seed.title,
    caption: seed.captionPreview,
    activities: seed.activities,
    address: seed.address,
    lat: seed.geo?.lat,
    lng: seed.geo?.long,
    long: seed.geo?.long,
    geoData: {
      city: seed.geo?.city,
      state: seed.geo?.state,
      country: seed.geo?.country,
      geohash: seed.geo?.geohash
    },
    assets: assets.map((a) => ({
      id: a.id,
      type: a.type,
      original: a.originalUrl,
      url: a.originalUrl,
      poster: a.posterUrl,
      thumbnail: a.type === "video" ? a.previewUrl : pickCompactSeedImageThumbnailUrl(a),
      blurhash: a.blurhash,
      width: a.width,
      height: a.height,
      aspectRatio: a.aspectRatio,
      orientation: a.orientation,
      variants: {
        ...(typeof a.streamUrl === "string" && a.streamUrl.trim() ? { hls: a.streamUrl } : {}),
        ...(typeof a.mp4Url === "string" && a.mp4Url.trim()
          ? { main720Avc: a.mp4Url, main1080Avc: a.mp4Url }
          : {}),
        ...(a.variants && typeof a.variants === "object" ? a.variants : {})
      }
    })),
    likeCount: seed.social?.likeCount,
    likesCount: seed.social?.likeCount,
    commentsCount: seed.social?.commentCount,
    commentCount: seed.social?.commentCount,
    mediaType: seed.media.type,
    classification: {
      mediaKind: seed.media.type === "video" ? "video" : "image",
      reel: false,
      visibility: "public",
      source: "user",
    },
    media: {
      status: "ready",
      assetsReady: true,
      instantPlaybackReady: seed.media.type === "video",
      completeness: "full",
      assetCount: canonicalMediaAssets.length,
      rawAssetCount: canonicalMediaAssets.length,
      hasMultipleAssets: canonicalMediaAssets.length > 1,
      primaryAssetId: canonicalMediaAssets[0]?.id ?? null,
      coverAssetId: canonicalMediaAssets[0]?.id ?? null,
      cover: {
        type: seed.media.type,
        url: coverUrl,
        posterUrl: coverUrl,
        thumbUrl: coverThumbUrl,
        width: assets[0]?.width ?? null,
        height: assets[0]?.height ?? null,
        aspectRatio: assets[0]?.aspectRatio ?? null,
        assetId: canonicalMediaAssets[0]?.id ?? null,
        gradient:
          Array.isArray(seed.letterboxGradients) && seed.letterboxGradients.length > 0
            ? seed.letterboxGradients[0]
            : null
      },
      assets: canonicalMediaAssets
    },
    thumbUrl: coverThumbUrl,
    displayPhotoLink: coverUrl,
    photoLink: seed.photoLink ?? seed.displayPhotoLink ?? coverUrl,
    photoLinks2: seed.playbackUrl ?? seed.fallbackVideoUrl,
    fallbackVideoUrl: seed.fallbackVideoUrl,
    createdAtMs: seed.createdAtMs,
    updatedAtMs: seed.updatedAtMs,
    carouselFitWidth: seed.carouselFitWidth,
    layoutLetterbox: seed.layoutLetterbox,
    letterboxGradientTop: seed.letterboxGradientTop,
    letterboxGradientBottom: seed.letterboxGradientBottom,
    letterboxGradients: seed.letterboxGradients
  };
}

function patchAppPostV2FirstPaintMediaFromRawSources(
  appPost: Record<string, unknown>,
  raw: Record<string, unknown>,
  postId: string
): Record<string, unknown> {
  const media = appPost.media as Record<string, unknown> | undefined;
  if (!media || !Array.isArray(media.assets)) return appPost;
  const assets = [...(media.assets as Record<string, unknown>[])];
  const rawMedia = raw.media && typeof raw.media === "object" ? (raw.media as Record<string, unknown>) : null;
  const rawCanon = Array.isArray(rawMedia?.assets) ? (rawMedia.assets as Record<string, unknown>[]) : [];
  const rawLegacy = Array.isArray(raw.assets) ? (raw.assets as Record<string, unknown>[]) : [];
  let changed = false;
  const patched = assets.map((asset, i) => {
    if (!asset || String(asset.type) !== "image") return asset;
    const img = asUnknownRecord(asset.image) ?? {};
    const du = cleanString(typeof img.displayUrl === "string" ? img.displayUrl : undefined);
    const ou = cleanString(typeof img.originalUrl === "string" ? img.originalUrl : undefined);
    const tu = cleanString(typeof img.thumbnailUrl === "string" ? img.thumbnailUrl : undefined);
    if (du) return asset;
    const rc = rawCanon[i];
    const rl = rawLegacy[i];
    const rcImg = rc && String(rc.type).toLowerCase() !== "video" ? asUnknownRecord(rc.image) : null;
    const pick = (v: unknown) => cleanString(typeof v === "string" ? v : undefined);
    const fromCanon =
      pick(rcImg?.displayUrl) ??
      pick(rcImg?.previewUrl) ??
      pick(rcImg?.fullUrl) ??
      pick(rcImg?.originalUrl) ??
      pick(rcImg?.thumbnailUrl);
    const fromLegacy =
      pick(rl?.previewUrl) ?? pick(rl?.originalUrl) ?? pick((rl as { original?: unknown })?.original) ?? pick(rl?.posterUrl) ?? pick(rl?.url);
    const fillDisplay = du ?? fromCanon ?? fromLegacy ?? ou ?? tu;
    const fillOriginal = ou ?? fromCanon ?? fromLegacy ?? du ?? tu;
    if (!fillDisplay && !fillOriginal) return asset;
    if (fillDisplay !== du || fillOriginal !== ou) changed = true;
    return {
      ...asset,
      image: {
        ...img,
        displayUrl: fillDisplay ?? null,
        originalUrl: fillOriginal ?? null,
        thumbnailUrl: tu ?? pick(rl?.posterUrl) ?? (typeof img.thumbnailUrl === "string" ? img.thumbnailUrl : null)
      }
    };
  });
  if (!changed) return appPost;
  try {
    debugLog("feed", "FEED_CARD_MEDIA_ENRICH_PATCHED", () => ({
      postId,
      touchedAssetCount: patched.length
    }));
  } catch {
    // ignore
  }
  return { ...appPost, media: { ...media, assets: patched } };
}

function attachAppPostToFeedCard(seed: CompactCardSeed, viewer: { liked: boolean; saved: boolean }): Partial<FeedCardDTO> {
  if (!isBackendAppPostV2ResponsesEnabled()) return {};
  const aliasMode = seed.canonicalAliasMode ?? "full_compat";
  const raw = seed.sourceRawPost ?? syntheticRawFromCompactSeed(seed);
  const rawTopLen = Array.isArray(raw.assets) ? raw.assets.length : 0;
  const canMedia =
    raw.media && typeof raw.media === "object" ? (raw.media as Record<string, unknown>) : null;
  const rawCanonAssetLen = Array.isArray(canMedia?.assets) ? (canMedia.assets as unknown[]).length : 0;
  const rawCanonDeclared =
    typeof canMedia?.assetCount === "number" && Number.isFinite(canMedia.assetCount)
      ? Math.floor(canMedia.assetCount)
      : 0;
  const rawCanonicalMediaAssetCount = Math.max(rawCanonAssetLen, rawCanonDeclared);
  try {
    const appPostRaw = toAppPostV2FromAny(raw, {
      postId: seed.postId,
      forceNormalize: true,
      viewerState: {
        liked: viewer.liked,
        saved: viewer.saved,
        savedCollectionIds: [],
        followsAuthor: false
      }
    }) as unknown as Record<string, unknown>;
    const appPost = patchAppPostV2FirstPaintMediaFromRawSources(appPostRaw, raw, seed.postId);
    const media = appPost.media as Record<string, unknown> | undefined;
    const apAssets = Array.isArray(media?.assets) ? (media.assets as unknown[]) : [];
    const canonicalMedia = asUnknownRecord(raw.media);
    const canonicalAssets = Array.isArray(canonicalMedia?.assets) ? (canonicalMedia?.assets as Record<string, unknown>[]) : [];
    const firstCanonicalAsset = canonicalAssets[0] ?? null;
    const firstSerializedAsset = (apAssets[0] as Record<string, unknown> | undefined) ?? null;
    const canonicalPlayback = asUnknownRecord(asUnknownRecord(firstCanonicalAsset?.video)?.playback);
    const serializedPlayback = asUnknownRecord(
      asUnknownRecord(asUnknownRecord(firstSerializedAsset?.video)?.playback) ??
        asUnknownRecord(firstSerializedAsset?.playback)
    );
    if (LOG_VIDEO_DEBUG) {
      debugLog("video", "WIRE_VIDEO_SERIALIZE_DEBUG", () => ({
          postId: seed.postId,
          mediaKind: asUnknownRecord(raw.classification)?.mediaKind ?? raw.mediaType ?? null,
          canonicalAssetCount: canonicalAssets.length,
          serializedAssetCount: apAssets.length,
          firstCanonicalAssetType: firstCanonicalAsset?.type ?? null,
          firstSerializedAssetType: firstSerializedAsset?.type ?? null,
          canonicalStartupUrl: canonicalPlayback?.startupUrl ?? null,
          serializedStartupUrl: serializedPlayback?.startupUrl ?? null,
          serializedVideoUrl:
            firstSerializedAsset?.videoUrl ??
            firstSerializedAsset?.url ??
            asUnknownRecord(raw.compatibility)?.photoLinks2 ??
            raw.fallbackVideoUrl ??
            null,
          selectedReason: serializedPlayback?.selectedReason ?? canonicalPlayback?.selectedReason ?? null
        }));
    }
    if (LOG_VIDEO_DEBUG) {
      const firstCanonicalImage = canonicalAssets.find((asset) => asset?.type === "image") ?? null;
      const firstCanonicalImageBlock =
        firstCanonicalImage && typeof firstCanonicalImage === "object"
          ? (firstCanonicalImage.image as Record<string, unknown> | undefined)
          : undefined;
      const selectedFullscreenImageKind =
        typeof firstCanonicalImageBlock?.fullUrl === "string" && firstCanonicalImageBlock.fullUrl
          ? "full"
          : typeof firstCanonicalImageBlock?.originalUrl === "string" && firstCanonicalImageBlock.originalUrl
            ? "original"
            : typeof firstCanonicalImageBlock?.largeUrl === "string" && firstCanonicalImageBlock.largeUrl
              ? "large"
              : typeof firstCanonicalImageBlock?.displayUrl === "string" && firstCanonicalImageBlock.displayUrl
                ? "display"
                : typeof firstCanonicalImageBlock?.thumbnailUrl === "string" && firstCanonicalImageBlock.thumbnailUrl
                  ? "thumbnail"
                  : "none";
      debugLog("video", "WIRE_IMAGE_SERIALIZE_DEBUG", () => ({
          postId: seed.postId,
          mediaKind: asUnknownRecord(raw.classification)?.mediaKind ?? raw.mediaType ?? null,
          assetCount: canonicalAssets.length,
          firstAssetType: firstCanonicalImage?.type ?? null,
          displayUrlPresent: Boolean(firstCanonicalImageBlock?.displayUrl),
          thumbnailUrlPresent: Boolean(firstCanonicalImageBlock?.thumbnailUrl),
          mediumUrlPresent: Boolean(firstCanonicalImageBlock?.mediumUrl),
          largeUrlPresent: Boolean(firstCanonicalImageBlock?.largeUrl),
          fullUrlPresent: Boolean(firstCanonicalImageBlock?.fullUrl),
          originalUrlPresent: Boolean(firstCanonicalImageBlock?.originalUrl),
          selectedFullscreenImageKind,
          letterboxGradientPresent: Boolean(
            (firstCanonicalImage as { presentation?: { letterboxGradient?: { top?: string; bottom?: string } } } | null)
              ?.presentation?.letterboxGradient?.top ||
              (firstCanonicalImage as { presentation?: { letterboxGradient?: { top?: string; bottom?: string } } } | null)
                ?.presentation?.letterboxGradient?.bottom
          ),
        }));
    }
    let fixed: Record<string, unknown> = appPost;
    if (media && typeof media.assetCount === "number" && Number.isFinite(media.assetCount) && media.assetCount !== apAssets.length) {
      logForYouFullMediaRepair({
        postId: seed.postId,
        cachedAssetCount: apAssets.length,
        sourceAssetCount: Math.max(rawTopLen, rawCanonicalMediaAssetCount),
        repaired: true,
        reason: "appPost_media_assetCount_mismatch"
      });
      fixed = { ...appPost, media: { ...media, assetCount: apAssets.length } };
    } else if (rawTopLen > apAssets.length && apAssets.length > 0) {
      logForYouFullMediaRepair({
        postId: seed.postId,
        cachedAssetCount: apAssets.length,
        sourceAssetCount: rawTopLen,
        repaired: false,
        reason: "appPost_fewer_assets_than_firestore_top_level"
      });
    }
    const fixedMedia = fixed.media as Record<string, unknown> | undefined;
    const fixedAssets = Array.isArray(fixedMedia?.assets) ? (fixedMedia.assets as Record<string, unknown>[]) : [];
    const firstFixed = fixedAssets[0];
    const mediaKindHint = String(asUnknownRecord(raw.classification)?.mediaKind ?? raw.mediaType ?? "").toLowerCase();
    if (mediaKindHint === "image" && firstFixed && String(firstFixed.type) === "image") {
      const ib = asUnknownRecord(firstFixed.image) ?? {};
      const hasDisp = Boolean(
        cleanString(typeof ib.displayUrl === "string" ? ib.displayUrl : undefined) ||
          cleanString(typeof ib.previewUrl === "string" ? ib.previewUrl : undefined)
      );
      const hasOrig = Boolean(cleanString(typeof ib.originalUrl === "string" ? ib.originalUrl : undefined));
      if (!hasDisp && !hasOrig) {
        try {
          debugLog("feed", "FEED_CARD_MEDIA_CONTRACT_MISMATCH", () => ({
            postId: seed.postId,
            reason: "image_missing_display_after_raw_enrich"
          }));
        } catch {
          // ignore
        }
      }
    }
    const canonical = fixed as unknown as CanonicalPost;
    if (aliasMode === "app_post_only") {
      return {
        appPost: canonical as unknown as Record<string, unknown>,
        postContractVersion: 3
      };
    }
    if (aliasMode === "app_post_v2_only") {
      return {
        appPostV2: canonical as unknown as Record<string, unknown>,
        postContractVersion: 3
      };
    }
    return {
      // Compatibility mirrors: all point to the same canonical object.
      appPost: canonical as unknown as Record<string, unknown>,
      appPostV2: canonical as unknown as Record<string, unknown>,
      canonicalPost: canonical as unknown as Record<string, unknown>,
      post: canonical as unknown as Record<string, unknown>,
      postContractVersion: 3
    };
  } catch {
    return {};
  }
}

export function toFeedCardDTO(seed: CompactCardSeed): FeedCardDTO {
  const slimWire =
    seed.compactSurfaceWireMode === "feed_first_paint" || seed.compactSurfaceWireMode === "profile_grid_tile";
  const seedAssetLen = Array.isArray(seed.assets) ? seed.assets.length : 0;
  const hintedAssetCount =
    typeof seed.assetCount === "number" && Number.isFinite(seed.assetCount) ? Math.floor(seed.assetCount) : null;
  const rawFromSeed =
    typeof seed.rawFirestoreAssetCount === "number" && Number.isFinite(seed.rawFirestoreAssetCount)
      ? Math.floor(seed.rawFirestoreAssetCount)
      : null;
  const rawTopFromPost = Array.isArray(seed.sourceRawPost?.assets) ? seed.sourceRawPost.assets.length : null;
  const rawFireLen =
    rawFromSeed != null && rawTopFromPost != null
      ? Math.max(rawFromSeed, rawTopFromPost)
      : rawFromSeed ?? rawTopFromPost;
  const assetCap =
    typeof seed.compactAssetLimit === "number" &&
    Number.isFinite(seed.compactAssetLimit) &&
    seed.compactAssetLimit > 0
      ? Math.min(24, Math.floor(seed.compactAssetLimit))
      : Math.min(DEFAULT_CARD_CAROUSEL_ASSET_CAP, Math.max(1, seedAssetLen));
  const assets = toCompactAssets(seed.assets, assetCap, slimWire) ?? [];
  const firstAsset = assets[0];
  const posterUrl = cleanString(seed.media.posterUrl) ?? firstAsset?.posterUrl ?? "";
  const derivedAssetCount = Math.max(
    assets.length,
    hintedAssetCount != null && hintedAssetCount >= 0 ? hintedAssetCount : seedAssetLen,
    rawFireLen != null && rawFireLen >= 0 ? rawFireLen : 0,
  );
  const explicitHydrationIncomplete = seed.requiresAssetHydration === true || seed.mediaCompleteness === "cover_only";
  const carouselIncomplete =
    derivedAssetCount > assets.length ||
    explicitHydrationIncomplete ||
    Boolean(seed.hasMultipleAssets === true && assets.length <= 1);
  const viewerState = {
    liked: cleanBool(seed.viewer?.liked),
    saved: cleanBool(seed.viewer?.saved),
  };
  const rawForShape = seed.sourceRawPost ?? null;
  const schemaName =
    rawForShape && typeof rawForShape === "object" && typeof (rawForShape as { schema?: { name?: unknown } }).schema?.name === "string"
      ? String((rawForShape as { schema: { name: string } }).schema.name)
      : null;
  const sourceShape =
    schemaName === "locava.post" ? "master_post_v2" : seed.sourceRawPost ? "legacy_firestore" : "synthetic_seed";

  const card: FeedCardDTO = {
    postId: seed.postId,
    rankToken: seed.rankToken,
    author: toCompactAuthor(seed.author),
    activities: cleanStringArray(seed.activities),
    address: cleanString(seed.address),
    ...(typeof seed.carouselFitWidth === "boolean" ? { carouselFitWidth: seed.carouselFitWidth } : {}),
    ...(typeof seed.layoutLetterbox === "boolean" ? { layoutLetterbox: seed.layoutLetterbox } : {}),
    ...(cleanString(seed.letterboxGradientTop) !== null
      ? { letterboxGradientTop: cleanString(seed.letterboxGradientTop) }
      : {}),
    ...(cleanString(seed.letterboxGradientBottom) !== null
      ? { letterboxGradientBottom: cleanString(seed.letterboxGradientBottom) }
      : {}),
    ...(Array.isArray(seed.letterboxGradients) && seed.letterboxGradients.length > 0
      ? { letterboxGradients: seed.letterboxGradients.slice(0, 2) }
      : {}),
    geo: {
      lat: cleanNumber(seed.geo?.lat),
      long: cleanNumber(seed.geo?.long),
      city: cleanString(seed.geo?.city),
      state: cleanString(seed.geo?.state),
      country: cleanString(seed.geo?.country),
      geohash: cleanString(seed.geo?.geohash),
    },
    assets,
    title: clampText(seed.title, 80),
    captionPreview: clampText(seed.captionPreview, 160),
    firstAssetUrl: cleanString(seed.firstAssetUrl) ?? firstAsset?.originalUrl ?? firstAsset?.previewUrl ?? posterUrl,
    media: {
      type: seed.media.type,
      posterUrl,
      aspectRatio: normalizeAspectRatio(seed.media.aspectRatio ?? firstAsset?.aspectRatio),
      startupHint: seed.media.startupHint,
    },
    social: {
      likeCount: Math.max(0, Math.floor(cleanNumber(seed.social?.likeCount) ?? 0)),
      commentCount: Math.max(0, Math.floor(cleanNumber(seed.social?.commentCount) ?? 0)),
    },
    viewer: viewerState,
    createdAtMs: seed.createdAtMs,
    updatedAtMs: seed.updatedAtMs,
    ...(seed.mediaStatus ? { mediaStatus: seed.mediaStatus } : {}),
    ...(typeof seed.assetsReady === "boolean" ? { assetsReady: seed.assetsReady } : {}),
    ...(typeof seed.posterReady === "boolean" ? { posterReady: seed.posterReady } : {}),
    ...(typeof seed.playbackReady === "boolean" ? { playbackReady: seed.playbackReady } : {}),
    ...(typeof seed.playbackUrlPresent === "boolean" ? { playbackUrlPresent: seed.playbackUrlPresent } : {}),
    ...(typeof seed.playbackUrl === "string" ? { playbackUrl: seed.playbackUrl } : {}),
    ...(typeof seed.fallbackVideoUrl === "string" ? { fallbackVideoUrl: seed.fallbackVideoUrl } : {}),
    ...(typeof seed.posterUrl === "string" ? { posterUrl: seed.posterUrl } : {}),
    ...(typeof seed.hasVideo === "boolean" ? { hasVideo: seed.hasVideo } : {}),
    ...(cleanNumber(seed.aspectRatio) != null ? { aspectRatio: cleanNumber(seed.aspectRatio) } : {}),
    ...(cleanNumber(seed.width) != null ? { width: cleanNumber(seed.width) } : {}),
    ...(cleanNumber(seed.height) != null ? { height: cleanNumber(seed.height) } : {}),
    ...(cleanString(seed.resizeMode) != null ? { resizeMode: cleanString(seed.resizeMode) } : {}),
    ...(hintedAssetCount != null && hintedAssetCount >= 0 ? { assetCount: hintedAssetCount } : {}),
    ...(typeof seed.hasMultipleAssets === "boolean" ? { hasMultipleAssets: seed.hasMultipleAssets } : {}),
    ...(rawFireLen != null && rawFireLen >= 0 ? { rawFirestoreAssetCount: rawFireLen } : {}),
    ...(cleanString(seed.photoLink) != null ? { photoLink: cleanString(seed.photoLink) } : {}),
    ...(cleanString(seed.displayPhotoLink) != null ? { displayPhotoLink: cleanString(seed.displayPhotoLink) } : {}),
    derivedAssetCount,
    ...(carouselIncomplete ? { mediaCompleteness: "cover_only" as const, requiresAssetHydration: true as const } : {}),
    ...attachAppPostToFeedCard(seed, viewerState),
  };

  const ap = card.appPost as { media?: { assetCount?: unknown; assets?: unknown[] } } | undefined;
  const apAssetsLen = Array.isArray(ap?.media?.assets) ? ap.media.assets.length : 0;
  const apDeclared =
    typeof ap?.media?.assetCount === "number" && Number.isFinite(ap.media.assetCount) ? Math.floor(ap.media.assetCount) : apAssetsLen;
  logForYouAssetTrace({
    postId: seed.postId,
    sourceShape,
    rawTopLevelAssetsCount: rawTopFromPost,
    rawCanonicalMediaAssetCount:
      rawForShape && typeof rawForShape === "object" && rawForShape.media && typeof rawForShape.media === "object"
        ? Math.max(
            Array.isArray((rawForShape.media as { assets?: unknown[] }).assets)
              ? ((rawForShape.media as { assets: unknown[] }).assets.length ?? 0)
              : 0,
            typeof (rawForShape.media as { assetCount?: unknown }).assetCount === "number"
              ? Math.floor(Number((rawForShape.media as { assetCount: number }).assetCount))
              : 0
          )
        : null,
    appPostMediaAssetCount: apDeclared,
    dtoAssetCount: card.assets?.length ?? 0,
    responseHasAppPost: Boolean(card.appPost),
    responsePostContractVersion: card.postContractVersion ?? null,
    mediaCompleteness: card.mediaCompleteness ?? (carouselIncomplete ? "cover_only" : "full"),
    selectedProjection: "toFeedCardDTO_compact_plus_appPostV2"
  });

  return slimWire ? (slimFeedWireCard(card as unknown as Record<string, unknown>) as unknown as FeedCardDTO) : card;
}

export function toSearchMixPreviewDTO(
  seed: CompactCardSeed & { locationSummary?: string | null }
): SearchMixPreviewDTO {
  return {
    ...toFeedCardDTO(seed),
    locationSummary: cleanString(seed.locationSummary),
  };
}

export function toPlaybackPostShellDTO(seed: {
  userId: string;
  card: FeedCardDTO;
}): PlaybackPostShellDTO {
  const detailCard = seed.card as FeedCardDTO & {
    appPostAttached?: boolean;
    appPostWireAssetCount?: number;
    wireDeclaredMediaAssetCount?: number;
  };
  const trimmedCardSummary: FeedCardDTO = {
    postId: detailCard.postId,
    rankToken: detailCard.rankToken,
    author: detailCard.author,
    activities: detailCard.activities,
    address: detailCard.address,
    ...(typeof detailCard.carouselFitWidth === "boolean" ? { carouselFitWidth: detailCard.carouselFitWidth } : {}),
    ...(typeof detailCard.layoutLetterbox === "boolean" ? { layoutLetterbox: detailCard.layoutLetterbox } : {}),
    ...(detailCard.letterboxGradientTop != null ? { letterboxGradientTop: detailCard.letterboxGradientTop } : {}),
    ...(detailCard.letterboxGradientBottom != null ? { letterboxGradientBottom: detailCard.letterboxGradientBottom } : {}),
    ...(Array.isArray(detailCard.letterboxGradients) ? { letterboxGradients: detailCard.letterboxGradients } : {}),
    geo: detailCard.geo,
    assets: Array.isArray(detailCard.assets) ? detailCard.assets.slice(0, 1) : [],
    title: detailCard.title,
    captionPreview: detailCard.captionPreview,
    firstAssetUrl: detailCard.firstAssetUrl,
    media: detailCard.media,
    social: detailCard.social,
    viewer: detailCard.viewer,
    createdAtMs: detailCard.createdAtMs,
    updatedAtMs: detailCard.updatedAtMs,
    ...(detailCard.mediaStatus ? { mediaStatus: detailCard.mediaStatus } : {}),
    ...(typeof detailCard.assetsReady === "boolean" ? { assetsReady: detailCard.assetsReady } : {}),
    ...(typeof detailCard.posterReady === "boolean" ? { posterReady: detailCard.posterReady } : {}),
    ...(typeof detailCard.playbackReady === "boolean" ? { playbackReady: detailCard.playbackReady } : {}),
    ...(typeof detailCard.playbackUrlPresent === "boolean" ? { playbackUrlPresent: detailCard.playbackUrlPresent } : {}),
    ...(typeof detailCard.playbackUrl === "string" ? { playbackUrl: detailCard.playbackUrl } : {}),
    ...(typeof detailCard.fallbackVideoUrl === "string" ? { fallbackVideoUrl: detailCard.fallbackVideoUrl } : {}),
    ...(typeof detailCard.posterUrl === "string" ? { posterUrl: detailCard.posterUrl } : {}),
    ...(typeof detailCard.hasVideo === "boolean" ? { hasVideo: detailCard.hasVideo } : {}),
    ...(typeof detailCard.aspectRatio === "number" ? { aspectRatio: detailCard.aspectRatio } : {}),
    ...(typeof detailCard.width === "number" ? { width: detailCard.width } : {}),
    ...(typeof detailCard.height === "number" ? { height: detailCard.height } : {}),
    ...(typeof detailCard.resizeMode === "string" ? { resizeMode: detailCard.resizeMode } : {}),
    ...(typeof detailCard.assetCount === "number" ? { assetCount: detailCard.assetCount } : {}),
    ...(typeof detailCard.hasMultipleAssets === "boolean" ? { hasMultipleAssets: detailCard.hasMultipleAssets } : {}),
    ...(typeof detailCard.rawFirestoreAssetCount === "number" ? { rawFirestoreAssetCount: detailCard.rawFirestoreAssetCount } : {}),
    ...(typeof detailCard.photoLink === "string" ? { photoLink: detailCard.photoLink } : {}),
    ...(typeof detailCard.displayPhotoLink === "string" ? { displayPhotoLink: detailCard.displayPhotoLink } : {}),
    ...(typeof detailCard.derivedAssetCount === "number" ? { derivedAssetCount: detailCard.derivedAssetCount } : {}),
    ...(detailCard.mediaCompleteness === "cover_only" ? { mediaCompleteness: "cover_only" as const } : {}),
    ...(detailCard.requiresAssetHydration === true ? { requiresAssetHydration: true } : {}),
    ...(detailCard.appPostAttached === true ? { appPostAttached: true } : {}),
    ...(typeof detailCard.appPostWireAssetCount === "number" ? { appPostWireAssetCount: detailCard.appPostWireAssetCount } : {}),
    ...(typeof detailCard.wireDeclaredMediaAssetCount === "number"
      ? { wireDeclaredMediaAssetCount: detailCard.wireDeclaredMediaAssetCount }
      : {}),
  };
  const firstAsset = seed.card.assets?.[0];
  const posterUrl = seed.card.media.posterUrl || firstAsset?.posterUrl || "";
  /** When false, mp4/firstAssetUrl may be the raw upload — do not pretend it is ladder main720. */
  const cardClaimsTranscodesReady = seed.card.assetsReady === true;
  const shellAssets: PlaybackPostShellDTO["assets"] =
    seed.card.assets && seed.card.assets.length > 0
      ? seed.card.assets.map((asset) => {
          const thumb = asset.posterUrl || posterUrl || "";
          const original =
            asset.type === "video"
              ? asset.mp4Url ?? asset.originalUrl ?? asset.previewUrl ?? null
              : asset.originalUrl ?? asset.previewUrl ?? null;
          const baseVariants =
            asset.variants && typeof asset.variants === "object" ? { ...asset.variants } : {};
          return {
            id: asset.id,
            type: asset.type,
            original,
            poster: asset.posterUrl || thumb || null,
            thumbnail: asset.posterUrl || thumb || null,
            aspectRatio: asset.aspectRatio ?? undefined,
            width: asset.width ?? undefined,
            height: asset.height ?? undefined,
            orientation: asset.orientation ?? undefined,
            variants: {
              ...baseVariants,
              ...(asset.previewUrl
                ? { preview360: asset.previewUrl, preview360Avc: asset.previewUrl }
                : {}),
              ...(asset.streamUrl ? { hls: asset.streamUrl } : {}),
              ...(cardClaimsTranscodesReady &&
              asset.mp4Url &&
              asset.previewUrl &&
              cleanString(asset.mp4Url) === cleanString(asset.previewUrl)
                ? {}
                : cardClaimsTranscodesReady && asset.mp4Url
                  ? { main720Avc: asset.mp4Url, main720: asset.mp4Url }
                  : {}),
            },
          };
        })
      : [
          {
            id: firstAsset?.id ?? `${seed.card.postId}-asset-1`,
            type: seed.card.media.type,
            original:
              firstAsset?.mp4Url ??
              firstAsset?.originalUrl ??
              seed.card.firstAssetUrl ??
              null,
            poster: posterUrl || null,
            thumbnail: posterUrl || null,
            aspectRatio: firstAsset?.aspectRatio ?? seed.card.media.aspectRatio,
            width: firstAsset?.width ?? undefined,
            height: firstAsset?.height ?? undefined,
            orientation: firstAsset?.orientation ?? undefined,
            variants: {
              ...(firstAsset?.previewUrl
                ? { preview360: firstAsset.previewUrl, preview360Avc: firstAsset.previewUrl }
                : {}),
              ...(firstAsset?.streamUrl ? { hls: firstAsset.streamUrl } : {}),
              ...(cardClaimsTranscodesReady &&
              firstAsset?.mp4Url &&
              firstAsset?.previewUrl &&
              cleanString(firstAsset.mp4Url) === cleanString(firstAsset.previewUrl)
                ? {}
                : cardClaimsTranscodesReady && firstAsset?.mp4Url
                  ? { main720Avc: firstAsset.mp4Url, main720: firstAsset.mp4Url }
                  : {}),
            },
          },
        ];
  return {
    postId: seed.card.postId,
    userId: cleanString(seed.userId) ?? seed.card.author.userId,
    caption: seed.card.captionPreview,
    title: seed.card.title,
    activities: seed.card.activities ?? [],
    address: seed.card.address ?? null,
    lat: seed.card.geo?.lat ?? null,
    lng: seed.card.geo?.long ?? null,
    mediaType: seed.card.media.type,
    thumbUrl: posterUrl,
    createdAtMs: seed.card.createdAtMs,
    updatedAtMs: seed.card.updatedAtMs,
    assetsReady: seed.card.assetsReady === true,
    assets: shellAssets,
    cardSummary: trimmedCardSummary,
    ...(typeof seed.card.assetCount === "number" ? { assetCount: seed.card.assetCount } : {}),
    ...(seed.card.hasMultipleAssets === true ? { hasMultipleAssets: true } : {}),
    ...(typeof seed.card.rawFirestoreAssetCount === "number" &&
    Number.isFinite(seed.card.rawFirestoreAssetCount)
      ? { rawFirestoreAssetCount: Math.floor(seed.card.rawFirestoreAssetCount) }
      : {}),
    ...(seed.card.mediaCompleteness === "cover_only"
      ? { mediaCompleteness: "cover_only" as const }
      : {}),
    ...(seed.card.requiresAssetHydration === true ? { requiresAssetHydration: true } : {}),
    ...(cleanString(seed.card.photoLink) != null ? { photoLink: cleanString(seed.card.photoLink) } : {}),
    ...(cleanString(seed.card.displayPhotoLink) != null ? { displayPhotoLink: cleanString(seed.card.displayPhotoLink) } : {}),
  };
}

export function toMapMarkerCompactDTO(seed: {
  id: string;
  postId: string;
  lat: number;
  lng: number;
  activity?: string | null;
  activities?: string[] | null;
  title?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  visibility?: string | null;
  ownerId?: string | null;
  thumbnailUrl?: string | null;
  thumbKey?: string | null;
  followedUserPic?: string | null;
  hasPhoto?: boolean;
  hasVideo?: boolean;
}): MapMarkerCompactDTO {
  return {
    id: seed.id,
    postId: seed.postId,
    lat: seed.lat,
    lng: seed.lng,
    activity: cleanString(seed.activity),
    activities: cleanStringArray(seed.activities, 1),
    thumbnailUrl: cleanString(seed.thumbnailUrl),
    hasPhoto: cleanBool(seed.hasPhoto),
    hasVideo: cleanBool(seed.hasVideo),
  };
}

export function toProfileHeaderDTO(seed: {
  userId: string;
  handle?: string | null;
  name?: string | null;
  profilePic?: string | null;
  profilePicSmallPath?: string | null;
  profilePicLargePath?: string | null;
  bio?: string | null;
  updatedAtMs?: number | null;
  profileVersion?: string | null;
  counts?: {
    posts?: number | null;
    followers?: number | null;
    following?: number | null;
  } | null;
}): ProfileHeaderDTO {
  const handle = cleanString(seed.handle)?.replace(/^@+/, "") ?? seed.userId;
  return {
    userId: seed.userId,
    handle,
    name: cleanString(seed.name) ?? handle,
    profilePic: cleanString(seed.profilePic),
    profilePicSmallPath: cleanString(seed.profilePicSmallPath),
    profilePicLargePath: cleanString(seed.profilePicLargePath),
    bio: cleanString(seed.bio),
    updatedAtMs: cleanNumber(seed.updatedAtMs),
    profileVersion: cleanString(seed.profileVersion),
    counts: {
      posts: Math.max(0, Math.floor(cleanNumber(seed.counts?.posts) ?? 0)),
      followers: Math.max(0, Math.floor(cleanNumber(seed.counts?.followers) ?? 0)),
      following: Math.max(0, Math.floor(cleanNumber(seed.counts?.following) ?? 0)),
    },
  };
}

export function listForbiddenCompactFieldViolations(value: unknown): DiagnosticWalkIssue[] {
  const issues: DiagnosticWalkIssue[] = [];
  const isAppPostProjectionPath = (p: string) =>
    p === "appPost" ||
    p.startsWith("appPost.") ||
    p.endsWith(".appPost") ||
    p.includes(".appPost.") ||
    p === "appPostV2" ||
    p.startsWith("appPostV2.") ||
    p.endsWith(".appPostV2") ||
    p.includes(".appPostV2.") ||
    p === "canonicalPost" ||
    p.startsWith("canonicalPost.") ||
    p.endsWith(".canonicalPost") ||
    p.includes(".canonicalPost.") ||
    p === "post" ||
    p.startsWith("post.") ||
    p.endsWith(".post") ||
    p.includes(".post.");
  const visit = (current: unknown, path: string) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      const nextPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();
      const skipSubstringGuard = isAppPostProjectionPath(nextPath);
      if (
        FORBIDDEN_FIELD_NAMES.has(key) ||
        (!skipSubstringGuard && FORBIDDEN_PATH_PARTS.some((part) => lowerKey.includes(part)))
      ) {
        issues.push({ path: nextPath, reason: "forbidden_field" });
      }
      if (typeof entry === "string" && entry.length > 512) {
        issues.push({ path: nextPath, reason: "oversized_string" });
      }
      if (Array.isArray(entry) && entry.length > 8) {
        issues.push({ path: nextPath, reason: "oversized_array" });
      }
      visit(entry, nextPath);
    }
  };
  visit(value, "");
  return issues;
}
