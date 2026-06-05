import {
  buildCanonicalAssetLocationBlock,
  normalizePostingAssetLocationSource,
  type PostingAssetLocationSource,
} from "./applyPostingFinalizeAssetLocations.js";

export type MergeAssetLocationsStats = {
  assetCount: number;
  assetsWithCoordinates: number;
};

type ParallelRow = {
  lat?: unknown;
  long?: unknown;
  lng?: unknown;
  source?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isNullIsland(lat: number, lng: number): boolean {
  return lat === 0 && lng === 0;
}

function assetHasCanonicalCoordinates(asset: Record<string, unknown>): boolean {
  const location = asRecord(asset.location);
  const coords = asRecord(location?.coordinates);
  const lat = parseCoord(coords?.lat ?? coords?.latitude);
  const lng = parseCoord(coords?.lng ?? coords?.long ?? coords?.longitude);
  return lat != null && lng != null && !isNullIsland(lat, lng);
}

function readCoordsFromAssetRow(asset: Record<string, unknown>): {
  lat: number;
  lng: number;
  source: PostingAssetLocationSource;
} | null {
  const location = asRecord(asset.location);
  const coords = asRecord(location?.coordinates);
  let lat = parseCoord(coords?.lat ?? coords?.latitude ?? location?.lat ?? asset.lat);
  let lng = parseCoord(
    coords?.lng ??
      coords?.long ??
      coords?.longitude ??
      location?.lng ??
      location?.long ??
      asset.lng ??
      asset.long,
  );
  let source =
    normalizePostingAssetLocationSource(location?.source) ??
    normalizePostingAssetLocationSource(asset.source);

  if ((lat == null || lng == null) && location) {
    lat = parseCoord(location.lat);
    lng = parseCoord(location.lng ?? location.long);
  }

  if (lat == null || lng == null || isNullIsland(lat, lng)) return null;
  return {
    lat,
    lng,
    source: source ?? "unknown",
  };
}

function readCoordsFromParallelRow(row: ParallelRow | undefined): {
  lat: number;
  lng: number;
  source: PostingAssetLocationSource;
} | null {
  if (!row) return null;
  const lat = parseCoord(row.lat);
  const lng = parseCoord(row.long ?? row.lng);
  if (lat == null || lng == null || isNullIsland(lat, lng)) return null;
  const source = normalizePostingAssetLocationSource(row.source);
  return {
    lat,
    lng,
    source: source ?? "asset_exif_or_picker",
  };
}

function applyLocationToAsset(
  asset: Record<string, unknown>,
  lat: number,
  lng: number,
  source: PostingAssetLocationSource,
): void {
  const existingLocation = asRecord(asset.location);
  asset.location =
    existingLocation &&
    parseCoord(asRecord(existingLocation.coordinates)?.lat) != null &&
    parseCoord(asRecord(existingLocation.coordinates)?.lng) != null
      ? existingLocation
      : buildCanonicalAssetLocationBlock({ lat, lng, source });
  asset.lat = lat;
  asset.lng = lng;
}

/**
 * Merges top-level `assetLocations[]` and legacy `assets[]` GPS into `media.assets[i].location`
 * without overwriting assets that already have canonical coordinates.
 * Never copies post-level lat/lng onto assets.
 */
export function mergeAssetLocationsIntoPostRecord(
  post: Record<string, unknown>,
): MergeAssetLocationsStats {
  const parallelAssetLocations = Array.isArray(post.assetLocations)
    ? (post.assetLocations as ParallelRow[])
    : [];
  const legacyAssets = Array.isArray(post.assets)
    ? (post.assets as Record<string, unknown>[])
    : [];
  const appPost = asRecord(post.appPostV2) ?? asRecord(post.appPost);
  const media = asRecord(appPost?.media) ?? asRecord(post.media) ?? {};
  const mediaAssets = Array.isArray(media.assets)
    ? (media.assets as Record<string, unknown>[])
    : [];

  const assetCount = Math.max(
    mediaAssets.length,
    legacyAssets.length,
    parallelAssetLocations.length,
  );
  if (assetCount === 0) {
    return { assetCount: 0, assetsWithCoordinates: 0 };
  }

  let assetsWithCoordinates = 0;
  const mergedMediaAssets = [...mediaAssets];
  while (mergedMediaAssets.length < assetCount) {
    const legacy = legacyAssets[mergedMediaAssets.length];
    mergedMediaAssets.push(legacy ? { ...legacy } : { index: mergedMediaAssets.length });
  }

  for (let index = 0; index < assetCount; index += 1) {
    const mediaAsset = mergedMediaAssets[index];
    if (!mediaAsset || typeof mediaAsset !== "object") continue;

    if (assetHasCanonicalCoordinates(mediaAsset)) {
      assetsWithCoordinates += 1;
      continue;
    }

    const fromMedia =
      readCoordsFromAssetRow(mediaAsset) ??
      readCoordsFromParallelRow(parallelAssetLocations[index]) ??
      (legacyAssets[index] ? readCoordsFromAssetRow(legacyAssets[index]!) : null);

    if (!fromMedia) continue;

    applyLocationToAsset(mediaAsset, fromMedia.lat, fromMedia.lng, fromMedia.source);
    assetsWithCoordinates += 1;

    const legacyAsset = legacyAssets[index];
    if (legacyAsset && !assetHasCanonicalCoordinates(legacyAsset)) {
      applyLocationToAsset(legacyAsset, fromMedia.lat, fromMedia.lng, fromMedia.source);
    }
  }

  post.media = {
    ...media,
    assets: mergedMediaAssets,
    assetCount: Math.max(
      typeof media.assetCount === "number" ? media.assetCount : 0,
      mergedMediaAssets.length,
    ),
  };

  if (appPost) {
    const mergedAppPost = {
      ...appPost,
      media: post.media,
    };
    post.appPostV2 = mergedAppPost;
    if (post.appPost) {
      post.appPost = mergedAppPost;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[canonicalize.asset_locations]", {
      postId:
        (typeof post.postId === "string" && post.postId) ||
        (typeof post.id === "string" && post.id) ||
        null,
      assetCount,
      assetsWithCoordinates,
      parallelAssetLocationCount: parallelAssetLocations.length,
    });
  }

  return { assetCount, assetsWithCoordinates };
}
