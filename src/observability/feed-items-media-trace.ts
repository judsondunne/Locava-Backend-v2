import { resolveBestVideoPlaybackMedia } from "../lib/posts/video-playback-selection.js";

/**
 * Server-side diagnostics for feed payloads: logs what URLs and variant metadata
 * each card carries at first paint (no extra Firestore reads).
 *
 * Enable with env:
 * - LOCAVA_FEED_ITEMS_MEDIA_TRACE=1
 * - or LOCAVA_VIDEO_MEDIA_DEBUG=1 (shared with posts batch video diagnostics)
 */

function truthyEnv(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "yes";
}

export function isFeedItemsMediaTraceEnabled(): boolean {
  return truthyEnv("LOCAVA_FEED_ITEMS_MEDIA_TRACE") || truthyEnv("LOCAVA_VIDEO_MEDIA_DEBUG");
}

function fingerprintUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const u = raw.trim();
  try {
    const parsed = new URL(u);
    const path = parsed.pathname;
    const tail = path.length > 120 ? `…${path.slice(-120)}` : path;
    return `${parsed.hostname}${tail}`;
  } catch {
    const tail = u.length > 140 ? `…${u.slice(-140)}` : u;
    return tail;
  }
}

function pathHintsForUrl(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.length) return [];
  const l = raw.toLowerCase();
  const hints: string[] = [];
  if (l.includes("preview360") || /preview_?360/.test(l)) hints.push("preview360_in_path");
  if (l.includes("main720")) hints.push("main720_in_path");
  if (l.includes("main1080")) hints.push("main1080_in_path");
  if (l.includes(".m3u8") || l.includes("/hls")) hints.push("hls_in_path");
  if (l.includes("startup")) hints.push("startup_in_path");
  if (l.includes("faststart")) hints.push("faststart_in_path");
  if (l.includes("hevc") || l.includes("h265")) hints.push("hevc_hint_in_path");
  if (l.includes("avc") || l.includes("h264")) hints.push("avc_hint_in_path");
  return hints;
}

function mergePathHints(urls: unknown[]): string[] {
  const s = new Set<string>();
  for (const u of urls) {
    for (const h of pathHintsForUrl(u)) s.add(h);
  }
  return [...s].sort();
}

type LooseRecord = Record<string, unknown>;

export function buildFeedItemMediaTraceRow(item: LooseRecord): LooseRecord {
  const postId = typeof item.postId === "string" ? item.postId : "?";
  const media = item.media as LooseRecord | undefined;
  const mediaType = media && typeof media.type === "string" ? media.type : null;
  const startupHint = media && typeof media.startupHint === "string" ? media.startupHint : undefined;
  const assets = Array.isArray(item.assets) ? item.assets : [];
  const v0 = assets[0] as LooseRecord | undefined;

  const variantKeys =
    v0?.variants && typeof v0.variants === "object" && v0.variants !== null
      ? Object.keys(v0.variants as Record<string, unknown>).slice(0, 40)
      : [];

  const urlPool: unknown[] = [
    item.playbackUrl,
    item.fallbackVideoUrl,
    item.firstAssetUrl,
    item.posterUrl,
    media?.posterUrl,
    v0?.previewUrl,
    v0?.mp4Url,
    v0?.streamUrl,
    v0?.originalUrl
  ];

  const row: LooseRecord = {
    postId,
    mediaType,
    mediaStartupHint: startupHint,
    mediaStatus: item.mediaStatus,
    assetsReady: item.assetsReady,
    posterReady: item.posterReady,
    playbackReady: item.playbackReady,
    playbackUrlPresent: item.playbackUrlPresent,
    hasVideo: item.hasVideo,
    playbackUrlTail: fingerprintUrl(item.playbackUrl),
    fallbackVideoUrlTail: fingerprintUrl(item.fallbackVideoUrl),
    firstAssetUrlTail: fingerprintUrl(item.firstAssetUrl),
    posterUrlTail: fingerprintUrl(item.posterUrl ?? media?.posterUrl),
    pathHintsMerged: mergePathHints(urlPool),
    asset0:
      v0 && typeof v0 === "object"
        ? {
            id: v0.id,
            type: v0.type,
            previewTail: fingerprintUrl(v0.previewUrl),
            posterTail: fingerprintUrl(v0.posterUrl),
            mp4Tail: fingerprintUrl(v0.mp4Url),
            streamTail: fingerprintUrl(v0.streamUrl),
            originalTail: fingerprintUrl(v0.originalUrl),
            variantKeys: variantKeys.length ? variantKeys : undefined
          }
        : undefined
  };

  return row;
}

export function buildFeedItemsMediaTracePayload(input: {
  surface: string;
  viewerId?: string | null;
  requestId?: string;
  tab?: string;
  items: unknown[];
}): LooseRecord {
  const rows = input.items.map((it) =>
    typeof it === "object" && it !== null ? buildFeedItemMediaTraceRow(it as LooseRecord) : { postId: "?", error: "non_object_item" }
  );
  return {
    event: "feed_items_media_trace",
    surface: input.surface,
    viewerId: input.viewerId ?? null,
    requestId: input.requestId,
    tab: input.tab,
    itemCount: input.items.length,
    items: rows
  };
}

function isFeedItemVideo(it: LooseRecord): boolean {
  const media = it.media as LooseRecord | undefined;
  if (media && typeof media.type === "string" && media.type === "video") return true;
  if (it.hasVideo === true) return true;
  const assets = Array.isArray(it.assets) ? it.assets : [];
  const v0 = assets[0] as LooseRecord | undefined;
  return Boolean(v0 && typeof v0.type === "string" && v0.type === "video");
}

/**
 * Lightweight counts on every feed response (no URLs) — surfaces whether cards
 * are missing playback fields that the client needs to show motion.
 */
/** Coerce FeedCard-ish wire payloads into resolver-shaped posts (originalUrl→original). */
function feedWireItemToPlaybackPostLike(it: LooseRecord): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...it };
  const assetsRaw = Array.isArray(copy.assets) ? ([...copy.assets] as LooseRecord[]) : [];
  copy.assets = assetsRaw;
  const v0 = assetsRaw[0];
  if (v0 && v0.type === "video") {
    const row = { ...v0 };
    const ou = typeof row.originalUrl === "string" ? row.originalUrl.trim() : "";
    if (ou && !row.original) row.original = ou;
    assetsRaw[0] = row;
  }
  return copy;
}

/**
 * First-paint readiness across images + videos (used for feed summaries / emergency fallback audits).
 * Complements {@link rollupFeedVideoMediaSummary}, which only inspects video rows.
 */
export function rollupFeedCardMediaReadyCounts(items: unknown[]): LooseRecord {
  let imageReadyCount = 0;
  let videoStartupReadyCount = 0;
  let posterReadyCount = 0;
  let gradientReadyCount = 0;
  let legacyOnlyCount = 0;
  let mediaIncompleteCount = 0;
  const legacyOnlyDetails: Array<{ postId: string; missingFields: string[] }> = [];

  const firstImageDisplayFromAppPost = (ap: LooseRecord | undefined): string => {
    if (!ap) return "";
    const media = ap.media as LooseRecord | undefined;
    const assets = Array.isArray(media?.assets) ? (media!.assets as LooseRecord[]) : [];
    const imgAsset = assets.find((a) => String(a?.type ?? "").toLowerCase() === "image");
    const block = imgAsset ? (imgAsset.image as LooseRecord | undefined) : undefined;
    const display =
      typeof block?.displayUrl === "string"
        ? block.displayUrl.trim()
        : typeof block?.previewUrl === "string"
          ? block.previewUrl.trim()
          : typeof block?.fullUrl === "string"
            ? block.fullUrl.trim()
            : typeof block?.originalUrl === "string"
              ? block.originalUrl.trim()
              : "";
    return display;
  };

  const firstVideoStartupFromAppPost = (ap: LooseRecord | undefined): string => {
    if (!ap) return "";
    const media = ap.media as LooseRecord | undefined;
    const assets = Array.isArray(media?.assets) ? (media!.assets as LooseRecord[]) : [];
    const v = assets.find((a) => String(a?.type ?? "").toLowerCase() === "video");
    const pb = v ? ((v.video as LooseRecord | undefined)?.playback as LooseRecord | undefined) : undefined;
    const s = typeof pb?.startupUrl === "string" ? pb.startupUrl.trim() : "";
    if (s) return s;
    const d = typeof pb?.defaultUrl === "string" ? pb.defaultUrl.trim() : "";
    if (d) return d;
    return typeof pb?.primaryUrl === "string" ? pb.primaryUrl.trim() : "";
  };

  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as LooseRecord;
    const ap = (it.appPostV2 ?? it.appPost ?? it.post ?? it.canonicalPost) as LooseRecord | undefined;

    const media = it.media as LooseRecord | undefined;
    const wirePoster =
      (typeof media?.posterUrl === "string" && media.posterUrl.trim()) ||
      (typeof it.posterUrl === "string" && it.posterUrl.trim()) ||
      "";

    if (wirePoster) posterReadyCount += 1;

    const imgUrl = firstImageDisplayFromAppPost(ap);
    const vStart = firstVideoStartupFromAppPost(ap);

    const apMedia = ap?.media as LooseRecord | undefined;
    const apAssets = Array.isArray(apMedia?.assets) ? (apMedia.assets as unknown[]) : [];

    const postId = String(it.postId ?? it.id ?? "").trim() || "unknown";

    if (isFeedItemVideo(it)) {
      if (vStart) videoStartupReadyCount += 1;
      else {
        legacyOnlyCount += 1;
        const hasAnyVideoAsset = apAssets.length > 0 && apAssets.some((a) => {
          const ar = a as LooseRecord;
          return String(ar?.type ?? "").toLowerCase() === "video";
        });
        legacyOnlyDetails.push({
          postId,
          missingFields: hasAnyVideoAsset
            ? ["video_playable_url_missing_in_embedded_apppost"]
            : ["apppost_video_asset_missing"],
        });
      }
    } else {
      if (imgUrl) imageReadyCount += 1;
      else {
        legacyOnlyCount += 1;
        const hasAnyImageAsset = apAssets.length > 0 && apAssets.some((a) => {
          const ar = a as LooseRecord;
          return String(ar?.type ?? "").toLowerCase() === "image";
        });
        legacyOnlyDetails.push({
          postId,
          missingFields: hasAnyImageAsset
            ? ["image_display_url_missing_in_embedded_apppost"]
            : ["apppost_image_asset_missing"],
        });
      }
    }

    const gradAsset = apAssets.find((a) => a && typeof a === "object") as LooseRecord | undefined;
    const pres = gradAsset?.presentation as LooseRecord | undefined;
    const lg = pres?.letterboxGradient as LooseRecord | undefined;
    const hasGrad =
      (typeof lg?.top === "string" && lg.top.trim()) || (typeof lg?.bottom === "string" && lg.bottom.trim());
    if (hasGrad) gradientReadyCount += 1;

    if (it.mediaCompleteness === "cover_only" || it.requiresAssetHydration === true) mediaIncompleteCount += 1;
  }

  return {
    feedCardPostCount: items.length,
    feedCardImageReadyCount: imageReadyCount,
    feedCardVideoStartupReadyCount: videoStartupReadyCount,
    feedCardPosterReadyCount: posterReadyCount,
    feedCardGradientReadyCount: gradientReadyCount,
    feedCardLegacyOnlyCount: legacyOnlyCount,
    feedCardLegacyOnlyDetails: legacyOnlyDetails,
    feedCardMediaIncompleteCount: mediaIncompleteCount
  };
}

export function rollupFeedVideoMediaSummary(items: unknown[]): LooseRecord {
  let videoItemCount = 0;
  let fallbackVideoNonEmpty = 0;
  let posterNonEmpty = 0;
  let firstAssetUrlNonEmpty = 0;
  let assetsReadyTrue = 0;
  let preview360PathHintAnywhere = 0;
  let main720PathHintAnywhere = 0;
  let main1080PathHintAnywhere = 0;
  let hlsPathHintAnywhere = 0;
  let processingStatus = 0;
  let videoDegradedCount = 0;
  let videoMissingPlayableCount = 0;
  let canonicalVideoPlayableCount = 0;
  let canonicalStartupUrlCount = 0;
  let canonicalPosterCount = 0;
  let canonicalGradientCount = 0;
  const canonicalSelectedVariantCounts: Record<string, number> = {};

  const incrementVariantCount = (bucket: string): void => {
    canonicalSelectedVariantCounts[bucket] = (canonicalSelectedVariantCounts[bucket] ?? 0) + 1;
  };

  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as LooseRecord;
    if (!isFeedItemVideo(it)) continue;
    videoItemCount++;
    if (typeof it.fallbackVideoUrl === "string" && it.fallbackVideoUrl.length > 0) fallbackVideoNonEmpty++;
    const media = it.media as LooseRecord | undefined;
    const hasPoster =
      (typeof media?.posterUrl === "string" && media.posterUrl.length > 0) ||
      (typeof it.posterUrl === "string" && it.posterUrl.length > 0);
    if (hasPoster) posterNonEmpty++;
    if (typeof it.firstAssetUrl === "string" && it.firstAssetUrl.length > 0) firstAssetUrlNonEmpty++;
    if (it.assetsReady === true) assetsReadyTrue++;
    if (it.mediaStatus === "processing") processingStatus++;

    const pool: unknown[] = [it.playbackUrl, it.fallbackVideoUrl, it.firstAssetUrl];
    const assets = Array.isArray(it.assets) ? it.assets : [];
    const v0 = assets[0] as LooseRecord | undefined;
    if (v0) {
      pool.push(v0.previewUrl, v0.mp4Url, v0.streamUrl, v0.originalUrl);
    }
    const hints = mergePathHints(pool);
    if (hints.includes("preview360_in_path")) preview360PathHintAnywhere++;
    if (hints.includes("main720_in_path")) main720PathHintAnywhere++;
    if (hints.includes("main1080_in_path")) main1080PathHintAnywhere++;
    if (hints.includes("hls_in_path")) hlsPathHintAnywhere++;

    try {
      const appPost = (it.appPostV2 ?? it.appPost ?? it.post ?? it.canonicalPost) as LooseRecord | undefined;
      const appPostMediaAssets = Array.isArray((appPost?.media as LooseRecord | undefined)?.assets)
        ? (((appPost?.media as LooseRecord).assets as unknown[]) ?? [])
        : [];
      const rootMediaAssets = Array.isArray((it.media as LooseRecord | undefined)?.assets)
        ? ((((it.media as LooseRecord).assets as unknown[]) ?? []))
        : [];
      const canonicalVideoAsset = [...appPostMediaAssets, ...rootMediaAssets].find((asset) => {
        if (!asset || typeof asset !== "object") return false;
        return String((asset as LooseRecord).type ?? "").toLowerCase() === "video";
      }) as LooseRecord | undefined;
      const canonicalPlayback = (canonicalVideoAsset?.video as LooseRecord | undefined)?.playback as LooseRecord | undefined;
      const startupUrl = typeof canonicalPlayback?.startupUrl === "string" ? canonicalPlayback.startupUrl.trim() : "";
      const defaultUrl = typeof canonicalPlayback?.defaultUrl === "string" ? canonicalPlayback.defaultUrl.trim() : "";
      const primaryUrl = typeof canonicalPlayback?.primaryUrl === "string" ? canonicalPlayback.primaryUrl.trim() : "";
      const hasCanonicalPlayable = Boolean(startupUrl || defaultUrl || primaryUrl);
      if (hasCanonicalPlayable) canonicalVideoPlayableCount += 1;
      if (startupUrl) canonicalStartupUrlCount += 1;
      const canonicalPosterUrl =
        typeof canonicalPlayback?.posterUrl === "string" && canonicalPlayback.posterUrl.trim().length > 0
          ? canonicalPlayback.posterUrl.trim()
          : typeof canonicalVideoAsset?.video === "object" &&
              canonicalVideoAsset.video &&
              typeof (canonicalVideoAsset.video as LooseRecord).posterUrl === "string" &&
              String((canonicalVideoAsset.video as LooseRecord).posterUrl).trim().length > 0
            ? String((canonicalVideoAsset.video as LooseRecord).posterUrl).trim()
            : "";
      if (canonicalPosterUrl) {
        canonicalPosterCount += 1;
      }
      const presentation = canonicalVideoAsset?.presentation as LooseRecord | undefined;
      const canonicalGradient =
        (presentation?.letterboxGradient as LooseRecord | undefined) ??
        ((appPost?.media as LooseRecord | undefined)?.cover as LooseRecord | undefined)?.gradient as LooseRecord | undefined;
      const hasCanonicalGradient = Boolean(
        typeof canonicalPlayback?.gradient === "string" && canonicalPlayback.gradient.trim().length > 0 ||
          typeof canonicalGradient?.top === "string" && canonicalGradient.top.trim().length > 0 ||
          typeof canonicalGradient?.bottom === "string" && canonicalGradient.bottom.trim().length > 0
      );
      if (hasCanonicalGradient) {
        canonicalGradientCount += 1;
      }
      const sel = resolveBestVideoPlaybackMedia(feedWireItemToPlaybackPostLike(it), {
        hydrationMode: "playback",
      });
      if (sel.isDegradedVideo) videoDegradedCount++;
      const bucket =
        sel.selectedVideoVariant ??
        (startupUrl ? "startup" : defaultUrl ? "default" : primaryUrl ? "primary" : "none");
      incrementVariantCount(bucket);
      if (!sel.playbackUrl && !sel.fallbackVideoUrl && !hasCanonicalPlayable) videoMissingPlayableCount += 1;
    } catch {
      videoMissingPlayableCount += 1;
      incrementVariantCount("error");
    }
  }

  return {
    videoItemCount,
    videoFallbackUrlNonEmpty: fallbackVideoNonEmpty,
    videoPosterNonEmpty: posterNonEmpty,
    videoFirstAssetUrlNonEmpty: firstAssetUrlNonEmpty,
    videoAssetsReadyTrue: assetsReadyTrue,
    videoMediaStatusProcessing: processingStatus,
    videoCardsWithPreview360PathHint: preview360PathHintAnywhere,
    videoCardsWithMain720PathHint: main720PathHintAnywhere,
    videoCardsWithMain1080PathHint: main1080PathHintAnywhere,
    videoCardsWithHlsPathHint: hlsPathHintAnywhere,
    canonicalSelectedVariantCounts,
    canonicalVideoPlayableCount,
    canonicalStartupUrlCount,
    canonicalPosterCount,
    canonicalGradientCount,
    videoDegradedCount,
    videoMissingPlayableCount
  };
}
