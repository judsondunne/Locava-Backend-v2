import type { PlaceImageResult } from "./places.js";
import type { PbfCopierPreviewDoc } from "../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

export type PbfAssetMatchConfidence = "high" | "medium" | "low";

export type PbfAssetVisionSummary = {
  isRealPlacePhoto: boolean;
  assetType: string;
  placeMatchScore: number;
  visualQualityScore: number;
  wrongPlaceRisk: string;
  shortReason: string;
  automated: boolean;
};

export type PbfAssetPreviewExternalAsset = PlaceImageResult & {
  rank: number;
  assetMatchConfidence: PbfAssetMatchConfidence;
  assetMatchScore: number;
  assetMatchReasons: string[];
  sourceDomain: string;
  backlinkUrl: string;
  visionJudgment?: PbfAssetVisionSummary;
};

export type PbfAssetPreviewStatus =
  | "found"
  | "no_good_match"
  | "low_confidence"
  | "skipped"
  | "error";

export type PbfAssetRejectedAssetSummary = {
  imageUrl: string;
  caption: string;
  sourceDomain: string;
  rejectReasons: string[];
};

export type PbfPhotoVisionMode = "off" | "borderline_only" | "top_only" | "all_candidates";

export type PbfAssetRejectedPreview = {
  title: string;
  sourceDomain: string;
  sourceUrl: string;
  rejectReasons: string[];
  metadataScore: number;
};

export type PbfAssetPreviewBlock = {
  query: string;
  querySpecificityScore: number;
  assetStatus: PbfAssetPreviewStatus;
  assetsReady: boolean;
  resultSetScore: number;
  rejectedCount: number;
  acceptedCount: number;
  topRejectionReasons: string[];
  matchedTokens: string[];
  missingRequiredTokens: string[];
  rejectedPreviews: PbfAssetRejectedPreview[];
  strictTitleSourceMatch: boolean;
  visionMode: PbfPhotoVisionMode;
  provider: "bing" | "serper" | "mock" | "none";
  fetchedAt: string;
  externalAssets: PbfAssetPreviewExternalAsset[];
  warnings: string[];
  skipReason?: string;
  lookupError?: string;
  tokens: string[];
  confidenceHints: string[];
};

export type PbfAssetPreviewItem = PbfCopierPreviewDoc & {
  assetPreview: PbfAssetPreviewBlock;
};

export type PbfAssetPreviewRunOption = {
  runId: string;
  region: string;
  mode: string;
  status: string;
  updatedAt: string;
  totalChunks: number;
  processedChunks: number;
  maxTotalSpots: number | null;
  isActive: boolean;
  isRealWriteRun: boolean;
  label: string;
};

export type PbfAssetPreviewChunkOption = {
  chunkId: string;
  tileId: string;
  tileIndex: number;
  status: string;
  visibleCount: number;
  label: string;
};

export type PbfAssetPreviewProgress = {
  spotsLoaded: number;
  spotsEligible: number;
  photoQueryReady?: number;
  spotsSkipped: number;
  photoLookupsCompleted: number;
  photoLookupsFailed: number;
  lowConfidenceCount: number;
  geminiJudged?: number;
  geminiRejected?: number;
  geminiEnabled?: boolean;
  elapsedMs: number;
  avgLookupSpeedMs: number | null;
};

export type PbfAssetPreviewSourcesResponse = {
  ok: true;
  defaultRunId: string | null;
  activeRunId: string | null;
  prefersWriteRuns: boolean;
  runs: PbfAssetPreviewRunOption[];
  chunks: PbfAssetPreviewChunkOption[];
};

export type PbfAssetPreviewFetchMode = "dry_preview" | "live_pbf";

export type PbfAssetPreviewFetchResponse = {
  ok: true;
  runId: string;
  chunkId: string | null;
  mode: PbfAssetPreviewFetchMode;
  progress: PbfAssetPreviewProgress;
  items: PbfAssetPreviewItem[];
};

export type PbfAssetPreviewLiveSourcesResponse = {
  ok: true;
  pbfPath: string;
  resolvedPath: string;
  readable: boolean;
  fileSizeBytes: number | null;
  tileStepDegrees: number;
  totalTiles: number;
  message: string;
};

export type PbfAssetPreviewError = {
  ok: false;
  error: string;
  code: "INVALID_REQUEST" | "NOT_FOUND" | "UPSTREAM_ERROR" | "INTERNAL_ERROR";
};

export type PbfAssetPreviewResponse =
  | PbfAssetPreviewSourcesResponse
  | PbfAssetPreviewFetchResponse
  | PbfAssetPreviewError;
