import type { PbfAssetPreviewExternalAsset } from "../../types/pbfAssetPreview.js";
import type { PbfAssetPreviewBlock } from "../../types/pbfAssetPreview.js";
import {
  UNDISCOVERED_PHOTO_RESULT_DISCLAIMER,
  type UndiscoveredPhotoSearchCache,
  type UndiscoveredPhotoSearchResultItem,
} from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import { getUndiscoveredPhotoSearchCacheTtlDays, getUndiscoveredPhotoSearchEmptyCacheTtlMinutes } from "../undiscovered/undiscoveredPhotoSearchBudget.js";

const CACHE_STORE_MAX = 30;
const RESPONSE_MAX = 20;
/** Bumped when result validation rules change — invalidates stale Firestore caches. */
export const UNDISCOVERED_PHOTO_SEARCH_VALIDATOR = "metadata_v4";

function providerName(raw: PbfAssetPreviewBlock["provider"]): UndiscoveredPhotoSearchCache["provider"] {
  if (raw === "serper" || raw === "bing" || raw === "mock" || raw === "none") return raw;
  return "none";
}

function mapAssetToResult(
  asset: PbfAssetPreviewExternalAsset,
  fetchedAt: string,
): UndiscoveredPhotoSearchResultItem {
  const sourceTitle = asset.title?.trim() || asset.caption?.trim() || asset.sourceName?.trim() || "Web result";
  const sourceDomain = asset.sourceDomain?.trim() || asset.sourceName?.trim() || "unknown";
  const sourceUrl = asset.backlinkUrl?.trim() || asset.sourceUrl?.trim() || asset.imageUrl;
  const attributionText = [sourceTitle, sourceDomain].filter(Boolean).join(" · ");
  return {
    id: asset.id,
    rank: asset.rank,
    thumbnailUrl: asset.imageUrl,
    imageUrl: asset.imageUrl,
    sourceUrl,
    sourceTitle,
    sourceDomain,
    provider: asset.provider ?? "serper",
    width: asset.imageWidth ?? null,
    height: asset.imageHeight ?? null,
    attributionText,
    license: asset.licenseNote ?? null,
    copyrightNotice: asset.copyrightDisclaimer ?? null,
    disclaimer: UNDISCOVERED_PHOTO_RESULT_DISCLAIMER,
    confidence: Number.isFinite(asset.assetMatchScore) ? asset.assetMatchScore : null,
    validationStatus: "accepted",
    fetchedAt,
  };
}

export function mapAssetPreviewToPhotoSearchCache(input: {
  query: string;
  provider: PbfAssetPreviewBlock["provider"];
  assetStatus: PbfAssetPreviewBlock["assetStatus"];
  externalAssets: PbfAssetPreviewExternalAsset[];
  lookupError?: string;
  fetchedAt?: string;
}): UndiscoveredPhotoSearchCache {
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const expiresAtMs =
    input.assetStatus === "found"
      ? Date.now() + getUndiscoveredPhotoSearchCacheTtlDays() * 86_400_000
      : Date.now() + getUndiscoveredPhotoSearchEmptyCacheTtlMinutes() * 60_000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const sorted = [...input.externalAssets].sort((a, b) => a.rank - b.rank).slice(0, CACHE_STORE_MAX);
  const results = sorted.map((asset) => mapAssetToResult(asset, fetchedAt));

  if (input.assetStatus === "error") {
    return {
      schema: "locava.undiscoveredPhotoSearch",
      version: 1,
      status: "failed",
      query: input.query,
      provider: providerName(input.provider),
      validator: UNDISCOVERED_PHOTO_SEARCH_VALIDATOR,
      fetchedAt,
      expiresAt,
      resultCount: 0,
      results: [],
      error: {
        code: "provider_failed",
        message: input.lookupError ?? "Photo lookup failed",
      },
    };
  }

  if (input.assetStatus === "found" && results.length > 0) {
    return {
      schema: "locava.undiscoveredPhotoSearch",
      version: 1,
      status: "ready",
      query: input.query,
      provider: providerName(input.provider),
      validator: UNDISCOVERED_PHOTO_SEARCH_VALIDATOR,
      fetchedAt,
      expiresAt,
      resultCount: results.length,
      results,
      error: null,
    };
  }

  return {
    schema: "locava.undiscoveredPhotoSearch",
    version: 1,
    status: "empty",
    query: input.query,
    provider: providerName(input.provider),
    validator: UNDISCOVERED_PHOTO_SEARCH_VALIDATOR,
    fetchedAt,
    expiresAt,
    resultCount: 0,
    results: [],
    error: null,
  };
}

export function buildRefreshingPhotoSearchCache(query: string): UndiscoveredPhotoSearchCache {
  const fetchedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + getUndiscoveredPhotoSearchCacheTtlDays() * 86_400_000,
  ).toISOString();
  return {
    schema: "locava.undiscoveredPhotoSearch",
    version: 1,
    status: "refreshing",
    query,
    provider: "none",
    validator: "none",
    fetchedAt,
    expiresAt,
    resultCount: 0,
    results: [],
    error: null,
  };
}

export function selectPhotoSearchResponseItems(
  cache: UndiscoveredPhotoSearchCache,
): UndiscoveredPhotoSearchResultItem[] {
  if (cache.status !== "ready") return [];
  return [...cache.results].sort((a, b) => a.rank - b.rank).slice(0, RESPONSE_MAX);
}

export function isPhotoSearchCacheValid(
  cache: UndiscoveredPhotoSearchCache | null | undefined,
  forceRefresh: boolean,
): boolean {
  if (!cache || forceRefresh) return false;
  if (cache.validator !== UNDISCOVERED_PHOTO_SEARCH_VALIDATOR) return false;
  if (cache.status === "refreshing") return false;
  // Never serve cached empties — curation improves often; re-fetch on next reveal.
  if (cache.status === "empty") return false;
  if (cache.status !== "ready" && cache.status !== "failed") return false;
  const expiresAtMs = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  return true;
}

export function isPhotoSearchRefreshingLeaseFresh(cache: UndiscoveredPhotoSearchCache | null | undefined): boolean {
  if (!cache || cache.status !== "refreshing") return false;
  const fetchedAtMs = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return false;
  return Date.now() - fetchedAtMs < 120_000;
}
