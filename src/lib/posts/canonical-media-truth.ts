type AnyRecord = Record<string, unknown>;

export type CanonicalMediaTruthKind =
  | "EMPTY"
  | "POSTER_ONLY"
  | "IMAGE_ONLY"
  | "IMAGE_GALLERY"
  | "VIDEO_WITH_POSTER_ONLY"
  | "VIDEO_WITH_ORIGINAL_FALLBACK"
  | "PLAYABLE_VIDEO"
  | "PLAYABLE_FASTSTART_VIDEO"
  | "PLAYABLE_CANONICAL_FASTSTART_VIDEO";

export type CanonicalMediaTruth = {
  kind: CanonicalMediaTruthKind;
  score: number;
  playableVideoUrl: string | null;
  playableUrlKind: string | null;
  posterUrl: string | null;
  hasVideoLikeSignals: boolean;
};

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === "object" ? (v as AnyRecord) : null;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) return t;
  }
  return null;
}

function allCandidateRoots(input: unknown): AnyRecord[] {
  const root = asRecord(input);
  if (!root) return [];
  const nested = [root, asRecord(root.post), asRecord(root.appPostV2), asRecord(root.appPost), asRecord(root.canonicalPost)];
  return nested.filter((v): v is AnyRecord => Boolean(v));
}

function assetArraysFromAny(input: unknown): AnyRecord[] {
  const out: AnyRecord[] = [];
  for (const root of allCandidateRoots(input)) {
    const media = asRecord(root.media);
    const mediaAssets = Array.isArray(media?.assets) ? (media?.assets as unknown[]) : [];
    const topAssets = Array.isArray(root.assets) ? (root.assets as unknown[]) : [];
    for (const a of [...mediaAssets, ...topAssets]) {
      const r = asRecord(a);
      if (r) out.push(r);
    }
  }
  return out;
}

const PLAYBACK_KEYS = [
  "startupUrl",
  "defaultUrl",
  "primaryUrl",
  "goodNetworkUrl",
  "weakNetworkUrl",
  "poorNetworkUrl",
  "previewUrl",
  "hlsUrl",
  "fallbackUrl",
  "originalUrl",
] as const;

export function getPlayableVideoUrlFromAnyCanonicalShape(input: unknown): { url: string | null; kind: string | null } {
  const assets = assetArraysFromAny(input);
  for (const asset of assets) {
    if (String(asset.type ?? "").toLowerCase() !== "video") continue;
    const video = asRecord(asset.video);
    const playback = asRecord(video?.playback);
    for (const key of PLAYBACK_KEYS) {
      const val = pickString(playback?.[key], video?.[key], asset[key]);
      if (val) return { url: val, kind: key };
    }
    const original = pickString(video?.originalUrl, asset.original);
    if (original) return { url: original, kind: "originalUrl" };
  }
  for (const root of allCandidateRoots(input)) {
    const media = asRecord(root.media);
    const mediaVideo = asRecord(media?.video);
    const compatibility = asRecord(root.compatibility);
    for (const key of PLAYBACK_KEYS) {
      const val = pickString(mediaVideo?.[key], media?.[key], root[key]);
      if (val) return { url: val, kind: key };
    }
    const fallback = pickString(compatibility?.fallbackVideoUrl, root.fallbackVideoUrl, compatibility?.photoLinks2);
    if (fallback) return { url: fallback, kind: "fallbackVideoUrl" };
  }
  return { url: null, kind: null };
}

export function getVideoPosterUrlFromAnyCanonicalShape(input: unknown): string | null {
  const assets = assetArraysFromAny(input);
  for (const asset of assets) {
    if (String(asset.type ?? "").toLowerCase() !== "video") continue;
    const video = asRecord(asset.video);
    const poster = pickString(video?.posterUrl, video?.posterHighUrl, video?.thumbnailUrl, asset.poster, asset.thumbnail);
    if (poster) return poster;
  }
  for (const root of allCandidateRoots(input)) {
    const media = asRecord(root.media);
    const cover = asRecord(media?.cover);
    const compatibility = asRecord(root.compatibility);
    const poster = pickString(
      cover?.posterUrl,
      cover?.thumbUrl,
      root.posterUrl,
      root.thumbUrl,
      compatibility?.posterUrl,
      compatibility?.displayPhotoLink,
      compatibility?.photoLink,
      root.displayPhotoLink,
      root.photoLink,
    );
    if (poster) return poster;
  }
  return null;
}

function hasVideoLikeSignals(input: unknown): boolean {
  for (const root of allCandidateRoots(input)) {
    if (String(root.mediaType ?? "").toLowerCase() === "video") return true;
    if (String(asRecord(root.classification)?.mediaKind ?? "").toLowerCase() === "video") return true;
    if (asRecord(root.classification)?.reel === true || root.reel === true) return true;
    if (String(asRecord(root.compatibility)?.mediaType ?? "").toLowerCase() === "video") return true;
    if (pickString(root.fallbackVideoUrl, asRecord(root.compatibility)?.fallbackVideoUrl)) return true;
  }
  return assetArraysFromAny(input).some((a) => String(a.type ?? "").toLowerCase() === "video");
}

function imageCount(input: unknown): number {
  return assetArraysFromAny(input).filter((a) => String(a.type ?? "").toLowerCase() === "image").length;
}

export function classifyCanonicalMediaTruth(input: unknown): CanonicalMediaTruth {
  const playable = getPlayableVideoUrlFromAnyCanonicalShape(input);
  const poster = getVideoPosterUrlFromAnyCanonicalShape(input);
  const videoLike = hasVideoLikeSignals(input);
  const images = imageCount(input);
  const hasFaststart = playable.kind != null && ["startupUrl", "defaultUrl", "primaryUrl", "goodNetworkUrl", "weakNetworkUrl", "poorNetworkUrl"].includes(playable.kind);
  const canonicalFaststart = hasFaststart && assetArraysFromAny(input).some((a) => {
    if (String(a.type ?? "").toLowerCase() !== "video") return false;
    const pb = asRecord(asRecord(a.video)?.playback);
    return Boolean(pickString(pb?.startupUrl, pb?.defaultUrl, pb?.primaryUrl));
  });
  if (canonicalFaststart) return { kind: "PLAYABLE_CANONICAL_FASTSTART_VIDEO", score: 150, playableVideoUrl: playable.url, playableUrlKind: playable.kind, posterUrl: poster, hasVideoLikeSignals: videoLike };
  if (hasFaststart && playable.url) return { kind: "PLAYABLE_FASTSTART_VIDEO", score: 120, playableVideoUrl: playable.url, playableUrlKind: playable.kind, posterUrl: poster, hasVideoLikeSignals: videoLike };
  if (playable.url) return { kind: "PLAYABLE_VIDEO", score: 100, playableVideoUrl: playable.url, playableUrlKind: playable.kind, posterUrl: poster, hasVideoLikeSignals: videoLike };
  if (videoLike && pickString(playable.url) == null && pickString(poster) != null) return { kind: "VIDEO_WITH_POSTER_ONLY", score: 40, playableVideoUrl: null, playableUrlKind: null, posterUrl: poster, hasVideoLikeSignals: true };
  if (videoLike) return { kind: "VIDEO_WITH_ORIGINAL_FALLBACK", score: 70, playableVideoUrl: null, playableUrlKind: null, posterUrl: poster, hasVideoLikeSignals: true };
  if (images > 1) return { kind: "IMAGE_GALLERY", score: 30, playableVideoUrl: null, playableUrlKind: null, posterUrl: poster, hasVideoLikeSignals: false };
  if (images === 1) return { kind: "IMAGE_ONLY", score: 20, playableVideoUrl: null, playableUrlKind: null, posterUrl: poster, hasVideoLikeSignals: false };
  if (poster) return { kind: "POSTER_ONLY", score: 10, playableVideoUrl: null, playableUrlKind: null, posterUrl: poster, hasVideoLikeSignals: false };
  return { kind: "EMPTY", score: 0, playableVideoUrl: null, playableUrlKind: null, posterUrl: null, hasVideoLikeSignals: false };
}

export function compareCanonicalMediaTruth(existing: unknown, incoming: unknown): number {
  return classifyCanonicalMediaTruth(incoming).score - classifyCanonicalMediaTruth(existing).score;
}

export function isPlayableVideoMedia(input: unknown): boolean {
  return classifyCanonicalMediaTruth(input).score >= 100;
}

export function isPosterOnlyMedia(input: unknown): boolean {
  const kind = classifyCanonicalMediaTruth(input).kind;
  return kind === "POSTER_ONLY" || kind === "VIDEO_WITH_POSTER_ONLY";
}
