import { selectBestVideoPlaybackAsset, type SelectedCanonicalVideoVariant } from "./video-playback-selection.js";
import { isLikelyPublicFinalImageUrl, isPendingPlaceholderUrl } from "../../services/posting/photo-url-guards.js";

type PostRecord = Record<string, unknown>;

export type MediaStatus = "processing" | "ready" | "failed";

export type PostMediaReadiness = {
  mediaStatus: MediaStatus;
  assetsReady: boolean;
  videoProcessingStatus?: string;
  posterReady: boolean;
  posterPresent: boolean;
  posterUrl?: string;
  playbackReady: boolean;
  playbackUrlPresent: boolean;
  playbackUrl?: string;
  fallbackVideoUrl?: string;
  instantPlaybackReady: boolean;
  hasVideo: boolean;
  aspectRatio?: number | null;
  width?: number | null;
  height?: number | null;
  resizeMode: "cover" | "contain";
  gradientTop?: string | null;
  gradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  updatedAtMs?: number | null;
  mediaUpdatedAtMs?: number | null;
  /** When true, visible playback is still preview-tier only (no ladder encode yet). */
  usedPreviewFallback?: boolean;
  /** Distinct ladder / HLS / startup encode is selected (not original-only / preview). */
  productionPlaybackSelected?: boolean;
  selectedVideoVariant?: SelectedCanonicalVideoVariant;
  selectedVideoQualityRank?: number;
  isDegradedVideo?: boolean;
  /** Processing pipeline not finished yet, but HTTPS playback bytes are usable now. */
  processingButPlayable?: boolean;
};

function asRecord(value: unknown): PostRecord | null {
  return value && typeof value === "object" ? (value as PostRecord) : null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | null | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readMaybeMillis(value: unknown): number | null {
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
    if (seconds != null && Number.isFinite(seconds)) {
      return Math.floor(seconds * 1000);
    }
  }
  return null;
}

function normalizeLetterboxGradients(
  post: PostRecord,
): { gradientTop?: string | null; gradientBottom?: string | null; letterboxGradients?: Array<{ top: string; bottom: string }> } {
  const legacy = asRecord(post.legacy);
  const gradientTop =
    pickString(
      post.letterboxGradientTop,
      post.letterbox_gradient_top,
      legacy?.letterboxGradientTop,
      legacy?.letterbox_gradient_top,
    ) ?? null;
  const gradientBottom =
    pickString(
      post.letterboxGradientBottom,
      post.letterbox_gradient_bottom,
      legacy?.letterboxGradientBottom,
      legacy?.letterbox_gradient_bottom,
    ) ?? null;
  const gradientsRaw = Array.isArray(post.letterboxGradients)
    ? post.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? legacy?.letterboxGradients
      : null;
  if (!Array.isArray(gradientsRaw)) {
    return { gradientTop, gradientBottom };
  }
  const letterboxGradients = gradientsRaw
    .map((entry) => {
      const row = asRecord(entry);
      const top = pickString(row?.top);
      const bottom = pickString(row?.bottom);
      if (!top || !bottom) return null;
      return { top, bottom };
    })
    .filter((row): row is { top: string; bottom: string } => row != null);
  return {
    gradientTop,
    gradientBottom,
    ...(letterboxGradients.length > 0 ? { letterboxGradients } : {}),
  };
}

function resolveResizeMode(post: PostRecord): "cover" | "contain" {
  if (pickBoolean(post.carouselFitWidth) === true) return "contain";
  if (pickBoolean(post.layoutLetterbox) === true) return "contain";
  const gradients = normalizeLetterboxGradients(post);
  if (gradients.gradientTop || gradients.gradientBottom || gradients.letterboxGradients?.length) {
    return "contain";
  }
  return "cover";
}

export function buildPostMediaReadiness(
  postLike: Record<string, unknown> | null | undefined,
  opts?: { hydrationMode?: "card" | "playback" | "detail" | "open" | "full"; preferHlsFirst?: boolean },
): PostMediaReadiness {
  const post = asRecord(postLike) ?? {};
  const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];
  const firstVideo = assets.find((asset) => pickString(asset?.type, asset?.mediaType) === "video") ?? null;
  const appPost = asRecord(post.appPostV2) ?? asRecord(post.appPost);
  const appPostAssets =
    Array.isArray(asRecord(appPost?.media)?.assets) ? ((asRecord(appPost?.media)?.assets ?? []) as PostRecord[]) : [];
  const firstCanonicalVideo =
    appPostAssets.find((asset) => pickString(asset?.type, asset?.mediaType) === "video") ?? null;
  const hasVideo = firstVideo != null || pickString(post.mediaType) === "video";
  const posterUrl = pickString(firstVideo?.poster, firstVideo?.thumbnail, asRecord(firstVideo?.variants)?.poster);

  if (!hasVideo) {
    const firstImage = assets.find((asset) => pickString(asset?.type, asset?.mediaType) === "image") ?? null;
    const coverUrl = pickString(
      firstImage?.original,
      firstImage?.thumbnail,
      post.displayPhotoLink,
      post.photoLink,
      post.thumbUrl
    );
    const coverReady = Boolean(coverUrl && isLikelyPublicFinalImageUrl(coverUrl) && !isPendingPlaceholderUrl(coverUrl));
    const persistedAssetsReady = pickBoolean(post.assetsReady) === true;
    const imageStatus = pickString(post.imageProcessingStatus);
    const gradients = normalizeLetterboxGradients(post);
    return {
      mediaStatus: coverReady && persistedAssetsReady && imageStatus !== "pending" ? "ready" : "processing",
      assetsReady: coverReady && persistedAssetsReady,
      posterReady: Boolean(posterUrl),
      posterPresent: Boolean(posterUrl),
      ...(posterUrl ? { posterUrl } : {}),
      playbackReady: false,
      playbackUrlPresent: false,
      instantPlaybackReady: false,
      hasVideo: false,
      aspectRatio: pickNumber(assets[0]?.aspectRatio) ?? null,
      width: pickNumber(assets[0]?.width) ?? null,
      height: pickNumber(assets[0]?.height) ?? null,
      resizeMode: resolveResizeMode(post),
      ...(gradients.gradientTop ? { gradientTop: gradients.gradientTop } : {}),
      ...(gradients.gradientBottom ? { gradientBottom: gradients.gradientBottom } : {}),
      ...(gradients.letterboxGradients ? { letterboxGradients: gradients.letterboxGradients } : {}),
      updatedAtMs:
        readMaybeMillis(post.updatedAtMs ?? post.lastUpdated ?? post.updatedAt ?? post.time) ?? null,
      mediaUpdatedAtMs:
        readMaybeMillis(post.playbackLabUpdatedAt ?? post.updatedAtMs ?? post.lastUpdated ?? post.updatedAt) ?? null,
    };
  }

  const canonicalReadiness = asRecord(firstCanonicalVideo?.video)?.readiness as PostRecord | null;
  const instantPlaybackReady =
    pickBoolean(
      canonicalReadiness?.instantPlaybackReady,
      post.instantPlaybackReady,
      firstVideo?.instantPlaybackReady
    ) === true;
  const videoProcessingStatus = pickString(
    canonicalReadiness?.processingStatus,
    post.videoProcessingStatus
  );
  const assetsReady =
    pickBoolean(canonicalReadiness?.assetsReady, post.assetsReady) === true;

  const selection = selectBestVideoPlaybackAsset(postLike, {
    hydrationMode: opts?.hydrationMode ?? "detail",
    allowPreviewOnly: true,
    ...(opts?.preferHlsFirst != null ? { preferHlsFirst: opts.preferHlsFirst } : {}),
  });

  const playbackUrl = selection.playbackUrl;
  const fallbackVideoUrl = selection.fallbackVideoUrl;
  const productionPlaybackSelected = selection.productionPlaybackSelected;
  /** Any selectable HTTPS playable URL counts (preview360 included when it is literally all we have). */
  const playbackUrlPresent = Boolean(playbackUrl);
  const playbackReady = playbackUrlPresent || instantPlaybackReady;

  let mediaStatus: MediaStatus = "ready";
  const encodePipelineFailed = videoProcessingStatus === "failed";
  if (encodePipelineFailed && playbackReady) {
    /** Ladder/transcode died, but originals or other HTTPS playback remain valid. */
    mediaStatus = "processing";
  } else if (encodePipelineFailed) {
    mediaStatus = "failed";
  } else if (videoProcessingStatus === "completed" && assetsReady) {
    mediaStatus = "ready";
  } else if (playbackReady) {
    mediaStatus = "processing";
  } else {
    mediaStatus = "processing";
  }

  const gradients = normalizeLetterboxGradients(post);
  const usedPreviewFallback = selection.isPreviewOnly && Boolean(playbackUrl);
  /** True whenever we have selectable HTTPS playback and the asset is not a hard playback failure. */
  const processingButPlayable = playbackUrlPresent && mediaStatus !== "failed";

  return {
    mediaStatus,
    assetsReady,
    ...(videoProcessingStatus ? { videoProcessingStatus } : {}),
    posterReady: Boolean(selection.posterUrl ?? posterUrl),
    posterPresent: Boolean(selection.posterUrl ?? posterUrl),
    ...((selection.posterUrl ?? posterUrl) ? { posterUrl: selection.posterUrl ?? posterUrl } : {}),
    playbackReady,
    playbackUrlPresent,
    ...(playbackUrl ? { playbackUrl } : {}),
    ...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),
    instantPlaybackReady,
    hasVideo: true,
    aspectRatio: pickNumber(firstVideo?.aspectRatio, assets[0]?.aspectRatio) ?? null,
    width: pickNumber(firstVideo?.width, assets[0]?.width) ?? null,
    height: pickNumber(firstVideo?.height, assets[0]?.height) ?? null,
    resizeMode: resolveResizeMode(post),
    ...(gradients.gradientTop ? { gradientTop: gradients.gradientTop } : {}),
    ...(gradients.gradientBottom ? { gradientBottom: gradients.gradientBottom } : {}),
    ...(gradients.letterboxGradients ? { letterboxGradients: gradients.letterboxGradients } : {}),
    updatedAtMs:
      readMaybeMillis(post.updatedAtMs ?? post.lastUpdated ?? post.updatedAt ?? post.time) ?? null,
    mediaUpdatedAtMs:
      readMaybeMillis(post.playbackLabUpdatedAt ?? post.updatedAtMs ?? post.lastUpdated ?? post.updatedAt) ?? null,
    ...(usedPreviewFallback ? { usedPreviewFallback: true } : {}),
    productionPlaybackSelected,
    selectedVideoVariant: selection.selectedVideoVariant,
    selectedVideoQualityRank: selection.selectedVideoQualityRank,
    isDegradedVideo: selection.isDegradedVideo,
    ...(processingButPlayable ? { processingButPlayable: true } : {}),
  };
}
