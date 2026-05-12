/**
 * Canonical compact feed card hydration for For You simple surfaces.
 * Shared by legacy phase runtime and For You V5 ready-deck so playback/poster fields stay consistent.
 */
import { toFeedCardDTO, type FeedCardDTO } from "../../dto/compact-surface-dto.js";
import { selectBestVideoPlaybackAsset } from "../../lib/posts/video-playback-selection.js";
import { debugLog } from "../../lib/logging/debug-log.js";
import { LOG_FEED_DEBUG, LOG_VIDEO_DEBUG } from "../../lib/logging/log-config.js";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

const FEED_SIMPLE_FIRST_PAINT_WIRE_ASSET_CAP = 8;

function isRasterImageUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return /\.(webp|jpg|jpeg|png)(\?|#|$)/i.test(value.trim());
}

function inferLabeledMp4FromUrl(url: string | null | undefined): Record<string, string> {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return {};
  if (/1080.*avc|_1080_avc|1080_avc/i.test(u)) return { main1080Avc: u };
  if (/\/[^/]*1080[^/]*hevc|_1080_hevc|main1080_hevc/i.test(u)) return { main1080: u };
  if (/720.*avc|_720_avc|720_avc/i.test(u)) return { main720Avc: u };
  if (/\/[^/]*720[^/]*hevc|_720_hevc|main720_hevc/i.test(u)) return { main720: u };
  return { main720Avc: u };
}

function hasMainishVariant(variants: Record<string, string>): boolean {
  return Boolean(
    variants.main1080Avc ||
      variants.main1080 ||
      variants.main720Avc ||
      variants.main720 ||
      variants.hls ||
      variants.startup1080FaststartAvc ||
      variants.startup720FaststartAvc
  );
}

function simpleCandidateVideoVariants(a0: SimpleFeedCandidate["assets"][number]): Record<string, string> {
  const v: Record<string, string> = { ...(a0.playbackVariantUrls ?? {}) };
  if (a0.streamUrl?.trim()) v.hls = a0.streamUrl.trim();
  const inferred = inferLabeledMp4FromUrl(a0.mp4Url);
  if (!hasMainishVariant(v)) {
    Object.assign(v, inferred);
  } else {
    for (const [k, val] of Object.entries(inferred)) {
      if (v[k] == null) v[k] = val;
    }
  }
  return v;
}

function carouselCompactAssetCap(assetCount: number): number {
  const n = Math.max(1, Math.floor(assetCount || 1));
  return Math.min(12, n);
}

function augmentSimpleFeedVideoPlayback(candidate: SimpleFeedCandidate): {
  playbackUrl?: string;
  playbackUrlPresent?: boolean;
  fallbackVideoUrl?: string;
  mediaStatus?: "processing" | "ready" | "failed";
  assetsReady?: boolean;
  playbackReady?: boolean;
  posterReady?: boolean;
  hasVideo?: boolean;
} {
  if (candidate.mediaType !== "video") return {};
  const a0 = candidate.assets[0];
  if (!a0) return { hasVideo: true };
  const variants = simpleCandidateVideoVariants(a0);
  const postLike: Record<string, unknown> = {
    mediaType: "video",
    assetsReady: candidate.assetsReady === true,
    instantPlaybackReady: candidate.instantPlaybackReady === true,
    ...(candidate.videoProcessingStatus ? { videoProcessingStatus: candidate.videoProcessingStatus } : {}),
    assets: [
      {
        type: "video",
        id: a0.id,
        original: a0.originalUrl,
        ...(Object.keys(variants).length > 0 ? { variants } : {}),
      },
    ],
  };
  const sel = selectBestVideoPlaybackAsset(postLike, { hydrationMode: "playback", allowPreviewOnly: true });
  const posterOk = Boolean(candidate.posterUrl?.trim() || a0.posterUrl?.trim());
  const mediaStatus: "processing" | "ready" | "failed" =
    sel.mediaStatusHint === "failed" ? "failed" : sel.mediaStatusHint === "ready" ? "ready" : "processing";
  return {
    ...(sel.playbackUrl ? { playbackUrl: sel.playbackUrl } : {}),
    playbackUrlPresent: Boolean(sel.playbackUrl),
    ...(sel.fallbackVideoUrl ? { fallbackVideoUrl: sel.fallbackVideoUrl } : {}),
    mediaStatus,
    ...(candidate.assetsReady === true ? { assetsReady: true } : {}),
    playbackReady: Boolean(sel.playbackUrl) || candidate.instantPlaybackReady === true,
    posterReady: posterOk,
    hasVideo: true,
  };
}

export function buildFeedCardFromSimpleCandidate(candidate: SimpleFeedCandidate, index: number, viewerId: string): FeedCardDTO {
  const firstCanonicalVideoPlayback = (() => {
    const raw = candidate.rawFirestore;
    if (!raw || typeof raw !== "object") return null;
    const media = (raw.media as { assets?: unknown[] } | undefined)?.assets;
    if (!Array.isArray(media)) return null;
    const videoAsset = media.find((asset) => {
      if (!asset || typeof asset !== "object") return false;
      return (asset as { type?: unknown }).type === "video";
    }) as { id?: unknown; video?: { playback?: Record<string, unknown> } } | undefined;
    if (!videoAsset?.video?.playback) return null;
    const playback = videoAsset.video.playback;
    return {
      assetId: typeof videoAsset.id === "string" ? videoAsset.id : null,
      startupUrl: typeof playback.startupUrl === "string" ? playback.startupUrl : null,
      defaultUrl: typeof playback.defaultUrl === "string" ? playback.defaultUrl : null,
      primaryUrl: typeof playback.primaryUrl === "string" ? playback.primaryUrl : null,
      selectedReason: typeof playback.selectedReason === "string" ? playback.selectedReason : null,
    };
  })();
  const sourceLen = candidate.sourceFirestoreAssetArrayLen ?? candidate.assets.length;
  const candidateRecord = candidate as unknown as Record<string, unknown>;
  const shouldPreserveCanonicalAssets =
    sourceLen > 1 ||
    candidateRecord.hasMultipleAssets === true ||
    candidateRecord.mediaCompleteness === "full" ||
    candidateRecord.mediaCompleteness === "complete";
  const visibleAssets = shouldPreserveCanonicalAssets ? candidate.assets : candidate.assets.slice(0, 1);
  const compactCap = Math.min(carouselCompactAssetCap(visibleAssets.length), FEED_SIMPLE_FIRST_PAINT_WIRE_ASSET_CAP);
  const fullCard = toFeedCardDTO({
    postId: candidate.postId,
    sourceRawPost: candidate.rawFirestore ?? null,
    rankToken: `fys:${viewerId.slice(0, 8) || "anon"}:${index + 1}`,
    author: {
      userId: candidate.authorId,
      handle: candidate.authorHandle,
      name: candidate.authorName,
      pic: candidate.authorPic,
    },
    activities: candidate.activities,
    address: candidate.address,
    carouselFitWidth: candidate.carouselFitWidth,
    layoutLetterbox: candidate.layoutLetterbox,
    letterboxGradientTop: candidate.letterboxGradientTop,
    letterboxGradientBottom: candidate.letterboxGradientBottom,
    letterboxGradients: candidate.letterboxGradients,
    geo: candidate.geo,
    assets: visibleAssets,
    compactAssetLimit: compactCap,
    compactSurfaceWireMode: "feed_first_paint",
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    canonicalAliasMode: "app_post_v2_only",
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,
      startupHint: candidate.mediaType === "video" ? "poster_then_preview" : "poster_only",
    },
    social: {
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount,
    },
    viewer: {
      liked: false,
      saved: false,
    },
    createdAtMs: candidate.createdAtMs,
    updatedAtMs: candidate.updatedAtMs,
    rawFirestoreAssetCount: sourceLen,
    assetCount: sourceLen,
    hasMultipleAssets: sourceLen > 1,
    ...augmentSimpleFeedVideoPlayback(candidate),
  });
  const {
    postContractVersion: _postContractVersion,
    normalizedCard: _normalizedCard,
    normalizedMedia: _normalizedMedia,
    normalizedAuthor: _normalizedAuthor,
    normalizedLocation: _normalizedLocation,
    normalizedCounts: _normalizedCounts,
    mediaResolutionSource: _mediaResolutionSource,
    hasPlayableVideo: _hasPlayableVideo,
    hasAssetsArray: _hasAssetsArray,
    hasRawPost: _hasRawPost,
    hasEmbeddedComments: _hasEmbeddedComments,
    rawPost: _rawPost,
    sourcePost: _sourcePost,
    debugPostEnvelope: _debugPostEnvelope,
    appPostAttached: _appPostAttached,
    appPostWireAssetCount: _appPostWireAssetCount,
    wireDeclaredMediaAssetCount: _wireDeclaredMediaAssetCount,
    ...leanCard
  } = fullCard as FeedCardDTO & Record<string, unknown>;
  const outgoingAppPost = (fullCard.appPost ?? null) as
    | { media?: { assets?: Array<{ id?: unknown; type?: unknown; video?: { playback?: Record<string, unknown> } }> } }
    | null;
  const outgoingPlayback = (() => {
    const assets = Array.isArray(outgoingAppPost?.media?.assets) ? outgoingAppPost?.media?.assets : [];
    const videoAsset = assets.find((asset) => asset?.type === "video");
    const playback = videoAsset?.video?.playback;
    return {
      assetId: typeof videoAsset?.id === "string" ? videoAsset.id : null,
      startupUrl: typeof playback?.startupUrl === "string" ? playback.startupUrl : null,
      defaultUrl: typeof playback?.defaultUrl === "string" ? playback.defaultUrl : null,
      primaryUrl: typeof playback?.primaryUrl === "string" ? playback.primaryUrl : null,
      selectedReason: typeof playback?.selectedReason === "string" ? playback.selectedReason : null,
    };
  })();
  const canonicalFaststartPresent = Boolean(
    firstCanonicalVideoPlayback?.startupUrl &&
      /startup(?:540|720|1080)_faststart_avc\.mp4/i.test(firstCanonicalVideoPlayback.startupUrl)
  );
  const outgoingDroppedFaststart = Boolean(
    canonicalFaststartPresent &&
      (!outgoingPlayback.startupUrl || !/startup(?:540|720|1080)_faststart_avc\.mp4/i.test(outgoingPlayback.startupUrl))
  );
  if (LOG_FEED_DEBUG || LOG_VIDEO_DEBUG) {
    const cacheWasStale = Boolean(canonicalFaststartPresent && outgoingDroppedFaststart);
    const refreshedFromCanonical = Boolean(canonicalFaststartPresent && !outgoingDroppedFaststart);
    try {
      debugLog("video", "FEED_WIRE_APPPOST_PLAYBACK_DEBUG", () => ({
        postId: candidate.postId,
        source: candidate.rawFirestore ? "fresh_post_doc" : "post_card_cache",
        canonicalDocStartupUrl: firstCanonicalVideoPlayback?.startupUrl ?? null,
        canonicalDocDefaultUrl: firstCanonicalVideoPlayback?.defaultUrl ?? null,
        canonicalDocPrimaryUrl: firstCanonicalVideoPlayback?.primaryUrl ?? null,
        canonicalDocSelectedReason: firstCanonicalVideoPlayback?.selectedReason ?? null,
        outgoingAppPostStartupUrl: outgoingPlayback.startupUrl,
        outgoingAppPostDefaultUrl: outgoingPlayback.defaultUrl,
        outgoingAppPostPrimaryUrl: outgoingPlayback.primaryUrl,
        outgoingAppPostSelectedReason: outgoingPlayback.selectedReason,
        cacheWasStale,
        refreshedFromCanonical,
      }));
      if (outgoingDroppedFaststart) {
        debugLog("video", "FEED_CANONICAL_PLAYBACK_DROPPED_ERROR", () => ({
          postId: candidate.postId,
          canonicalDocStartupUrl: firstCanonicalVideoPlayback?.startupUrl ?? null,
          outgoingAppPostStartupUrl: outgoingPlayback.startupUrl ?? null,
        }));
      }
    } catch {
      // no-op
    }
  }
  if (fullCard.appPostV2 && typeof fullCard.appPostV2 === "object") {
    (leanCard as Record<string, unknown>).appPostV2 = fullCard.appPostV2;
    (leanCard as Record<string, unknown>).postContractVersion = 3 as const;
  }
  return leanCard as FeedCardDTO;
}

export function firstVisiblePlaybackSignals(candidate: SimpleFeedCandidate | undefined): {
  ready: boolean;
  playbackUrlPresent: boolean;
  posterPresent: boolean;
  variant: string | null;
  needsDetailBeforePlay: boolean;
} | null {
  if (!candidate) return null;
  const posterOk = Boolean(candidate.posterUrl?.trim() || candidate.assets[0]?.posterUrl?.trim());
  if (candidate.mediaType !== "video") {
    return {
      ready: true,
      playbackUrlPresent: false,
      posterPresent: posterOk,
      variant: null,
      needsDetailBeforePlay: false,
    };
  }
  const aug = augmentSimpleFeedVideoPlayback(candidate);
  const a0 = candidate.assets[0];
  if (!a0) {
    return {
      ready: Boolean(aug.playbackReady),
      playbackUrlPresent: Boolean(aug.playbackUrlPresent),
      posterPresent: posterOk,
      variant: null,
      needsDetailBeforePlay: aug.playbackReady !== true && !aug.playbackUrlPresent,
    };
  }
  const variants = simpleCandidateVideoVariants(a0);
  const postLike: Record<string, unknown> = {
    mediaType: "video",
    assetsReady: candidate.assetsReady === true,
    instantPlaybackReady: candidate.instantPlaybackReady === true,
    ...(candidate.videoProcessingStatus ? { videoProcessingStatus: candidate.videoProcessingStatus } : {}),
    assets: [
      {
        type: "video",
        id: a0.id,
        original: a0.originalUrl,
        ...(Object.keys(variants).length > 0 ? { variants } : {}),
      },
    ],
  };
  const sel = selectBestVideoPlaybackAsset(postLike, { hydrationMode: "playback", allowPreviewOnly: true });
  return {
    ready: Boolean(aug.playbackReady ?? sel.playbackUrl),
    playbackUrlPresent: Boolean(aug.playbackUrlPresent ?? sel.playbackUrl),
    posterPresent: posterOk,
    variant: sel.selectedVideoVariant ?? null,
    needsDetailBeforePlay: Boolean(candidate.instantPlaybackReady !== true && sel.isPreviewOnly && !candidate.assetsReady),
  };
}

export function updateMediaDiagnostics(candidate: SimpleFeedCandidate, diag: { mediaReadyCount: number; degradedMediaCount: number }): void {
  const a = candidate.assets[0];
  if (candidate.mediaType !== "video" || !a) {
    diag.mediaReadyCount += 1;
    return;
  }
  const orig = (a.originalUrl ?? "").trim();
  const mp4 = (a.mp4Url ?? "").trim();
  const prev = (a.previewUrl ?? "").trim();
  const poster = (a.posterUrl ?? "").trim();
  const stream = (a.streamUrl ?? "").trim();
  const hasRasterPreview = isRasterImageUrl(prev) || isRasterImageUrl(poster);
  const degraded = Boolean(orig || mp4) && !stream && !hasRasterPreview;
  if (degraded) diag.degradedMediaCount += 1;
  else diag.mediaReadyCount += 1;
}

export function applyFirstPaintPlaybackDiagnostics(
  candidates: SimpleFeedCandidate[],
  diag: {
    firstPaintPlaybackReadyCount?: number;
    firstVisiblePlaybackUrlPresent?: boolean;
    firstVisiblePosterPresent?: boolean;
    firstVisibleVariant?: string | null;
    firstVisibleNeedsDetailBeforePlay?: boolean;
  }
): void {
  const slice = candidates.slice(0, 2);
  let readyCount = 0;
  for (const row of slice) {
    const sig = firstVisiblePlaybackSignals(row);
    if (sig?.ready) readyCount += 1;
  }
  diag.firstPaintPlaybackReadyCount = readyCount;
  const head = firstVisiblePlaybackSignals(candidates[0]);
  if (head) {
    diag.firstVisiblePlaybackUrlPresent = head.playbackUrlPresent;
    diag.firstVisiblePosterPresent = head.posterPresent;
    diag.firstVisibleVariant = head.variant;
    diag.firstVisibleNeedsDetailBeforePlay = head.needsDetailBeforePlay;
  }
}
