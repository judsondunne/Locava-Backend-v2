import { encodeGeohash } from "../latlng-geohash.js";

export const POSTING_ASSET_LOCATION_SOURCES = [
  "asset_exif",
  "asset_exif_or_picker",
  "asset_media_library",
  "camera_device",
  "post_fallback",
  "unknown",
] as const;

export type PostingAssetLocationSource = (typeof POSTING_ASSET_LOCATION_SOURCES)[number];

export type PostingFinalizeAssetLocationInput = {
  lat?: number | null;
  long?: number | null;
  source?: string | null;
  accuracy?: number | null;
  capturedAt?: number | string | null;
};

export type NormalizedPostingAssetLocationRow = {
  lat: number | null;
  long: number | null;
  source: PostingAssetLocationSource | null;
  accuracy: number | null;
  capturedAt: number | string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseFiniteCoord(value: unknown): number | null {
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

export function normalizePostingAssetLocationSource(
  raw: unknown,
): PostingAssetLocationSource | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return (POSTING_ASSET_LOCATION_SOURCES as readonly string[]).includes(trimmed)
    ? (trimmed as PostingAssetLocationSource)
    : null;
}

export function normalizePostingFinalizeAssetLocationRows(
  raw: unknown,
  assetCount: number,
): NormalizedPostingAssetLocationRow[] | undefined {
  if (!Array.isArray(raw) || assetCount <= 0) return undefined;
  const parsed = raw.slice(0, assetCount).map((row) => {
    const rec = asRecord(row);
    const lat = parseFiniteCoord(rec?.lat);
    const long = parseFiniteCoord(rec?.long ?? rec?.lng ?? rec?.longitude);
    return {
      lat,
      long,
      source: normalizePostingAssetLocationSource(rec?.source),
      accuracy: parseFiniteCoord(rec?.accuracy),
      capturedAt:
        typeof rec?.capturedAt === "number" || typeof rec?.capturedAt === "string"
          ? rec.capturedAt
          : null,
    } satisfies NormalizedPostingAssetLocationRow;
  });
  while (parsed.length < assetCount) {
    parsed.push({
      lat: null,
      long: null,
      source: null,
      accuracy: null,
      capturedAt: null,
    });
  }
  return parsed;
}

export function buildCanonicalAssetLocationBlock(input: {
  lat: number;
  lng: number;
  source: PostingAssetLocationSource;
  accuracy?: number | null;
  capturedAt?: number | string | null;
}): Record<string, unknown> {
  const geohash =
    input.lat === 0 && input.lng === 0 ? undefined : encodeGeohash(input.lat, input.lng, 9);
  return {
    coordinates: {
      lat: input.lat,
      lng: input.lng,
      ...(geohash ? { geohash } : {}),
    },
    source: input.source,
    ...(input.accuracy != null && Number.isFinite(input.accuracy) ? { accuracy: input.accuracy } : {}),
    ...(input.capturedAt != null ? { capturedAt: input.capturedAt } : {}),
  };
}

/**
 * Writes per-asset location onto legacy `assets[]` rows before Master Post V2 merge.
 * Never copies post-level coordinates onto assets unless the row source is `post_fallback`.
 */
export function applyPostingFinalizeAssetLocationsToAssets(
  assets: Record<string, unknown>[],
  rows: NormalizedPostingAssetLocationRow[] | undefined,
): { assetsWithCoordinates: number; assetCount: number } {
  const assetCount = assets.length;
  if (!rows || assetCount === 0) {
    return { assetsWithCoordinates: 0, assetCount };
  }

  let assetsWithCoordinates = 0;
  for (let index = 0; index < assetCount; index += 1) {
    const asset = assets[index];
    if (!asset) continue;
    const row = rows[index];
    const lat = row?.lat ?? null;
    const lng = row?.long ?? null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    if (isNullIsland(lat, lng)) continue;

    const source = row?.source ?? "unknown";

    const location = buildCanonicalAssetLocationBlock({
      lat,
      lng,
      source,
      accuracy: row?.accuracy ?? null,
      capturedAt: row?.capturedAt ?? null,
    });
    asset.location = location;
    asset.lat = lat;
    asset.lng = lng;
    assetsWithCoordinates += 1;
  }

  return { assetsWithCoordinates, assetCount };
}
