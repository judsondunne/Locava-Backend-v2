/**
 * Canonical production playback URL selection for post video assets.
 * Uses only Firestore-shaped fields — no network probes.
 */

export type VideoHydrationMode = "card" | "playback" | "detail" | "open" | "full";

/** UI / analytics bucket for the resolver's primary URL (maps many internal labels → stable enum). */
export type SelectedCanonicalVideoVariant =
  | "hls"
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
  if (l === "hls") return { variant: "hls", rank: 6 };
  if (l.includes("startup1080")) return { variant: "main1080", rank: 5 };
  if (l.startsWith("main1080")) return { variant: "main1080", rank: 5 };
  if (l.includes("startup720") || l.includes("startup540")) return { variant: "main720", rank: 4 };
  if (l.startsWith("main720")) return { variant: "main720", rank: 4 };
  if (l === "preview360" || l === "preview360avc" || l.includes("preview")) return { variant: "preview360", rank: 2 };
  /** post_level_* and originals */
  return { variant: "original", rank: 3 };
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

  const { variant: selectedVideoVariant, rank: selectedVideoQualityRank } = canonicalVariantAndRank(selectedLabel);
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
