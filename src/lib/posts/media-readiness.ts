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

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function pickProcessedPlaybackUrl(asset: PostRecord | null): string | undefined {
  const variants = asRecord(asset?.variants) ?? {};
  const generated = asRecord(asset?.generated) ?? {};
  const playbackLab = asRecord(asset?.playbackLab);
  const playbackGenerated = asRecord(playbackLab?.generated);
  const sourceSnapshot = asRecord(playbackLab?.sourceSnapshot);
  const candidate = pickString(
    generated.startup720FaststartAvc,
    generated.startup720Faststart,
    generated.startup1080FaststartAvc,
    generated.startup1080Faststart,
    playbackGenerated?.startup720FaststartAvc,
    playbackGenerated?.startup720Faststart,
    playbackGenerated?.startup1080FaststartAvc,
    playbackGenerated?.startup1080Faststart,
    variants.startup720FaststartAvc,
    variants.startup720Faststart,
    variants.startup1080FaststartAvc,
    variants.startup1080Faststart,
    variants.main720Avc,
    variants.main720,
    variants.main1080Avc,
    variants.main1080,
    variants.hls,
    variants.preview360Avc,
    variants.preview360,
  );
  const original = pickString(asset?.original, sourceSnapshot?.original);
  if (!candidate) return undefined;
  if (!isRemoteHttpUrl(candidate)) return undefined;
  if (original && candidate === original) return undefined;
  return candidate;
}

function pickFallbackVideoUrl(asset: PostRecord | null, playbackUrl?: string): string | undefined {
  const original = pickString(asset?.original);
  if (!original || !isRemoteHttpUrl(original)) return undefined;
  if (playbackUrl && original === playbackUrl) return undefined;
  return original;
}

export function buildPostMediaReadiness(
  postLike: Record<string, unknown> | null | undefined,
): PostMediaReadiness {
  const post = asRecord(postLike) ?? {};
  const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];
  const firstVideo = assets.find((asset) => pickString(asset?.type, asset?.mediaType) === "video") ?? null;
  const hasVideo = firstVideo != null;
  const posterUrl = pickString(firstVideo?.poster, firstVideo?.thumbnail, asRecord(firstVideo?.variants)?.poster);
  const playbackUrl = pickProcessedPlaybackUrl(firstVideo);
  const fallbackVideoUrl = pickFallbackVideoUrl(firstVideo, playbackUrl);
  const assetsReady = pickBoolean(post.assetsReady) === true;
  const instantPlaybackReady = pickBoolean(post.instantPlaybackReady, firstVideo?.instantPlaybackReady) === true;
  const videoProcessingStatus = pickString(post.videoProcessingStatus);
  const playbackReady =
    hasVideo === false
      ? false
      : Boolean(playbackUrl) &&
        (assetsReady || instantPlaybackReady || videoProcessingStatus === "completed");
  let mediaStatus: MediaStatus = "ready";
  if (hasVideo) {
    if (videoProcessingStatus === "failed") {
      mediaStatus = "failed";
    } else if (playbackReady || assetsReady) {
      mediaStatus = "ready";
    } else {
      mediaStatus = "processing";
    }
  }
  const gradients = normalizeLetterboxGradients(post);
  return {
    mediaStatus,
    assetsReady,
    ...(videoProcessingStatus ? { videoProcessingStatus } : {}),
    posterReady: Boolean(posterUrl),
    posterPresent: Boolean(posterUrl),
    ...(posterUrl ? { posterUrl } : {}),
    playbackReady,
    playbackUrlPresent: Boolean(playbackUrl),
    ...(playbackUrl ? { playbackUrl } : {}),
    ...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),
    instantPlaybackReady,
    hasVideo,
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
  };
}
