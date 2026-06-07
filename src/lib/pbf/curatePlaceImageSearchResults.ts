import type { ParsedPlaceQuery, PlaceImageCurationMeta, PlaceImageResult } from "../../types/places.js";
import {
  scorePhotoSearchResultsForParsedQuery,
  type PhotoSearchResultSetScore,
  type PhotoSearchScoreOptions,
} from "./scorePhotoSearchResultsForPlace.js";

export type CuratedPlaceImageSearch = PhotoSearchResultSetScore & {
  placeName: string;
  searchQuery: string;
};

export function curatePlaceImageSearchResults(
  query: ParsedPlaceQuery,
  rawResults: PlaceImageResult[],
  options?: PhotoSearchScoreOptions,
): CuratedPlaceImageSearch {
  const scored = scorePhotoSearchResultsForParsedQuery(query, rawResults, options);
  return {
    ...scored,
    placeName: query.displayName,
    searchQuery: query.searchQuery,
  };
}

export function buildPlaceImageCurationMeta(
  scored: PhotoSearchResultSetScore,
  rawResultCount: number,
  strictTitleSourceMatch: boolean,
): PlaceImageCurationMeta {
  return {
    assetStatus: scored.assetStatus,
    assetsReady: scored.assetsReady,
    resultSetScore: scored.resultSetScore,
    acceptedCount: scored.acceptedAssets.length,
    rejectedCount: scored.rejectedCount,
    topRejectionReasons: scored.topRejectionReasons,
    matchedTokens: scored.matchedTokens,
    missingRequiredTokens: scored.missingRequiredTokens,
    rejectedPreviews: scored.rejectedAssets.slice(0, 8).map((r) => ({
      title: r.title || r.caption,
      sourceDomain: r.sourceDomain,
      sourceUrl: r.sourceUrl,
      rejectReasons: r.rejectReasons,
      metadataScore: r.metadataScore,
    })),
    strictTitleSourceMatch,
    warnings: scored.warnings,
    rawResultCount,
  };
}
