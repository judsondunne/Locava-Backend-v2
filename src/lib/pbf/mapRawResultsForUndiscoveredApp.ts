import type { PlaceImageResult } from "../../types/places.js";
import type { PbfAssetPreviewExternalAsset, PbfAssetPreviewStatus } from "../../types/pbfAssetPreview.js";
import { filterAcceptablePlaceImages } from "../places/placeImageQualityFilter.js";

const DISPLAY_MAX = 12;

function dedupeByImageUrl(results: PlaceImageResult[]): PlaceImageResult[] {
  const seen = new Set<string>();
  const out: PlaceImageResult[] = [];
  for (const row of results) {
    const key = row.imageUrl?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function toExternalAsset(result: PlaceImageResult, rank: number): PbfAssetPreviewExternalAsset {
  const domain = result.sourceDomain || result.sourceName;
  return {
    ...result,
    rank,
    assetMatchScore: 0,
    assetMatchConfidence: "medium",
    assetMatchReasons: ["undiscovered_raw"],
    sourceDomain: domain,
    backlinkUrl: result.backlinkUrl ?? result.sourceUrl,
    title: result.title ?? result.caption,
  };
}

/** Undiscovered app: skip metadata consensus — keep basic junk filters only. */
export function mapRawResultsForUndiscoveredApp(rawResults: PlaceImageResult[]): {
  assets: PbfAssetPreviewExternalAsset[];
  assetStatus: PbfAssetPreviewStatus;
  assetsReady: boolean;
  warnings: string[];
} {
  const filtered = filterAcceptablePlaceImages(dedupeByImageUrl(rawResults));
  const assets = filtered.slice(0, DISPLAY_MAX).map((result, index) => toExternalAsset(result, index + 1));
  const assetsReady = assets.length > 0;
  return {
    assets,
    assetStatus: assetsReady ? "found" : "no_good_match",
    assetsReady,
    warnings: assetsReady ? [] : ["No web images returned for this search."],
  };
}
