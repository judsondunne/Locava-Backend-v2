import type { CanonicalizationError, CanonicalizationWarning, MasterPostV2 } from "../../../contracts/master-post-v2.types.js";

type RawPost = Record<string, unknown>;

export function diffMasterPostPreview(input: {
  raw: RawPost | null;
  canonical: MasterPostV2;
  recoveredLegacyAssets: number;
  dedupedAssets: number;
  warnings: CanonicalizationWarning[];
  errors: CanonicalizationError[];
  processingDebugExtracted: boolean;
}) {
  const raw = input.raw ?? {};
  const canonicalTopLevel = Object.keys(input.canonical);
  const rawTopLevel = new Set(Object.keys(raw));
  const fieldsAdded = canonicalTopLevel.filter((k) => !rawTopLevel.has(k));
  const fieldsChanged = canonicalTopLevel.filter((k) => rawTopLevel.has(k));

  const videoAssets = input.canonical.media.assets.filter((a) => a.type === "video");
  const selectedVideoUrls = videoAssets.map((asset) => ({
    assetId: asset.id,
    primaryUrl: asset.video?.playback.primaryUrl ?? null,
    startupUrl: asset.video?.playback.startupUrl ?? null,
    upgradeUrl: asset.video?.playback.upgradeUrl ?? null,
    hlsUrl: asset.video?.playback.hlsUrl ?? null,
    fallbackUrl: asset.video?.playback.fallbackUrl ?? null,
    previewUrl: asset.video?.playback.previewUrl ?? null
  }));

  return {
    fieldsAdded,
    fieldsChanged,
    mediaAssetCountBefore: Array.isArray(raw.assets) ? raw.assets.length : 0,
    mediaAssetCountAfter: input.canonical.media.assetCount,
    recoveredLegacyAssets: input.recoveredLegacyAssets,
    dedupedAssets: input.dedupedAssets,
    selectedVideoUrls,
    compatibilityFieldsGenerated: Object.keys(input.canonical.compatibility),
    processingDebugExtracted: input.processingDebugExtracted,
    ignoredLegacyVariantUrls: input.canonical.audit.normalizationDebug?.ignoredLegacyVariantUrls ?? [],
    mergedVariantUrls: input.canonical.audit.normalizationDebug?.mergedVariantUrls ?? [],
    suppressedDuplicateAssets: input.canonical.audit.normalizationDebug?.suppressedDuplicateAssets ?? [],
    assetCountBefore: input.canonical.audit.normalizationDebug?.assetCountBefore ?? (Array.isArray(raw.assets) ? raw.assets.length : 0),
    assetCountAfter: input.canonical.audit.normalizationDebug?.assetCountAfter ?? input.canonical.media.assetCount,
    warnings: input.warnings,
    errors: input.errors
  };
}
