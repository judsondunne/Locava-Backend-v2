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

export function rollupFeedVideoMediaSummary(items: unknown[]): LooseRecord {
  let videoItemCount = 0;
  let playbackUrlPresentTrue = 0;
  let playbackUrlNonEmpty = 0;
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
  const videoSelectedVariantCounts: Record<string, number> = {
    hls: 0,
    main1080: 0,
    main720: 0,
    original: 0,
    preview360: 0,
    none: 0,
  };

  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as LooseRecord;
    if (!isFeedItemVideo(it)) continue;
    videoItemCount++;
    if (it.playbackUrlPresent === true) playbackUrlPresentTrue++;
    if (typeof it.playbackUrl === "string" && it.playbackUrl.length > 0) playbackUrlNonEmpty++;
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
      const sel = resolveBestVideoPlaybackMedia(feedWireItemToPlaybackPostLike(it), {
        hydrationMode: "playback",
      });
      if (sel.isDegradedVideo) videoDegradedCount++;
      const bucket = sel.selectedVideoVariant ?? "none";
      const tally = videoSelectedVariantCounts as Record<string, number>;
      tally[bucket] = (tally[bucket] ?? 0) + 1;
      if (!sel.playbackUrl && !sel.fallbackVideoUrl) videoMissingPlayableCount += 1;
    } catch {
      videoMissingPlayableCount += 1;
    }
  }

  return {
    videoItemCount,
    videoPlaybackUrlPresentTrue: playbackUrlPresentTrue,
    videoPlaybackUrlNonEmpty: playbackUrlNonEmpty,
    videoFallbackUrlNonEmpty: fallbackVideoNonEmpty,
    videoPosterNonEmpty: posterNonEmpty,
    videoFirstAssetUrlNonEmpty: firstAssetUrlNonEmpty,
    videoAssetsReadyTrue: assetsReadyTrue,
    videoMediaStatusProcessing: processingStatus,
    videoCardsWithPreview360PathHint: preview360PathHintAnywhere,
    videoCardsWithMain720PathHint: main720PathHintAnywhere,
    videoCardsWithMain1080PathHint: main1080PathHintAnywhere,
    videoCardsWithHlsPathHint: hlsPathHintAnywhere,
    videoSelectedVariantCounts,
    videoDegradedCount,
    videoMissingPlayableCount
  };
}
