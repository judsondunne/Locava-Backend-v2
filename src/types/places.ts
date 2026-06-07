export interface PlaceImageRequest {
  placeName: string;
}

export interface ParsedPlaceQuery {
  rawLine: string;
  displayName: string;
  searchQuery: string;
  scoped: boolean;
  region?: string;
  feature?: string;
}

export interface PlaceImageResult {
  id: string;
  imageUrl: string;
  caption: string;
  sourceName: string;
  sourceUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Display title (same as caption when enriched). */
  title?: string;
  /** Hostname of sourceUrl without www. */
  sourceDomain?: string;
  /** Upstream image search provider for this result set. */
  provider?: "bing" | "serper" | "mock";
  /** Canonical backlink to the source page (same as sourceUrl when enriched). */
  backlinkUrl?: string;
  /** Provider + source licensing note for legal display. */
  licenseNote?: string;
  /** Copyright / attribution disclaimer for end users. */
  copyrightDisclaimer?: string;
}

export type PlaceImageAssetStatus = "found" | "no_good_match" | "low_confidence" | "skipped";

export type PlaceImageRejectedPreview = {
  title: string;
  sourceDomain: string;
  sourceUrl: string;
  rejectReasons: string[];
  metadataScore: number;
};

export type PlaceImageCurationMeta = {
  assetStatus: PlaceImageAssetStatus;
  assetsReady: boolean;
  resultSetScore: number;
  acceptedCount: number;
  rejectedCount: number;
  topRejectionReasons: string[];
  matchedTokens: string[];
  missingRequiredTokens: string[];
  rejectedPreviews: PlaceImageRejectedPreview[];
  strictTitleSourceMatch: boolean;
  warnings: string[];
  rawResultCount: number;
};

export interface PlaceWithPhotos {
  placeName: string;
  searchQuery?: string;
  results: PlaceImageResult[];
  source: "bing" | "serper" | "mock";
  error?: string;
  curation?: PlaceImageCurationMeta;
}

export type PlaceImageErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface PlaceImageSearchSuccess {
  ok: true;
  placeName: string;
  searchQuery?: string;
  results: PlaceImageResult[];
  source: "bing" | "serper" | "mock";
  curation?: PlaceImageCurationMeta;
}

export interface PlaceImageBatchSearchSuccess {
  ok: true;
  query: string;
  places: PlaceWithPhotos[];
}

export interface PlaceImageSearchError {
  ok: false;
  error: string;
  code: PlaceImageErrorCode;
}

export type PlaceImageSearchResponse =
  | PlaceImageSearchSuccess
  | PlaceImageBatchSearchSuccess
  | PlaceImageSearchError;
