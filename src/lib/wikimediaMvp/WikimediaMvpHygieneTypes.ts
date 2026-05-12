export type WikimediaHygieneStatus = "PASS" | "REVIEW" | "REJECT";

export type WikimediaDuplicateDecision =
  | "PRIMARY"
  | "DUPLICATE_REJECTED"
  | "POSSIBLE_DUPLICATE_REVIEW"
  | "UNIQUE";

export type WikimediaAssetQualityFlags = {
  isPanorama?: boolean;
  isLowResolution?: boolean;
  isProbablyBlackAndWhite?: boolean;
  isProbablyFiltered?: boolean;
  isPossiblyBlurry?: boolean;
  isBadAspectRatio?: boolean;
};

export type WikimediaAssetHygieneFields = {
  hygieneStatus: WikimediaHygieneStatus;
  hygieneReasons: string[];
  hygieneWarnings: string[];
  duplicateClusterId?: string;
  duplicateDecision?: WikimediaDuplicateDecision;
  visualHash?: string;
  visualHashDistanceToPrimary?: number;
  qualityFlags?: WikimediaAssetQualityFlags;
};

export type WikimediaRemovedAssetSummary = WikimediaAssetHygieneFields & {
  candidateId: string;
  generatedTitle: string;
  thumbnailUrl: string | null;
  fullImageUrl: string;
  sourceTitle: string;
};

export type WikimediaAssetHygieneSummary = {
  originalAssetCount: number;
  keptAssetCount: number;
  rejectedAssetCount: number;
  reviewAssetCount: number;
  rejectedDuplicateCount: number;
  rejectedHygieneCount: number;
  rejectedPanoramaCount: number;
  rejectedLowQualityCount: number;
  rejectedBlackAndWhiteOrFilterCount: number;
  possibleDuplicateReviewCount: number;
};
