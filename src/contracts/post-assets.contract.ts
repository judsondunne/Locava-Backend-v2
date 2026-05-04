/**
 * Canonical post media normalization — single source of truth for backend serialization
 * and the reference contract for defensive client normalization.
 */

export type NormalizedDiagnosticsSource =
  | "modern-assets"
  | "legacy-photo-links"
  | "single-photo-link"
  | "video-poster"
  | "empty";

export type NormalizePostAssetsOptions = {
  postId?: string | null;
  /** When true and NODE_ENV !== "production", attach diagnostics.warnings etc. */
  devDiagnostics?: boolean;
  route?: string | null;
};

export type NormalizedPostAssetPlayback = {
  hls?: string;
  preview360?: string;
  preview360Avc?: string;
  main720?: string;
  main720Avc?: string;
  main1080?: string;
  main1080Avc?: string;
  preferredUri?: string;
  poster?: string;
};

export type NormalizedPostAsset = {
  id: string;
  index: number;
  type: "image" | "video";
  uri: string;
  original?: string;
  /** Image: best display URL. Video: playable URL (never the poster alone). */
  displayUri: string;
  posterUri?: string;
  posterUrl?: string;
  aspectRatio?: number;
  width?: number;
  height?: number;
  orientation?: string;
  blurhash?: string;
  variants?: Record<string, unknown>;
  variantMetadata?: Record<string, unknown>;
  playback?: NormalizedPostAssetPlayback;
};

export type NormalizedPostAssetsResult = {
  assets: NormalizedPostAsset[];
  coverAsset: NormalizedPostAsset | null;
  displayPhotoLink: string | null;
  photoLink: string | null;
  assetCount: number;
  hasMultipleAssets: boolean;
  assetsReady: boolean | null;
  diagnostics?: {
    source: NormalizedDiagnosticsSource;
    droppedInvalidAssets: number;
    dedupedAssets: number;
    repairedAssets: number;
    warnings: string[];
    rawAssetCount?: number;
    normalizedUriSamples?: string[];
  };
};

type PostRecord = Record<string, unknown>;

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
  }
  return undefined;
}

function extractVariantUrl(value: unknown): string | undefined {
  if (typeof value === "string") return pickString(value);
  const record = asRecord(value);
  if (!record) return undefined;
  return pickString(record.webp, record.jpg, record.url, record.uri, record.src, record.value);
}

function isLikelyRemoteUrlString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return /^https?:\/\//i.test(t);
}

function mergeVariantMaps(...sources: Array<PostRecord | null | undefined>): PostRecord | undefined {
  const merged: PostRecord = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value == null) continue;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) merged[key] = trimmed;
        continue;
      }
      const prev = merged[key];
      if (isLikelyRemoteUrlString(prev)) {
        continue;
      }
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function commaSplitUrls(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function allLegacyPhotoUrls(source: PostRecord): string[] {
  const legacy = asRecord(source.legacy) ?? {};
  const ordered = [
    ...commaSplitUrls(source.photoLink),
    ...commaSplitUrls(legacy.photoLink),
    ...commaSplitUrls(source.photoLinks2),
    ...commaSplitUrls(legacy.photoLinks2),
    ...commaSplitUrls(source.photoLinks3),
    ...commaSplitUrls(legacy.photoLinks3),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of ordered) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function normalizeMediaType(source: PostRecord): "image" | "video" {
  const top = pickString(source.mediaType, source.type);
  if (top === "video") return "video";
  if (Array.isArray(source.assets)) {
    for (const entry of source.assets) {
      const asset = asRecord(entry);
      if (!asset) continue;
      if (pickString(asset.type, asset.mediaType)?.toLowerCase() === "video") return "video";
    }
  }
  return "image";
}

function resolvePlaybackLabAssetMap(source: PostRecord): PostRecord | null {
  return asRecord(asRecord(source.playbackLab)?.assets);
}

function resolveAssetFromPlaybackLab(
  playbackAssets: PostRecord | null,
  assetId: string,
  index: number,
): PostRecord | null {
  if (!playbackAssets) return null;
  const byId = asRecord(playbackAssets[assetId]);
  if (byId) return byId;
  const entries = Object.values(playbackAssets)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is PostRecord => entry != null);
  return entries[index] ?? entries[0] ?? null;
}

/** Image display URI per contract: lg → md → sm → fallbackJpg → original → uri → url */
export function resolveImageDisplayUri(
  variants: PostRecord | undefined,
  asset: PostRecord,
  posterFallback: string | null,
): string {
  return (
    pickString(
      extractVariantUrl(variants?.lg),
      extractVariantUrl(variants?.md),
      extractVariantUrl(variants?.sm),
      extractVariantUrl(variants?.fallbackJpg),
      typeof asset.original === "string" ? asset.original : undefined,
      typeof asset.url === "string" ? asset.url : undefined,
      typeof asset.uri === "string" ? asset.uri : undefined,
      posterFallback ?? undefined,
    ) ?? ""
  );
}

/** Video playable URI: prefer HLS for players that support it; AVC 720 otherwise; preserve preview360 for instant preview. */
export function buildVideoPlayback(
  variants: PostRecord | undefined | null,
  asset: PostRecord,
): NormalizedPostAssetPlayback {
  const v = (variants ?? {}) as PostRecord;
  const hlsPick =
    typeof v.hls === "string"
      ? v.hls
      : extractVariantUrl(v.hls) ?? pickString(asset.streamUrl);
  const hls = pickString(hlsPick, asset.streamUrl);
  const preview360 = pickString(
    extractVariantUrl(v.preview360),
    typeof v.preview360 === "string" ? v.preview360 : undefined,
  );
  const preview360Avc = pickString(
    typeof v.preview360Avc === "string" ? v.preview360Avc : undefined,
    extractVariantUrl(v.preview360Avc),
  );
  const main720 = pickString(typeof v.main720 === "string" ? v.main720 : undefined);
  const main720Avc = pickString(typeof v.main720Avc === "string" ? v.main720Avc : undefined);
  const main1080 = pickString(typeof v.main1080 === "string" ? v.main1080 : undefined);
  const main1080Avc = pickString(typeof v.main1080Avc === "string" ? v.main1080Avc : undefined);
  const fromAsset = pickString(asset.original, asset.mp4Url, asset.streamUrl);
  const preferredUri =
    pickString(hls, main720Avc, main720, main1080Avc, main1080, preview360Avc, preview360, fromAsset) ?? "";
  const poster =
    pickString(
      asset.poster,
      asset.posterUrl,
      asset.thumbnail,
      extractVariantUrl(v.poster),
      typeof v.poster === "string" ? v.poster : undefined,
    ) ?? undefined;
  return {
    ...(hls ? { hls } : {}),
    ...(preview360 ? { preview360 } : {}),
    ...(preview360Avc ? { preview360Avc } : {}),
    ...(main720 ? { main720 } : {}),
    ...(main720Avc ? { main720Avc } : {}),
    ...(main1080 ? { main1080 } : {}),
    ...(main1080Avc ? { main1080Avc } : {}),
    preferredUri,
    ...(poster ? { poster } : {}),
  };
}

function coverDisplayFromAsset(a: NormalizedPostAsset): string {
  return a.type === "video"
    ? pickString(a.posterUri, a.posterUrl, a.playback?.poster) ?? ""
    : a.displayUri;
}

export function normalizePostAssets(
  rawPost: PostRecord | null | undefined,
  options: NormalizePostAssetsOptions = {},
): NormalizedPostAssetsResult {
  const source = rawPost ?? {};
  const postId =
    pickString(options.postId, source.postId, source.id)?.trim() ??
    ("unknown-post" as string);
  const mediaTypeTop = normalizeMediaType(source);

  const devDiag = Boolean(options.devDiagnostics && process.env.NODE_ENV !== "production");
  const warnings: string[] = [];

  let droppedInvalidAssets = 0;
  let dedupedAssets = 0;

  const rawAssets = Array.isArray(source.assets) ? source.assets : [];
  const rawAssetCount = rawAssets.length;

  const playbackAssets = resolvePlaybackLabAssetMap(source);

  const modernAssets: NormalizedPostAsset[] = [];

  const pushDeduped = (candidate: NormalizedPostAsset | null): void => {
    if (!candidate || !candidate.displayUri) {
      droppedInvalidAssets += 1;
      return;
    }
    const dupId = modernAssets.some((existing) => existing.id === candidate.id);
    if (dupId) {
      dedupedAssets += 1;
      if (devDiag) warnings.push(`dedupe_skip_id:${candidate.id}`);
      return;
    }
    modernAssets.push(candidate);
  };

  if (rawAssets.length > 0) {
    rawAssets.forEach((entry, index) => {
      const asset = asRecord(entry);
      if (!asset) {
        droppedInvalidAssets += 1;
        return;
      }
      const assetId = pickString(asset.id, asset.assetId) ?? `${postId}-asset-${index + 1}`;
      const labAsset = resolveAssetFromPlaybackLab(playbackAssets, assetId, index);
      const sourceSnapshot = asRecord(labAsset?.sourceSnapshot);
      const variants =
        mergeVariantMaps(
          asRecord(asset.variants),
          asRecord(asset.variantMetadata),
          asRecord(asset.generated),
          asRecord(asset.playbackLab),
          asRecord(sourceSnapshot?.variants),
          asRecord(labAsset?.generated),
        ) ?? {};

      const declared = pickString(asset.type, asset.mediaType)?.toLowerCase();
      const assetType: "image" | "video" =
        declared === "video"
          ? "video"
          : declared === "image"
            ? "image"
            : mediaTypeTop === "video" && rawAssets.length === 1
              ? "video"
              : "image";

      const posterFallback =
        pickString(
          asset.poster,
          asset.posterUrl,
          asset.thumbnail,
          extractVariantUrl(variants.poster),
          index === 0 ? source.posterUrl : undefined,
          index === 0 ? source.poster : undefined,
          index === 0 ? source.displayPhotoLink : undefined,
          index === 0 ? source.thumbUrl : undefined,
        ) ?? null;

      const blurhash = pickString(asset.blurhash) ?? undefined;
      const width = pickNumber(asset.width);
      const height = pickNumber(asset.height);
      const aspectRatio = pickNumber(asset.aspectRatio);
      const orientation = pickString(asset.orientation);

      const variantMetadataRecord = asRecord(asset.variantMetadata);
      const base: Omit<NormalizedPostAsset, "displayUri" | "playback"> = {
        id: assetId,
        index,
        type: assetType,
        uri:
          pickString(
            typeof asset.original === "string" ? asset.original : undefined,
            typeof asset.url === "string" ? asset.url : undefined,
          ) ?? "",
        original: pickString(
          typeof asset.original === "string" ? asset.original : undefined,
          typeof asset.url === "string" ? asset.url : undefined,
        ),
        posterUri: posterFallback ?? undefined,
        posterUrl: posterFallback ?? undefined,
        ...(blurhash !== undefined ? { blurhash } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(aspectRatio !== undefined ? { aspectRatio } : {}),
        ...(orientation !== undefined ? { orientation } : {}),
        variants: Object.keys(variants).length > 0 ? variants : undefined,
        ...(variantMetadataRecord && Object.keys(variantMetadataRecord).length > 0
          ? { variantMetadata: variantMetadataRecord as Record<string, unknown> }
          : {}),
      };

      if (assetType === "video") {
        const playback = buildVideoPlayback(variants as PostRecord, asset);
        const displayUri = pickString(
          playback.preferredUri && playback.preferredUri.length > 0 ? playback.preferredUri : undefined,
          playback.preview360,
          playback.main720,
          playback.hls,
        );
        const posterUri =
          pickString(
            playback.poster,
            posterFallback ?? undefined,
            extractVariantUrl(variants.poster),
          ) ?? undefined;

        pushDeduped({
          ...base,
          posterUri,
          posterUrl: posterUri,
          displayUri: displayUri ?? "",
          playback,
        });
      } else {
        const displayUri = resolveImageDisplayUri(variants as PostRecord | undefined, asset, posterFallback);
        pushDeduped({
          ...base,
          displayUri,
        });
      }
    });

  }

  let sourceDiag: NormalizedDiagnosticsSource =
    rawAssetCount > 0 && modernAssets.length > 0
      ? "modern-assets"
      : rawAssetCount > 0 && modernAssets.length === 0
        ? "empty"
        : "legacy-photo-links";

  if (modernAssets.length === 0) {
    dedupedAssets = 0;
    droppedInvalidAssets = 0;
    const urls = allLegacyPhotoUrls(source);
    const inferredVideo = normalizeMediaType(source) === "video";
    if (urls.length >= 2) {
      urls.forEach((url, idx) => {
        modernAssets.push({
          id: `legacy_image_${idx}`,
          index: idx,
          type: "image",
          uri: url,
          displayUri: url,
          original: url,
        });
      });
      sourceDiag = "legacy-photo-links";
    } else if (urls.length === 1 || pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink)) {
      const single =
        urls[0] ??
        pickString(source.displayPhotoLink, source.photoLink, source.thumbUrl) ??
        "";
      if (inferredVideo || pickString(source.mediaType) === "video") {
        const variants =
          mergeVariantMaps(asRecord(source.variants), asRecord(source.variantMetadata)) ?? {};
        const playback = buildVideoPlayback(asRecord(variants), source);
        const posterUri =
          pickString(
            playback.poster,
            source.posterUrl,
            source.poster,
            source.displayPhotoLink,
            source.thumbUrl,
            single,
          ) ?? single;
        const displayUri =
          pickString(
            playback.preferredUri && playback.preferredUri.length > 0 ? playback.preferredUri : undefined,
            single,
          ) ?? "";
        modernAssets.push({
          id: `${postId}-legacy-video-0`,
          index: 0,
          type: "video",
          uri: pickString(displayUri, single) ?? "",
          original: pickString(displayUri, single),
          displayUri,
          posterUri,
          posterUrl: posterUri,
          playback,
        });
        sourceDiag = urls.length >= 1 ? "legacy-photo-links" : "video-poster";
      } else {
        modernAssets.push({
          id: `${postId}-legacy-image-0`,
          index: 0,
          type: "image",
          uri: single,
          displayUri: single,
          original: single,
        });
        sourceDiag = "single-photo-link";
      }
    } else {
      sourceDiag = "empty";
    }
  }

  modernAssets.forEach((a, i) => {
    a.index = i;
  });

  const coverAsset = modernAssets[0] ?? null;
  const coverImage =
    coverAsset != null
      ? coverDisplayFromAsset(coverAsset)?.trim()
      : pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink) ?? "";

  const displayPhotoLink = pickString(source.displayPhotoLink, coverImage, source.thumbUrl) ?? coverImage ?? null;

  const head = modernAssets[0];
  let photoLink: string | null =
    head && head.type === "image"
      ? head.displayUri
      : head && head.type === "video"
        ? head.posterUri ?? head.posterUrl ?? displayPhotoLink
        : pickString(source.photoLink, displayPhotoLink) ?? displayPhotoLink;

  const assetCount = modernAssets.length;
  const hasMultipleAssets = assetCount > 1;

  let assetsReady: boolean | null = null;
  if (typeof source.assetsReady === "boolean") assetsReady = source.assetsReady;

  if (devDiag) {
    if (rawAssetCount > assetCount && rawAssetCount > 0 && sourceDiag === "modern-assets") {
      warnings.push("raw_assets_exceed_normalized");
    }
    const uriSet = new Set(modernAssets.map((a) => a.displayUri).filter(Boolean));
    if (hasMultipleAssets && uriSet.size === 1 && modernAssets[0]?.type !== "video") {
      warnings.push("multi_asset_same_display_uri");
    }
  }

  return {
    assets: modernAssets,
    coverAsset,
    displayPhotoLink: displayPhotoLink ? displayPhotoLink : null,
    photoLink,
    assetCount,
    hasMultipleAssets,
    assetsReady,
    ...(devDiag
      ? {
          diagnostics: {
            source: sourceDiag,
            droppedInvalidAssets,
            dedupedAssets,
            repairedAssets: 0,
            warnings,
            rawAssetCount,
            normalizedUriSamples: modernAssets.map((a) => a.displayUri).slice(0, 12),
          },
        }
      : {}),
  };
}

/** Map canonical assets onto Firestore/card-shaped rows used by FeedCardDTO / clients. */
export function normalizedAssetsToEnvelopeRows(assets: NormalizedPostAsset[]): PostRecord[] {
  return assets.map((a, index) => {
    const variants = asRecord(a.variants) ?? {};
    const playback = a.playback;
    const base: PostRecord = {
      id: a.id,
      assetId: a.id,
      type: a.type,
      blurhash: a.blurhash ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      aspectRatio: a.aspectRatio ?? null,
      orientation: a.orientation ?? null,
      variants: variants && Object.keys(variants).length > 0 ? variants : {},
      uri: a.displayUri,
      displayUri: a.displayUri,
      posterUri: a.posterUri ?? a.posterUrl ?? null,
    };
    if (a.type === "video") {
      return {
        ...base,
        previewUrl:
          pickString(playback?.preview360, playback?.preview360Avc, a.displayUri) ?? a.displayUri,
        posterUrl: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,
        poster: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,
        thumbnail: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,
        originalUrl: a.original ?? a.uri ?? null,
        original: a.original ?? a.uri ?? null,
        streamUrl: playback?.hls ?? null,
        mp4Url: pickString(playback?.main720Avc, playback?.main720, playback?.main1080Avc, playback?.main1080),
        ...(playback ? { playback } : {}),
      };
    }
    return {
      ...base,
      previewUrl: a.displayUri,
      posterUrl: a.posterUri ?? a.displayUri ?? null,
      poster: a.posterUri ?? a.displayUri ?? null,
      thumbnail: a.posterUri ?? a.displayUri ?? null,
      originalUrl: a.original ?? a.displayUri ?? null,
      original: a.original ?? a.displayUri ?? null,
    };
  }) as PostRecord[];
}
