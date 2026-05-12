import type { NormalizedPostAssetsResult } from "../../contracts/post-assets.contract.js";
import { normalizePostAssets, normalizedAssetsToEnvelopeRows } from "../../contracts/post-assets.contract.js";
import { isBackendAppPostV2ResponsesEnabled } from "./app-post-v2/flags.js";
import { toAppPostV2FromAny } from "./app-post-v2/toAppPostV2.js";
import {
  buildSafeDisplayTextBlock,
  sanitizeHydratedPostDisplayText,
  type PostDocLike,
} from "./displayText.js";

type PostRecord = Record<string, unknown>;

export type PostEnvelopeHydrationLevel = "card" | "detail" | "marker";

export type BuildPostEnvelopeInput<TSeed extends PostRecord = PostRecord> = {
  postId?: string | null;
  seed?: TSeed | null;
  sourcePost?: PostRecord | null;
  rawPost?: PostRecord | null;
  hydrationLevel: PostEnvelopeHydrationLevel;
  sourceRoute?: string;
  rankToken?: string | null;
  viewer?: PostRecord | null;
  author?: PostRecord | null;
  social?: PostRecord | null;
  debugSource?: string | null;
};

function asRecord(value: unknown): PostRecord | null {
  return value && typeof value === "object" ? (value as PostRecord) : null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") {
          const record = entry as PostRecord;
          return pickString(record.id, record.slug, record.key, record.name, record.label) ?? "";
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function serializeUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((entry) => serializeUnknown(entry));
  if (value instanceof Date) return { __type: "date", iso: value.toISOString() };
  if (typeof value === "object") {
    const record = value as PostRecord & {
      toMillis?: () => number;
      seconds?: unknown;
      _seconds?: unknown;
      nanoseconds?: unknown;
      _nanoseconds?: unknown;
    };
    if (typeof record.toMillis === "function") {
      const millis = record.toMillis();
      return Number.isFinite(millis)
        ? {
            __type: "firestore_timestamp",
            millis: Math.floor(millis),
            seconds:
              typeof record.seconds === "number"
                ? record.seconds
                : typeof record._seconds === "number"
                  ? record._seconds
                  : undefined,
            nanoseconds:
              typeof record.nanoseconds === "number"
                ? record.nanoseconds
                : typeof record._nanoseconds === "number"
                  ? record._nanoseconds
                  : undefined,
          }
        : null;
    }
    const out: PostRecord = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = serializeUnknown(entry);
    }
    return out;
  }
  return value;
}

function normalizeMillis(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 10_000_000_000 ? value : value * 1000);
  }
  if (value && typeof value === "object") {
    const record = value as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown };
    if (typeof record.toMillis === "function") {
      const millis = record.toMillis();
      if (Number.isFinite(millis)) return Math.floor(millis);
    }
    const seconds =
      typeof record.seconds === "number"
        ? record.seconds
        : typeof record._seconds === "number"
          ? record._seconds
          : null;
    if (seconds != null && Number.isFinite(seconds)) return Math.floor(seconds * 1000);
  }
  return fallback;
}

function normalizeNullableString(value: unknown): string | null {
  return pickString(value) ?? null;
}

function normalizeMediaType(source: PostRecord): "image" | "video" {
  const top = pickString(source.mediaType, source.type);
  if (top === "video") return "video";
  if (Array.isArray(source.assets)) {
    for (const entry of source.assets) {
      const asset = asRecord(entry);
      if (!asset) continue;
      if (pickString(asset.type, asset.mediaType) === "video") return "video";
    }
  }
  return "image";
}

function firstMediaUrlFromCommaField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);
}

function resolveGeo(source: PostRecord): {
  lat: number | null;
  long: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  geohash: string | null;
} {
  const location = asRecord(source.location) ?? {};
  const coordinates = asRecord(source.coordinates) ?? {};
  const geo = asRecord(source.geoData) ?? asRecord(source.geo) ?? {};
  const geoPoint = asRecord(geo.geopoint) ?? {};
  return {
    lat:
      pickNumber(
        source.lat,
        source.latitude,
        location.lat,
        location.latitude,
        coordinates.lat,
        coordinates.latitude,
        geoPoint.latitude,
      ) ?? null,
    long:
      pickNumber(
        source.long,
        source.lng,
        source.longitude,
        location.long,
        location.lng,
        location.longitude,
        coordinates.long,
        coordinates.lng,
        coordinates.longitude,
        geoPoint.longitude,
      ) ?? null,
    address: normalizeNullableString(source.address ?? location.address ?? geo.address),
    city: normalizeNullableString(source.city ?? location.city ?? geo.city),
    state: normalizeNullableString(source.state ?? location.state ?? geo.state),
    country: normalizeNullableString(source.country ?? location.country ?? geo.country),
    geohash: normalizeNullableString(source.geohash ?? geo.geohash),
  };
}

function normalizeEmbeddedComment(entry: unknown): PostRecord | null {
  const comment = asRecord(entry);
  if (!comment) return null;
  const id = pickString(comment.id, comment.commentId);
  if (!id) return null;
  const content =
    pickString(comment.content, comment.text, comment.body, comment.comment, comment.message, comment.caption) ?? "";
  return {
    ...comment,
    id,
    commentId: id,
    content,
    text: content,
    userId: pickString(comment.userId) ?? "",
    userName: normalizeNullableString(comment.userName),
    userHandle: normalizeNullableString(comment.userHandle),
    userPic: normalizeNullableString(comment.userPic),
    time: comment.time ?? comment.createdAt ?? comment.createdAtMs ?? null,
    createdAt: comment.createdAt ?? comment.time ?? comment.createdAtMs ?? null,
    createdAtMs: pickNumber(comment.createdAtMs, comment.time) ?? null,
    likedBy: Array.isArray(comment.likedBy)
      ? comment.likedBy.filter((value): value is string => typeof value === "string")
      : [],
    replies: Array.isArray(comment.replies) ? comment.replies : [],
  };
}

function normalizeCommentsPreview(source: PostRecord): PostRecord[] {
  const preview = Array.isArray(source.commentsPreview) ? source.commentsPreview : [];
  const embedded = Array.isArray(source.comments) ? source.comments : [];
  const previewRows = preview.map((entry) => normalizeEmbeddedComment(entry)).filter((row): row is PostRecord => row != null);
  const embeddedRows = embedded.map((entry) => normalizeEmbeddedComment(entry)).filter((row): row is PostRecord => row != null);
  if (previewRows.length > 0) return previewRows;
  return embeddedRows;
}

function normalizeCommentCount(source: PostRecord, commentsPreview: PostRecord[]): number {
  return Math.max(
    0,
    Math.floor(
      pickNumber(
        source.commentCount,
        source.commentsCount,
        asRecord(source.social)?.commentCount,
        asRecord(source.counts)?.commentCount,
      ) ?? commentsPreview.length,
    ),
  );
}

function resolveEnvelopeAssets(
  sourcePost: PostRecord,
  postId: string,
  _mediaType: "image" | "video",
  route?: string | null,
): { assets: PostRecord[]; normalization: NormalizedPostAssetsResult } {
  const normalization = normalizePostAssets(sourcePost, {
    postId,
    devDiagnostics: process.env.NODE_ENV !== "production",
    route: route ?? null,
  });
  const rows = normalizedAssetsToEnvelopeRows(normalization.assets);
  const rawAssets = Array.isArray(sourcePost.assets) ? sourcePost.assets : [];
  const assets = rows.map((row, index) => {
    const rawEntry = asRecord(rawAssets[index]);
    if (!rawEntry) return row;
    return { ...rawEntry, ...row };
  });
  return { assets, normalization };
}

function resolveCaption(source: PostRecord): string | null {
  const safe = buildSafeDisplayTextBlock(source as PostDocLike);
  return (
    normalizeNullableString(safe.caption) ??
    normalizeNullableString(safe.description) ??
    normalizeNullableString(safe.content)
  );
}

/** Drop bulky Firestore-shaped fields from assets for card/marker responses (payload budget / map bootstrap). */
function slimEnvelopeAssetsForListHydration(assets: PostRecord[]): PostRecord[] {
  return assets.map((asset) => {
    const a = asset as Record<string, unknown>;
    const {
      variants: _variants,
      variantMetadata: _variantMetadata,
      playbackLab: _playbackLab,
      codecs: _codecs,
      generated: _generated,
      ...rest
    } = a;
    return rest as PostRecord;
  });
}

export function buildPostEnvelope<TSeed extends PostRecord = PostRecord>(
  input: BuildPostEnvelopeInput<TSeed>,
): TSeed & PostRecord {
  const embedFullFirestoreDocs = input.hydrationLevel === "detail";
  const rawPost: PostRecord = (input.rawPost ?? input.sourcePost ?? input.seed ?? {}) as PostRecord;
  const seed: PostRecord = (input.seed ?? {}) as PostRecord;
  const sourcePost: PostRecord = (input.sourcePost ?? rawPost) as PostRecord;
  const resolvedPostId =
    pickString(input.postId, seed.postId, seed.id, sourcePost.postId, sourcePost.id, rawPost.postId, rawPost.id) ?? "";
  const mediaType = normalizeMediaType(sourcePost);
  const { assets: resolvedAssets, normalization: mediaNormalization } = resolveEnvelopeAssets(
    sourcePost,
    resolvedPostId,
    mediaType,
    input.sourceRoute ?? null,
  );
  const rawAssetRows = Array.isArray(sourcePost.assets)
    ? (sourcePost.assets as unknown[]).filter((entry) => entry != null && typeof entry === "object")
    : [];
  const rawFirestoreAssetCount = Math.min(64, rawAssetRows.length);
  const assets = embedFullFirestoreDocs ? resolvedAssets : slimEnvelopeAssetsForListHydration(resolvedAssets);
  const normalizedLen = assets.length;
  /** Serialized postcard carries fewer carousel rows than the Firestore `assets[]` count. */
  const carouselHydrationIncomplete =
    rawFirestoreAssetCount >= 2 && normalizedLen < rawFirestoreAssetCount;
  const firstAsset = assets[0] ?? null;
  const commentsPreview = normalizeCommentsPreview(sourcePost);
  const geo = resolveGeo(sourcePost);
  const createdAtMs = normalizeMillis(
    seed.createdAtMs ?? sourcePost.createdAtMs ?? sourcePost.time ?? sourcePost.createdAt ?? sourcePost.updatedAt,
  );
  const updatedAtMs = normalizeMillis(
    seed.updatedAtMs ?? sourcePost.updatedAtMs ?? sourcePost.lastUpdated ?? sourcePost.updatedAt ?? sourcePost.time ?? sourcePost.createdAt,
    createdAtMs,
  );
  const authorSeed = input.author ?? asRecord(seed.author) ?? {};
  const author = {
    ...(authorSeed ?? {}),
    userId:
      pickString(authorSeed.userId, seed.userId, seed.authorId, sourcePost.userId, sourcePost.authorId) ?? "",
    handle:
      pickString(authorSeed.handle, seed.userHandle, seed.handle, sourcePost.userHandle, sourcePost.handle) ?? "",
    name:
      normalizeNullableString(authorSeed.name ?? seed.userName ?? sourcePost.userName ?? sourcePost.displayName),
    pic:
      normalizeNullableString(authorSeed.pic ?? seed.userPic ?? sourcePost.userPic ?? sourcePost.profilePic ?? sourcePost.photo),
  };
  const socialSeed = input.social ?? asRecord(seed.social) ?? asRecord(seed.counts) ?? {};
  const likeCount = Math.max(
    0,
    Math.floor(
      pickNumber(
        socialSeed.likeCount,
        socialSeed.likesCount,
        seed.likeCount,
        seed.likesCount,
        sourcePost.likeCount,
        sourcePost.likesCount,
      ) ?? 0,
    ),
  );
  const commentCount = normalizeCommentCount({ ...sourcePost, ...socialSeed }, commentsPreview);
  const viewer = {
    ...(input.viewer ?? asRecord(seed.viewer) ?? {}),
    liked:
      pickBoolean(
        asRecord(input.viewer)?.liked,
        asRecord(seed.viewer)?.liked,
        seed.viewerHasLiked,
        seed.liked,
        sourcePost.viewerHasLiked,
      ) ?? false,
    saved:
      pickBoolean(
        asRecord(input.viewer)?.saved,
        asRecord(seed.viewer)?.saved,
        seed.viewerHasSaved,
        seed.saved,
        sourcePost.viewerHasSaved,
      ) ?? false,
  };
  const posterUrl =
    pickString(
      seed.thumbUrl,
      seed.displayPhotoLink,
      seed.photoLink,
      firstAsset?.posterUrl,
      firstAsset?.poster,
      sourcePost.poster,
      sourcePost.posterUrl,
      sourcePost.displayPhotoLink,
      sourcePost.thumbUrl,
      firstMediaUrlFromCommaField(sourcePost.photoLinks2),
      firstMediaUrlFromCommaField(sourcePost.photoLinks3),
      sourcePost.photoLink,
    ) ?? null;
  const hasPlayableVideo = assets.some((asset) => {
    if (asset.type !== "video") return false;
    return Boolean(pickString(asset.streamUrl, asset.mp4Url, asset.originalUrl, asset.original));
  });
  const normalizedCard = {
    postId: resolvedPostId,
    rankToken: pickString(input.rankToken, seed.rankToken) ?? `post-${resolvedPostId}`,
    author,
    activities: stringArray(seed.activities ?? sourcePost.activities),
    address: geo.address,
    carouselFitWidth: pickBoolean(seed.carouselFitWidth, sourcePost.carouselFitWidth),
    layoutLetterbox: pickBoolean(seed.layoutLetterbox, sourcePost.layoutLetterbox),
    letterboxGradientTop:
      normalizeNullableString(seed.letterboxGradientTop ?? seed.letterbox_gradient_top ?? sourcePost.letterboxGradientTop ?? sourcePost.letterbox_gradient_top),
    letterboxGradientBottom:
      normalizeNullableString(seed.letterboxGradientBottom ?? seed.letterbox_gradient_bottom ?? sourcePost.letterboxGradientBottom ?? sourcePost.letterbox_gradient_bottom),
    letterboxGradients:
      Array.isArray(seed.letterboxGradients)
        ? seed.letterboxGradients
        : Array.isArray(sourcePost.letterboxGradients)
          ? sourcePost.letterboxGradients
          : undefined,
    geo: {
      lat: geo.lat,
      long: geo.long,
      city: geo.city,
      state: geo.state,
      country: geo.country,
      geohash: geo.geohash,
    },
    assets,
    title: normalizeNullableString(seed.title ?? sourcePost.title),
    description: normalizeNullableString(seed.description ?? sourcePost.description),
    captionPreview: resolveCaption(seed) ?? resolveCaption(sourcePost),
    firstAssetUrl:
      normalizeNullableString(seed.firstAssetUrl ?? firstAsset?.originalUrl ?? firstAsset?.previewUrl ?? firstAsset?.posterUrl),
    media: {
      type: mediaType,
      posterUrl,
      aspectRatio: pickNumber(firstAsset?.aspectRatio, seed.aspectRatio, sourcePost.aspectRatio) ?? 1,
      startupHint: mediaType === "video" ? "poster_then_preview" : "poster_only",
    },
    social: {
      likeCount,
      commentCount,
    },
    viewer,
    createdAtMs,
    updatedAtMs,
    comments: Array.isArray(sourcePost.comments) ? commentsPreview : undefined,
    commentsPreview,
  };

  const sourceRoute =
    input.sourceRoute ??
    pickString(seed.sourceRoute, seed.__sourceRoute, sourcePost.sourceRoute, sourcePost.__sourceRoute);
  const firestoreDocSpread = embedFullFirestoreDocs
    ? ({
        ...(serializeUnknown(rawPost) as PostRecord),
        ...(serializeUnknown(sourcePost) as PostRecord),
      } as PostRecord)
    : ({} as PostRecord);
  const envelope: PostRecord = {
    ...firestoreDocSpread,
    ...seed,
    ...normalizedCard,
    id: resolvedPostId,
    postId: resolvedPostId,
    userId: pickString(seed.userId, sourcePost.userId, author.userId) ?? "",
    authorId: author.userId,
    userHandle: author.handle,
    userName: author.name,
    userPic: author.pic,
    mediaType,
    thumbUrl: posterUrl,
    displayPhotoLink:
      pickString(
        seed.displayPhotoLink,
        sourcePost.displayPhotoLink,
        mediaNormalization.displayPhotoLink ?? undefined,
        posterUrl,
      ) ?? posterUrl,
    photoLink:
      pickString(seed.photoLink, sourcePost.photoLink, mediaNormalization.photoLink ?? undefined, posterUrl) ??
      posterUrl,
    posterUrl,
    assetCount: carouselHydrationIncomplete
      ? Math.max(rawFirestoreAssetCount, mediaNormalization.assetCount)
      : mediaNormalization.assetCount,
    hasMultipleAssets:
      carouselHydrationIncomplete ||
      rawFirestoreAssetCount > 1 ||
      mediaNormalization.hasMultipleAssets ||
      mediaNormalization.assetCount > 1,
    /** Cheap hint for hydration / batch carousel probes — Firestore-backed `assets[]` length clamped at 64. */
    rawFirestoreAssetCount,
    mediaCompleteness: carouselHydrationIncomplete ? ("cover_only" as const) : ("full" as const),
    requiresAssetHydration: carouselHydrationIncomplete,
    assets,
    caption: resolveCaption(seed) ?? resolveCaption(sourcePost),
    content: resolveCaption(seed) ?? resolveCaption(sourcePost),
    counts: {
      ...(asRecord(seed.counts) ?? {}),
      likeCount,
      likesCount: likeCount,
      commentCount,
    },
    likeCount,
    likesCount: likeCount,
    commentCount,
    commentsCount: commentCount,
    comments: Array.isArray(sourcePost.comments) ? commentsPreview : seed.comments,
    commentsPreview,
    hydrationLevel: input.hydrationLevel,
    normalizedCard,
    normalizedMedia: {
      mediaType,
      assets,
      firstAssetUrl: normalizedCard.firstAssetUrl,
      posterUrl,
      hasPlayableVideo,
      playableVideoUrl:
        pickString(
          firstAsset?.streamUrl,
          firstAsset?.mp4Url,
          firstAsset?.originalUrl,
          firstAsset?.original,
        ) ?? null,
    },
    normalizedAuthor: author,
    normalizedLocation: {
      address: geo.address,
      lat: geo.lat,
      long: geo.long,
      city: geo.city,
      state: geo.state,
      country: geo.country,
      geohash: geo.geohash,
    },
    normalizedCounts: {
      likeCount,
      commentCount,
    },
    hasPlayableVideo,
    hasAssetsArray: Array.isArray(sourcePost.assets),
    hasRawPost: embedFullFirestoreDocs,
    hasEmbeddedComments: commentsPreview.length > 0,
    mediaResolutionSource:
      hasPlayableVideo
        ? "playable_asset"
        : posterUrl
          ? "poster_only"
          : "none",
    rawPost: embedFullFirestoreDocs ? (serializeUnknown(rawPost) as PostRecord) : null,
    sourcePost: embedFullFirestoreDocs ? (serializeUnknown(sourcePost) as PostRecord) : null,
  };

  if (geo.lat != null) envelope.lat = geo.lat;
  if (geo.long != null) envelope.long = geo.long;
  if (geo.address != null) envelope.address = geo.address;
  envelope.coordinates = {
    lat: geo.lat,
    lng: geo.long,
  };
  envelope.geoData = {
    city: geo.city,
    state: geo.state,
    country: geo.country,
    geohash: geo.geohash,
  };
  envelope.author = author;
  envelope.user = {
    ...(asRecord(seed.user) ?? {}),
    userId: author.userId,
    handle: author.handle,
    name: author.name,
    pic: author.pic,
    profilePic: author.pic,
  };
  if (mediaNormalization.diagnostics && process.env.NODE_ENV !== "production") {
    const uniqueUri = new Set(mediaNormalization.assets.map((a) => a.displayUri).filter(Boolean)).size;
    envelope.mediaDiagnostics = {
      route: input.sourceRoute ?? sourceRoute ?? null,
      postId: resolvedPostId,
      rawAssetCount: mediaNormalization.diagnostics.rawAssetCount ?? null,
      normalizedAssetCount: mediaNormalization.assetCount,
      uniqueUriCount: uniqueUri,
      source: mediaNormalization.diagnostics.source,
      warnings: mediaNormalization.diagnostics.warnings,
    };
  }

  if (sourceRoute && process.env.NODE_ENV !== "production") {
    envelope.sourceRoute = sourceRoute;
    envelope.debugPostEnvelope = {
      sourceRoute,
      hydrationLevel: input.hydrationLevel,
      debugSource: input.debugSource ?? null,
    };
  } else if (sourceRoute) {
    envelope.sourceRoute = sourceRoute;
  }

  try {
    if (isBackendAppPostV2ResponsesEnabled()) {
      const rawForApp = { ...sourcePost, id: resolvedPostId, postId: resolvedPostId } as Record<string, unknown>;
      envelope.appPost = toAppPostV2FromAny(rawForApp, {
        postId: resolvedPostId,
        viewerState: {
          liked: viewer.liked,
          saved: viewer.saved,
          savedCollectionIds: [],
          followsAuthor: false
        }
      }) as unknown as PostRecord;
      envelope.postContractVersion = 2;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      envelope.appPostBuildError = error instanceof Error ? error.message : String(error);
    }
  }

  sanitizeHydratedPostDisplayText(envelope as PostDocLike, {
    route: input.sourceRoute ?? "buildPostEnvelope",
    postId: resolvedPostId,
  });

  return envelope as TSeed & PostRecord;
}
