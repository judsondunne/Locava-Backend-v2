/**
 * Canonical production playback URL selection for post video assets.
 * Uses only Firestore-shaped fields — no network probes.
 */

export type VideoHydrationMode = "card" | "playback" | "detail" | "open" | "full";

/** UI / analytics bucket for the resolver's primary URL (maps many internal labels → stable enum). */
export type SelectedCanonicalVideoVariant =
  | "hls"
  | "startup1080"
  | "startup720"
  | "startup540"
  | "upgrade1080"
  | "main1080"
  | "main720"
  | "original"
  | "preview360"
  | "none";

export type SelectBestVideoPlaybackOptions = {
  hydrationMode: VideoHydrationMode;
  /** When set, influences HLS vs MP4 ordering (default universal: AVC/MP4 ladder before HLS). */
  preferHlsFirst?: boolean;
  /** Allow preview360-tier URLs as playbackUrl when nothing better exists. */
  allowPreviewOnly: boolean;
  /**
   * When true and hydration is playback-oriented, treat preview-only selection as needing
   * Firestore/detail upgrade (used by batch orchestrator).
   */
  requireProductionVariantForPlayback?: boolean;
  includeDiagnostics?: boolean;
};

export type VideoPlaybackDiagnostics = {
  reason: string;
  candidatesTried: string[];
  deferredHevcMain1080: boolean;
  cacheMediaUpgraded?: boolean;
};

export type VideoPlaybackSelection = {
  playbackUrl?: string;
  fallbackVideoUrl?: string;
  posterUrl?: string;
  selectedVariantLabel: string;
  /** Canonical variant bucket aligned with API contracts (preferred over raw label). */
  selectedVideoVariant: SelectedCanonicalVideoVariant;
  selectedVideoQualityRank: number;
  /** True only when preview360-tier is the best available playable URL (or no URL). */
  isDegradedVideo: boolean;
  selectedVariantHeight: number | null;
  selectedVariantCodec: string | null;
  selectedVariantSource: string;
  isPreviewOnly: boolean;
  /** True when playback uses a transcoded ladder URL (not pure original / preview tier). */
  isProductionPlayback: boolean;
  /**
   * High-quality selectable URL: HLS, main ladders, startups, originals, root playback — not preview-only.
   * Mirrors client expectation that `playbackUrlPresent` reflects any usable remote URL excluding preview-tier.
   */
  productionPlaybackSelected: boolean;
  mediaStatusHint: "processing" | "ready" | "failed" | "unknown";
  assetsReady: boolean;
  diagnostics?: VideoPlaybackDiagnostics;
};

type PostRecord = Record<string, unknown>;

const PREVIEW_LABELS = new Set([
  "preview360",
  "preview360Avc",
  "preview180",
  "preview270",
]);

/**
 * Product order: adaptive first, then ladders, startups, originals via separate block.
 * (Preview + original fills happen after this chain.)
 */
const PRODUCTION_ORDER_HLS_FIRST: string[] = [
  "hls",
  "main1080Avc",
  "main1080",
  "main720Avc",
  "main720",
  "startup1080FaststartAvc",
  "startup1080Faststart",
  "startup720FaststartAvc",
  "startup720Faststart",
  "startup540FaststartAvc",
  "startup540Faststart",
];

/** Universal default prefers HLS per product contract (`preferHlsFirst` still available). */
const PRODUCTION_ORDER_MP4_BEFORE_HLS: string[] = [
  "main1080Avc",
  "main1080",
  "main720Avc",
  "main720",
  "hls",
  "startup1080FaststartAvc",
  "startup1080Faststart",
  "startup720FaststartAvc",
  "startup720Faststart",
  "startup540FaststartAvc",
  "startup540Faststart",
];

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

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | null | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/** Accepts string URLs or common wrapped shapes. */
export function extractVariantUrl(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t || undefined;
  }
  const o = asRecord(raw);
  if (!o) return undefined;
  return pickString(o.url, o.mp4, o.src, o.playback, o.manifest, o.uri);
}

function variantHeight(meta: PostRecord | null | undefined, key: string): number | null {
  if (!meta) return null;
  const row = asRecord(meta[key]);
  if (!row) return null;
  const h = pickNumber(row.height, row.pixelHeight);
  return h ?? null;
}

function variantCodec(meta: PostRecord | null | undefined, key: string): string | null {
  if (!meta) return null;
  const row = asRecord(meta[key]);
  if (!row) return null;
  return pickString(row.codec, row.videoCodec, row.video_codec) ?? null;
}

function isHevcHint(meta: PostRecord | null | undefined, key: string): boolean {
  const codec = variantCodec(meta, key)?.toLowerCase() ?? "";
  if (codec.includes("hevc") || codec.includes("h265") || codec.includes("h.265")) return true;
  const row = asRecord(meta?.[key]);
  const fmt = pickString(row?.format)?.toLowerCase() ?? "";
  return fmt.includes("hevc");
}

function generatedMaps(asset: PostRecord | null): PostRecord[] {
  if (!asset) return [];
  const out: PostRecord[] = [];
  const g1 = asRecord(asset.generated);
  if (g1) out.push(g1);
  const pl = asRecord(asset.playbackLab);
  const g2 = asRecord(pl?.generated);
  if (g2) out.push(g2);
  return out;
}

function lookupVariantUrl(asset: PostRecord | null, key: string): string | undefined {
  if (!asset) return undefined;
  const variants = asRecord(asset.variants) ?? {};
  const direct = extractVariantUrl(variants[key]);
  if (direct) return direct;
  for (const g of generatedMaps(asset)) {
    const u = extractVariantUrl(g[key]);
    if (u) return u;
  }
  return undefined;
}

/** True if any variant/generated URL differs from the canonical original (distinct transcode exists). */
function hasVariantDistinctFromOriginal(asset: PostRecord | null, orig: string | undefined): boolean {
  if (!asset || !orig) return false;
  const scan = (map: PostRecord | null | undefined): boolean => {
    if (!map) return false;
    for (const raw of Object.values(map)) {
      const u = extractVariantUrl(raw);
      if (u && isRemoteHttpUrl(u) && u !== orig) return true;
    }
    return false;
  };
  if (scan(asRecord(asset.variants) ?? undefined)) return true;
  for (const g of generatedMaps(asset)) {
    if (scan(g)) return true;
  }
  return false;
}

function hasNonPreviewVariantKeys(asset: PostRecord | null): boolean {
  const v = asRecord(asset?.variants) ?? {};
  for (const [k, raw] of Object.entries(v)) {
    if (!extractVariantUrl(raw)) continue;
    if (!isPreviewVariantLabel(k)) return true;
  }
  return false;
}

/** Common nested shapes: `{ media: { video: {...} }}` or `{ media: { type: "video", ... }}`. */
function syntheticVideoAssetFromMediaRoot(post: PostRecord): PostRecord | null {
  const mediaRoot = asRecord(post.media);
  if (!mediaRoot) return null;
  const nest =
    pickString(mediaRoot.type) === "video"
      ? mediaRoot
      : asRecord(mediaRoot.video) ?? asRecord(mediaRoot.mediaVideo);
  if (!nest || typeof nest !== "object") return null;
  const variants = asRecord(nest.variants) ?? {};
  const mergedVariants: PostRecord = { ...variants };
  const hoist = (key: string, val: unknown) => {
    const u = extractVariantUrl(val);
    if (u && !mergedVariants[key]) mergedVariants[key] = u;
  };
  hoist("hls", nest.hlsUrl ?? nest.hls ?? nest.masterUrl ?? nest.manifestUrl ?? nest.master);
  const posterUrl = pickString(nest.posterUrl, nest.poster, nest.thumbnail, nest.thumbUrl);
  const orig = pickString(
    nest.originalUrl,
    nest.original,
    nest.videoUrl,
    nest.mp4Url,
    nest.uploadUrl,
    extractVariantUrl(nest.uploaded),
    extractVariantUrl(nest.uploadedMp4),
  );
  const hasVariants = Object.keys(mergedVariants).length > 0;
  if (!hasVariants && !orig && !posterUrl) return null;
  return {
    type: "video",
    ...(pickString(nest.id) ? { id: nest.id } : {}),
    ...(posterUrl ? { poster: posterUrl, thumbnail: posterUrl } : {}),
    ...(orig ? { original: orig } : {}),
    ...(Object.keys(mergedVariants).length > 0 ? { variants: mergedVariants } : {}),
    ...(asRecord(nest.variantMetadata) ? { variantMetadata: asRecord(nest.variantMetadata) as PostRecord } : {}),
    ...(asRecord(nest.playbackLab) ? { playbackLab: asRecord(nest.playbackLab) as PostRecord } : {}),
    ...(asRecord(nest.generated) ? { generated: asRecord(nest.generated) as PostRecord } : {}),
    ...(pickBoolean((nest as { instantPlaybackReady?: unknown }).instantPlaybackReady) === true
      ? { instantPlaybackReady: true }
      : {}),
  };
}

function mergeVideoVariantsPreferExisting(base: PostRecord | null, extra: PostRecord | null): PostRecord | null {
  if (!base) return extra;
  if (!extra) return base;
  const bv = asRecord(base.variants) ?? {};
  const ev = asRecord(extra.variants) ?? {};
  const merged: PostRecord = {
    ...base,
    variants: { ...ev, ...bv },
  };
  if (!pickString(base.poster, base.thumbnail)) {
    const p = pickString(extra.poster as string | undefined, extra.thumbnail as string | undefined);
    if (p) {
      merged.poster = p;
      merged.thumbnail = p;
    }
  }
  if (!pickString(base.original as string | undefined)) {
    const o = pickString(extra.original as string | undefined);
    if (o) merged.original = o;
  }
  return merged;
}

function firstVideoAsset(post: PostRecord): PostRecord | null {
  const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];
  const fromArr = assets.find((a) => pickString(a?.type, a?.mediaType) === "video") ?? null;
  const synthetic = syntheticVideoAssetFromMediaRoot(post);
  if (fromArr && synthetic) return mergeVideoVariantsPreferExisting(fromArr, synthetic);
  return fromArr ?? synthetic;
}

function canonicalVariantAndRank(label: string): { variant: SelectedCanonicalVideoVariant; rank: number } {
  const l = label.toLowerCase();
  if (l === "none" || !label) return { variant: "none", rank: 0 };
  if (l === "hls") return { variant: "hls", rank: 8 };
  if (l.includes("startup1080")) return { variant: "startup1080", rank: 7 };
  if (l.includes("startup720")) return { variant: "startup720", rank: 6 };
  if (l.includes("startup540")) return { variant: "startup540", rank: 5 };
  if (l.includes("upgrade1080")) return { variant: "upgrade1080", rank: 6 };
  if (l.startsWith("main1080")) return { variant: "main1080", rank: 5 };
  if (l.startsWith("main720")) return { variant: "main720", rank: 4 };
  if (l === "preview360" || l === "preview360avc" || l.includes("preview")) return { variant: "preview360", rank: 2 };
  return { variant: "original", rank: 3 };
}

export function classifyCanonicalPlaybackUrl(
  url: string | null | undefined,
  playbackObject?: Record<string, unknown> | null,
  variants?: Record<string, unknown> | null,
): SelectedCanonicalVideoVariant {
  const u = typeof url === "string" ? url.trim() : "";
  if (!u) return "none";
  const pb = playbackObject ?? {};
  const vv = variants ?? {};
  const eq = (v: unknown) => typeof v === "string" && v.trim() && v.trim() === u;
  if (eq(pb.startupUrl) || eq(pb.defaultUrl) || eq(pb.goodNetworkUrl)) {
    if (eq(vv.startup1080FaststartAvc) || /startup1080_faststart_avc\.mp4/i.test(u)) return "startup1080";
    if (eq(vv.startup720FaststartAvc) || /startup720_faststart_avc\.mp4/i.test(u)) return "startup720";
    if (eq(vv.startup540FaststartAvc) || /startup540_faststart_avc\.mp4/i.test(u)) return "startup540";
  }
  if (eq(pb.weakNetworkUrl)) {
    if (eq(vv.startup720FaststartAvc) || /startup720_faststart_avc\.mp4/i.test(u)) return "startup720";
    if (eq(vv.startup540FaststartAvc) || /startup540_faststart_avc\.mp4/i.test(u)) return "startup540";
  }
  if (eq(pb.poorNetworkUrl)) {
    if (eq(vv.startup540FaststartAvc) || /startup540_faststart_avc\.mp4/i.test(u)) return "startup540";
  }
  if (eq(pb.upgradeUrl) || eq(vv.upgrade1080FaststartAvc) || /upgrade1080_faststart_avc\.mp4/i.test(u)) return "upgrade1080";
  if (eq(vv.startup1080FaststartAvc) || /startup1080_faststart_avc\.mp4/i.test(u)) return "startup1080";
  if (eq(vv.startup720FaststartAvc) || /startup720_faststart_avc\.mp4/i.test(u)) return "startup720";
  if (eq(vv.startup540FaststartAvc) || /startup540_faststart_avc\.mp4/i.test(u)) return "startup540";
  if (eq(vv.main1080Avc) || /main1080_avc\.mp4/i.test(u)) return "main1080";
  if (eq(vv.main720Avc) || /main720_avc\.mp4/i.test(u)) return "main720";
  if (eq(vv.preview360Avc) || /preview360_avc\.mp4/i.test(u)) return "preview360";
  if (eq(vv.hls) || /\.m3u8(\?|$)/i.test(u)) return "hls";
  if (eq(pb.fallbackUrl) || eq(pb.originalUrl)) return "original";
  return "original";
}

/**
 * Canonical entry points for tests and callers that want a descriptive name (`resolveBestVideoPlaybackMedia`).
 * Delegates to {@link selectBestVideoPlaybackAsset}; safe on unknown shapes (never throws).
 */
export function resolveBestVideoPlaybackMedia(
  postLike: Record<string, unknown> | null | undefined,
  options?: Partial<SelectBestVideoPlaybackOptions>,
): VideoPlaybackSelection {
  return selectBestVideoPlaybackAsset(postLike, {
    hydrationMode: options?.hydrationMode ?? "detail",
    allowPreviewOnly: options?.allowPreviewOnly !== false,
    ...(options?.preferHlsFirst != null ? { preferHlsFirst: options.preferHlsFirst } : {}),
    requireProductionVariantForPlayback: options?.requireProductionVariantForPlayback,
    includeDiagnostics: options?.includeDiagnostics,
  });
}

function originalUrlForAsset(asset: PostRecord | null): string | undefined {
  const snap = asRecord(asRecord(asset?.playbackLab)?.sourceSnapshot);
  return pickString(asset?.original, snap?.original);
}

function pickFallbackOriginal(asset: PostRecord | null, playbackUrl?: string): string | undefined {
  const original = originalUrlForAsset(asset);
  if (!original || !isRemoteHttpUrl(original)) return undefined;
  if (playbackUrl && original === playbackUrl) return undefined;
  return original;
}

export function isPreviewVariantLabel(label: string): boolean {
  return PREVIEW_LABELS.has(label);
}

export function playbackBatchShouldFetchFirestoreDetail(postLike: Record<string, unknown> | null | undefined): boolean {
  const post = asRecord(postLike) ?? {};
  const hasVideo =
    pickString(post.mediaType) === "video" ||
    (Array.isArray(post.assets) && (post.assets as PostRecord[]).some((a) => pickString(a?.type, a?.mediaType) === "video")) ||
    syntheticVideoAssetFromMediaRoot(post) != null;
  if (!hasVideo) return false;

  const sel = selectBestVideoPlaybackAsset(postLike, {
    hydrationMode: "playback",
    allowPreviewOnly: true,
    /** Same default ladder semantics as feeds / detail (HLS adaptive first). */
  });
  if (!sel.playbackUrl && !sel.fallbackVideoUrl) return true;
  /** Prefer loading source-of-truth when the shell only has preview-tier playable bytes. */
  if (sel.isPreviewOnly) return true;
  return false;
}

function scanCommaUrlCardinality(...values: unknown[]): number {
  let max = 0;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const parts = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^https?:\/\//i.test(entry));
    max = Math.max(max, parts.length);
  }
  return max;
}

function rawFirestoreAssetArrayLen(record: PostRecord | null): number {
  if (!record) return 0;
  if (!Array.isArray(record.assets)) return 0;
  let count = 0;
  for (const entry of record.assets) {
    if (entry && typeof entry === "object") count += 1;
  }
  return Math.min(64, count);
}

function pickEmbeddedRawFirestoreAssetLen(post: PostRecord): number {
  let max = 0;
  for (const blob of [post.rawPost, post.sourcePost]) {
    max = Math.max(max, rawFirestoreAssetArrayLen(asRecord(blob)));
  }
  const card = asRecord(post.cardSummary);
  if (card) {
    for (const blob of [card.rawPost, card.sourcePost]) {
      max = Math.max(max, rawFirestoreAssetArrayLen(asRecord(blob)));
    }
  }
  /** Explicit envelope field survives cache payloads that omit nested raw blobs. */
  const declaredFromPost = pickNumber(post.rawFirestoreAssetCount);
  if (typeof declaredFromPost === "number" && Number.isFinite(declaredFromPost)) {
    max = Math.max(max, Math.min(64, Math.floor(declaredFromPost)));
  }
  const declaredFromCard = card ? pickNumber(card.rawFirestoreAssetCount) : undefined;
  if (typeof declaredFromCard === "number" && Number.isFinite(declaredFromCard)) {
    max = Math.max(max, Math.min(64, Math.floor(declaredFromCard)));
  }
  return max;
}

function hintedCarouselCardinality(post: PostRecord): number {
  let max = 0;
  const bump = (raw: unknown): void => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return;
    const n = Math.floor(raw);
    if (n >= 2 && n <= 64) max = Math.max(max, n);
  };
  bump(post.assetCount);
  max = Math.max(max, pickEmbeddedRawFirestoreAssetLen(post));
  const card = asRecord(post.cardSummary);
  if (card) {
    bump(card.assetCount);
    bump(card.derivedAssetCount);
    const legacy = asRecord(card.legacy);
    max = Math.max(
      max,
      scanCommaUrlCardinality(
        card.photoLink,
        card.displayPhotoLink,
        legacy?.photoLink,
        legacy?.photoLinks2,
        legacy?.photoLinks3,
      ),
    );
  }
  const legacyTop = asRecord(post.legacy);
  max = Math.max(
    max,
    scanCommaUrlCardinality(
      post.photoLink,
      post.displayPhotoLink,
      legacyTop?.photoLink,
      legacyTop?.photoLinks2,
      legacyTop?.photoLinks3,
    ),
  );
  const locs = Array.isArray(post.assetLocations) ? post.assetLocations.length : 0;
  if (locs >= 2) max = Math.max(max, Math.min(64, locs));
  if (pickBoolean(post.hasMultipleAssets) === true || (card && pickBoolean(card.hasMultipleAssets) === true)) {
    max = Math.max(max, 2);
  }
  return max;
}

function primaryStillFingerprint(asset: PostRecord | null | undefined): string {
  if (!asset) return "";
  const variants = asRecord(asset.variants);
  const canon =
    pickString(
      asset.original,
      asset.poster,
      asset.thumbnail,
      extractVariantUrl(variants?.lg),
      extractVariantUrl(variants?.md),
      extractVariantUrl(variants?.webp),
    ) ?? "";
  if (canon) return canon;
  const id = pickString(asset.id) ?? "";
  return `id:${id}`;
}

/**
 * Playback-mode batch: postcard cache often carries a slim `assets[]` for gallery posts while
 * `photoLink` / `assetCount` still reflect the real gallery size. When true, callers should
 * upgrade from Firestore subject to their read cap (see posts detail batch orchestrator).
 */
export function playbackBatchCarouselIncompleteMedia(postLike: Record<string, unknown> | null | undefined): boolean {
  const post = asRecord(postLike) ?? {};
  const wantsVideoFirestore = playbackBatchShouldFetchFirestoreDetail(postLike);
  const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];
  const hinted = hintedCarouselCardinality(post);
  const shellLen = assets.length;

  /** Client / envelope marks carousel as intentionally slim — upgrade even if playback video looks ready. */
  if (pickBoolean(post.requiresAssetHydration) === true) return true;
  if (pickString(post.mediaCompleteness)?.toLowerCase() === "cover_only") return true;

  /** Video-only Firestore fetch does not implicitly repair multi-asset galleries; evaluate carouselNeeds separately. */

  const declaredCount =
    typeof post.assetCount === "number" && Number.isFinite(post.assetCount)
      ? Math.floor(post.assetCount)
      : null;
  const rawLen = pickEmbeddedRawFirestoreAssetLen(post);
  const expectationFloor = Math.max(
    hinted,
    declaredCount != null && declaredCount >= 2 && declaredCount <= 64 ? declaredCount : 0,
    rawLen >= 2 ? rawLen : 0,
  );
  if (expectationFloor >= 2 && shellLen < expectationFloor) return true;
  if (pickBoolean(post.hasMultipleAssets) === true && shellLen <= 1) return true;

  if (shellLen <= 1) {
    /** Single slot on-shell: only "complete" if no hint expects a gallery AND video does not independently need reads. */
    if (hinted <= 1 && rawLen <= 1 && !(declaredCount != null && declaredCount >= 2) && pickBoolean(post.hasMultipleAssets) !== true) {
      return false;
    }
    /** When video resolver still wants Firestore, defer to video upgrade for this row (carousel flag optional). */
    if (wantsVideoFirestore) return false;
    if (hinted <= 1 && rawLen <= 1 && !(declaredCount != null && declaredCount >= 2)) return false;
    return true;
  }
  const prints = new Set(assets.map((a) => primaryStillFingerprint(a)));
  if (prints.size <= 1 && shellLen >= 2) return true;
  const ids = assets.map((a) => pickString(a.id)).filter(Boolean);
  const uniqIds = new Set(ids);
  if (hinted >= 2 && ids.length >= 2 && uniqIds.size === 1) return true;
  if (hinted >= shellLen + 1 || (hinted >= 2 && shellLen !== hinted)) return true;
  return false;
}

/** @see {@link playbackBatchCarouselIncompleteMedia} */
export function playbackBatchNeedsPhotoCarouselFirestoreDetail(
  postLike: Record<string, unknown> | null | undefined,
): boolean {
  return playbackBatchCarouselIncompleteMedia(postLike);
}

/**
 * Single entry: pick playback + fallback + poster for the first video asset.
 */
export function selectBestVideoPlaybackAsset(
  postLike: Record<string, unknown> | null | undefined,
  options: SelectBestVideoPlaybackOptions,
): VideoPlaybackSelection {
  const post = asRecord(postLike) ?? {};
  const includeDiagnostics = options.includeDiagnostics === true;
  const candidatesTried: string[] = [];
  /** Default `true` favors HLS; pass `preferHlsFirst: false` to prefer MP4 ladder before HLS. */
  const preferHlsFirst = options.preferHlsFirst !== false;
  const chain = preferHlsFirst ? PRODUCTION_ORDER_HLS_FIRST : PRODUCTION_ORDER_MP4_BEFORE_HLS;

  const asset = firstVideoAsset(post);
  const hasVideo = asset != null || pickString(post.mediaType) === "video";
  const posterUrl = pickString(
    asset?.poster,
    asset?.thumbnail,
    extractVariantUrl(asRecord(asset?.variants)?.poster),
    post.posterUrl,
    post.thumbUrl,
    extractVariantUrl(asRecord(post.media)?.poster),
    extractVariantUrl(asRecord(asRecord(post.media)?.video)?.poster),
  );

  const mediaRoot = asRecord(post.media);
  const videoNestMedia =
    mediaRoot && pickString(mediaRoot.type) === "video" ? mediaRoot : asRecord(mediaRoot?.video ?? mediaRoot?.mediaVideo);
  const postLevelPlayback = pickString(
    post.playbackUrl,
    post.videoUrl,
    extractVariantUrl(mediaRoot?.playbackUrl),
    extractVariantUrl(mediaRoot?.videoUrl),
    extractVariantUrl(mediaRoot?.hls),
    typeof mediaRoot?.hlsUrl === "string" ? mediaRoot.hlsUrl : undefined,
    extractVariantUrl(videoNestMedia?.playbackUrl),
    extractVariantUrl(videoNestMedia?.hlsUrl ?? videoNestMedia?.hls),
    extractVariantUrl(videoNestMedia?.masterUrl ?? videoNestMedia?.manifestUrl),
    extractVariantUrl(videoNestMedia?.videoUrl ?? videoNestMedia?.mp4Url),
  );
  const postLevelFallback = pickString(post.fallbackVideoUrl);

  const assetsReady = pickBoolean(post.assetsReady) === true;
  const videoProcessingStatus = pickString(post.videoProcessingStatus);
  /**
   * `assetsReady`/processing gates must NOT hide verified HTTPS originals or partial variants.
   * Clients still read `mediaStatus` / `assetsReady` for spinner semantics.
   */
  const allowFallbackAsCanonicalPlayback = true;
  const variantMetadata = asRecord(asset?.variantMetadata);

  let deferredHevcMain1080 = false;
  let selectedLabel = "none";
  let selectedUrl: string | undefined;
  let selectedHeight: number | null = null;
  let selectedCodec: string | null = null;
  let reason = "no_video_asset";

  const hasAvcSibling = (): boolean => {
    return Boolean(
      lookupVariantUrl(asset, "main1080Avc") ||
        lookupVariantUrl(asset, "main720Avc") ||
        lookupVariantUrl(asset, "main720") ||
        lookupVariantUrl(asset, "hls") ||
        chain.some((k) => k.startsWith("startup") && lookupVariantUrl(asset, k)),
    );
  };

  if (asset) {
    reason = "variant_scan";
    outer: for (const key of chain) {
      candidatesTried.push(key);
      if (key === "main1080" && variantMetadata && isHevcHint(variantMetadata, "main1080") && hasAvcSibling()) {
        deferredHevcMain1080 = true;
        continue;
      }
      if (key === "main720" && variantMetadata && isHevcHint(variantMetadata, "main720") && lookupVariantUrl(asset, "main720Avc")) {
        continue;
      }
      const url = lookupVariantUrl(asset, key);
      if (!url || !isRemoteHttpUrl(url)) continue;
      const orig = originalUrlForAsset(asset);
      const distinctTranscode = hasVariantDistinctFromOriginal(asset, orig);
      const ladderOrAdaptive =
        key.startsWith("main") || key.startsWith("startup") || key === "hls" || isPreviewVariantLabel(key);
      if (orig && url === orig && !ladderOrAdaptive) {
        continue;
      }
      if (
        orig &&
        url === orig &&
        (key.startsWith("main") || isPreviewVariantLabel(key)) &&
        !distinctTranscode &&
        key !== "hls" &&
        !key.startsWith("startup")
      ) {
        continue;
      }
      selectedLabel = key;
      selectedUrl = url;
      selectedHeight = variantHeight(variantMetadata, key);
      selectedCodec = variantCodec(variantMetadata, key);
      break outer;
    }

    const allowPreview = options.allowPreviewOnly !== false;
    if (!selectedUrl && allowPreview) {
      const origForPreview = originalUrlForAsset(asset);
      for (const key of ["preview360Avc", "preview360"] as const) {
        candidatesTried.push(key);
        const url = lookupVariantUrl(asset, key);
        if (!url || !isRemoteHttpUrl(url)) continue;
        if (origForPreview && url === origForPreview && hasNonPreviewVariantKeys(asset)) {
          continue;
        }
        selectedLabel = key;
        selectedUrl = url;
        reason = "preview_only";
        break;
      }
    }

    if (!selectedUrl) {
      const orig = originalUrlForAsset(asset);
      if (orig && isRemoteHttpUrl(orig)) {
        selectedLabel = "original";
        selectedHeight = variantHeight(variantMetadata, "original");
        selectedCodec = variantCodec(variantMetadata, "original");
        reason = "original_only";
        if (allowFallbackAsCanonicalPlayback) {
          selectedUrl = orig;
        }
      }
    }
  }

  if (!selectedUrl && postLevelPlayback && isRemoteHttpUrl(postLevelPlayback)) {
    selectedUrl = postLevelPlayback;
    selectedLabel = "post_level_playback";
    reason = "post_level_playback";
  }

  let fallbackVideoUrl = pickFallbackOriginal(asset, selectedUrl) ?? postLevelFallback;

  let playbackUrl = selectedUrl;
  if (!playbackUrl && allowFallbackAsCanonicalPlayback && fallbackVideoUrl && isRemoteHttpUrl(fallbackVideoUrl)) {
    playbackUrl = fallbackVideoUrl;
    if (selectedLabel === "none") {
      selectedLabel = "fallback_original";
      reason = "fallback_as_playback";
    }
  }

  const isPreviewOnly = Boolean(playbackUrl && isPreviewVariantLabel(selectedLabel));
  const productionPlaybackSelected = Boolean(playbackUrl) && !isPreviewOnly;
  const isProductionPlayback = productionPlaybackSelected;

  let mediaStatusHint: VideoPlaybackSelection["mediaStatusHint"] = "unknown";
  if (!hasVideo) mediaStatusHint = "unknown";
  else if (videoProcessingStatus === "failed") mediaStatusHint = "failed";
  else if (videoProcessingStatus === "completed" && assetsReady) mediaStatusHint = "ready";
  else mediaStatusHint = "processing";

  const selectedVideoVariant = classifyCanonicalPlaybackUrl(
    playbackUrl ?? selectedUrl,
    asRecord(asset?.playback),
    asRecord(asset?.variants),
  );
  const { rank: selectedVideoQualityRank } = canonicalVariantAndRank(
    selectedVideoVariant === "none" ? selectedLabel : selectedVideoVariant,
  );
  const isDegradedVideo = Boolean(isPreviewOnly && playbackUrl);

  const base: VideoPlaybackSelection = {
    ...(playbackUrl ? { playbackUrl } : {}),
    ...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    selectedVariantLabel: selectedLabel,
    selectedVideoVariant,
    selectedVideoQualityRank,
    isDegradedVideo,
    selectedVariantHeight: selectedHeight,
    selectedVariantCodec: selectedCodec,
    selectedVariantSource: selectedLabel,
    isPreviewOnly,
    isProductionPlayback,
    productionPlaybackSelected,
    mediaStatusHint,
    assetsReady,
  };

  if (includeDiagnostics) {
    base.diagnostics = {
      reason,
      candidatesTried,
      deferredHevcMain1080,
    };
  }

  return base;
}
