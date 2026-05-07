/**
 * Assembles canonical `posts.assets[]` entries from finalize staging manifest.
 * Mirrors legacy `buildVideoAssetWithPlaceholders` + staged image shape used by create-from-staged.
 */

export type FinalizeStagedAssetInput = {
  index: number;
  assetType: "photo" | "video";
  assetId?: string;
  originalKey?: string;
  originalUrl?: string;
  posterKey?: string;
  posterUrl?: string;
  imagePublicReady?: boolean;
};

export type AssembledPostAssets = {
  assets: Record<string, unknown>[];
  hasVideo: boolean;
  videoCount: number;
  imageCount: number;
  /** First asset's best URL for displayPhotoLink / photoLink fallbacks */
  primaryDisplayUrl: string;
  mediaType: "video" | "image";
  variantUrlCount: number;
  imageCoverReady: boolean;
  imageVariantsPending: boolean;
};

function buildVideoAssetWithPlaceholders(input: {
  id: string;
  originalUrl: string;
  posterUrl: string;
}): Record<string, unknown> {
  const { id, originalUrl, posterUrl } = input;
  const aspectRatio = 0.5625;
  const width = 720;
  const height = 1280;
  const durationSec = 0;
  const orientation = aspectRatio < 1 ? "portrait" : "landscape";
  const poster = posterUrl.trim() || originalUrl;

  const variants = {
    poster
  };

  const posterWidth = 640;
  const posterHeight = Math.round(posterWidth / aspectRatio);
  const variantMetadata = {
    poster: {
      sizeBytes: 0,
      bitrateKbps: 0,
      width: posterWidth,
      height: posterHeight,
      codec: "jpeg"
    },
    processing: {
      status: "pending",
      instantPlaybackReady: false,
      requiredVariants: ["preview360Avc", "main720", "main720Avc"]
    }
  };

  return {
    id,
    type: "video",
    original: originalUrl,
    poster,
    thumbnail: poster,
    aspectRatio,
    orientation,
    width,
    height,
    durationSec,
    hasAudio: false,
    codecs: { video: "h264", audio: "none" },
    bitrateKbps: 0,
    sizeBytes: 0,
    variants,
    variantMetadata,
    instantPlaybackReady: false
  };
}

function buildImageAsset(input: { id: string; originalUrl: string | null; imagePublicReady: boolean }): Record<string, unknown> {
  const { id, originalUrl, imagePublicReady } = input;
  const url = typeof originalUrl === "string" ? originalUrl.trim() : "";
  const hasPublicUrl = Boolean(url) && imagePublicReady;
  return {
    id,
    type: "image",
    original: hasPublicUrl ? url : null,
    poster: hasPublicUrl ? url : null,
    thumbnail: hasPublicUrl ? url : null,
    aspectRatio: 0.5625,
    width: 1080,
    height: 1920,
    orientation: "portrait",
    blurhash: "L6PZfSjEWAa0^+j@WBa0?bxuNGWV",
    variants: {},
    imageVariantsPending: true
  };
}

function countVariantUrls(asset: Record<string, unknown>): number {
  let n = 0;
  const variants = asset.variants;
  if (!variants || typeof variants !== "object") return n;
  for (const v of Object.values(variants as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) n += 1;
    else if (v && typeof v === "object") {
      for (const inner of Object.values(v as Record<string, unknown>)) {
        if (typeof inner === "string" && inner.trim()) n += 1;
      }
    }
  }
  return n;
}

export function assemblePostAssetsFromStagedItems(
  postId: string,
  items: FinalizeStagedAssetInput[]
): AssembledPostAssets {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("publish_missing_staged_items");
  }

  const sorted = [...items].sort((a, b) => a.index - b.index);
  const assets: Record<string, unknown>[] = [];
  let videoCount = 0;
  let imageCount = 0;
  let imageCoverReady = false;
  let imageVariantsPending = false;
  let primaryDisplayUrl = "";

  for (const item of sorted) {
    const originalUrl = String(item.originalUrl ?? "").trim();
    if (item.assetType === "video" && (!originalUrl || !/^https?:\/\//i.test(originalUrl))) {
      throw new Error(`publish_missing_original_url_for_index_${item.index}`);
    }
    if (String(item.originalUrl ?? "").includes("postSessionStaging/")) {
      throw new Error(`publish_staging_url_not_promoted_index_${item.index}`);
    }

    const id = (item.assetId ?? `${postId}_asset_${item.index}`).trim();
    if (item.assetType === "video") {
      videoCount += 1;
      const posterUrl = String(item.posterUrl ?? "").trim();
      if (!posterUrl || !/^https?:\/\//i.test(posterUrl)) {
        throw new Error(`publish_missing_video_poster_url_for_index_${item.index}`);
      }
      const row = buildVideoAssetWithPlaceholders({
        id,
        originalUrl,
        posterUrl
      });
      assets.push(row);
      if (!primaryDisplayUrl) primaryDisplayUrl = posterUrl;
    } else {
      imageCount += 1;
      const imagePublicReady = item.imagePublicReady === true;
      const row = buildImageAsset({ id, originalUrl: originalUrl || null, imagePublicReady });
      assets.push(row);
      imageVariantsPending = true;
      if (imagePublicReady && originalUrl) {
        imageCoverReady = true;
        if (!primaryDisplayUrl) primaryDisplayUrl = originalUrl;
      }
    }
  }

  const hasVideo = videoCount > 0;
  const variantUrlCount = assets.reduce((sum, a) => sum + countVariantUrls(a), 0);

  return {
    assets,
    hasVideo,
    videoCount,
    imageCount,
    primaryDisplayUrl,
    mediaType: hasVideo ? "video" : "image",
    variantUrlCount,
    imageCoverReady,
    imageVariantsPending
  };
}
