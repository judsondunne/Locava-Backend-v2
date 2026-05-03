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
};

export type FeedCardDTO = {
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
  max = 1
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
    ...(asset.variants && typeof asset.variants === "object" && Object.keys(asset.variants).length > 0
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

export function toFeedCardDTO(seed: CompactCardSeed): FeedCardDTO {
  const assetCap =
    typeof seed.compactAssetLimit === "number" &&
    Number.isFinite(seed.compactAssetLimit) &&
    seed.compactAssetLimit > 0
      ? Math.min(24, Math.floor(seed.compactAssetLimit))
      : 1;
  const assets = toCompactAssets(seed.assets, assetCap) ?? [];
  const firstAsset = assets[0];
  const posterUrl = cleanString(seed.media.posterUrl) ?? firstAsset?.posterUrl ?? "";
  return {
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
    viewer: {
      liked: cleanBool(seed.viewer?.liked),
      saved: cleanBool(seed.viewer?.saved),
    },
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
  };
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
    cardSummary: seed.card,
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
  const visit = (current: unknown, path: string) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      const nextPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_FIELD_NAMES.has(key) || FORBIDDEN_PATH_PARTS.some((part) => lowerKey.includes(part))) {
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
