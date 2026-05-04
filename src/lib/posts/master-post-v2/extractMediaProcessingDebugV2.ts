type RawPost = Record<string, unknown>;

const toObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const sizeOf = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

export function extractMediaProcessingDebugV2(rawPost: RawPost): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};

  const copyIfPresent = (key: string): void => {
    if (rawPost[key] !== undefined) out[key] = rawPost[key];
  };

  copyIfPresent("playbackLab");
  copyIfPresent("videoProcessingProgress");
  copyIfPresent("videoProcessingCompletedAt");
  copyIfPresent("imageProcessingProgress");
  copyIfPresent("posterFiles");
  copyIfPresent("lastVerifyResults");
  copyIfPresent("generationMetadata");
  copyIfPresent("diagnosticsJson");
  copyIfPresent("videoProcessingStatus");
  copyIfPresent("processingErrors");
  copyIfPresent("processingError");
  copyIfPresent("processingLogs");
  copyIfPresent("sourceStreamInventory");

  const assets = Array.isArray(rawPost.assets) ? rawPost.assets : [];
  const largeVariantMetadata = assets
    .map((entry, index) => ({ entry: toObject(entry), index }))
    .filter(({ entry }) => Boolean(entry?.variantMetadata) && sizeOf(entry?.variantMetadata) > 1500)
    .map(({ entry, index }) => ({
      index,
      assetId: (entry?.id as string | undefined) ?? `asset_${index}`,
      variantMetadata: entry?.variantMetadata
    }));
  if (largeVariantMetadata.length > 0) out.largeAssetVariantMetadata = largeVariantMetadata;

  return Object.keys(out).length > 0
    ? {
        extractedAt: new Date().toISOString(),
        version: 1,
        ...out
      }
    : null;
}
