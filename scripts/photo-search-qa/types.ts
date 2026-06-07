import { z } from "zod";

export const PlaceImageResultSchema = z.object({
  id: z.string(),
  imageUrl: z.string().url(),
  caption: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  imageWidth: z.number().optional(),
  imageHeight: z.number().optional(),
  title: z.string().optional(),
  sourceDomain: z.string().optional(),
  provider: z.enum(["bing", "serper", "mock"]).optional(),
  backlinkUrl: z.string().optional(),
  licenseNote: z.string().optional(),
  copyrightDisclaimer: z.string().optional(),
});

export const PlaceImageSearchSuccessSchema = z.object({
  ok: z.literal(true),
  placeName: z.string(),
  searchQuery: z.string().optional(),
  results: z.array(PlaceImageResultSchema),
  source: z.enum(["bing", "serper", "mock"]),
});

export const PlaceImageSearchErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string(),
});

export type PlaceImageApiResult = z.infer<typeof PlaceImageResultSchema>;

export type VisionJudgment = {
  placeMatchScore: number;
  visualQualityScore: number;
  locavaCoolnessScore: number;
  wrongPlaceRisk: "low" | "medium" | "high";
  visibleSignals: string[];
  concerns: string[];
  shortReason: string;
  automated: boolean;
  model?: string;
  error?: string;
};

export type ImageValidationResult = {
  imageId: string;
  imageUrl: string;
  caption?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  provider?: string;
  backlinkUrl?: string;
  licenseNote?: string;
  copyrightDisclaimer?: string;
  httpStatus: number | null;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  loadMs: number;
  loadsOk: boolean;
  metadataOk: boolean;
  missingMetadataFields: string[];
  sourcePageOk: boolean;
  duplicateOfIndex: number | null;
  failureReasons: string[];
  vision: VisionJudgment | null;
  placeLabel: "likely_correct" | "unsure" | "wrong" | "not_judged";
};

export type PlaceQaResult = {
  seedId: string;
  placeName: string;
  town: string;
  state: string;
  apiPlaceQuery: string;
  searchQueryUsed: string;
  provider: "bing" | "serper" | "mock" | "none";
  totalResults: number;
  validImageCount: number;
  brokenImageCount: number;
  missingMetadataCount: number;
  duplicateCount: number;
  avgPlaceMatchScore: number | null;
  avgVisualQualityScore: number | null;
  avgCoolnessScore: number | null;
  highWrongPlaceRiskCount: number;
  responseMs: number;
  ttfbMs: number | null;
  imageValidationMs: number;
  estimatedProviderCalls: number;
  estimatedCredits: number;
  exactCostKnown: boolean;
  passFail: "pass" | "manual_review" | "fail";
  failureReasons: string[];
  images: ImageValidationResult[];
  apiError?: string;
};

export type BatchSummary = {
  batchNumber: number;
  placeIds: string[];
  placesTested: number;
  passed: number;
  manualReview: number;
  failed: number;
  totalImagesReturned: number;
  validImages: number;
  brokenImages: number;
  missingMetadata: number;
  duplicateRate: number;
  avgResponseMs: number;
  p50ResponseMs: number;
  p95ResponseMs: number;
  estimatedProviderCalls: number;
  estimatedCredits: number;
  exactCostKnown: boolean;
  topFailureReasons: string[];
  worstPlaces: string[];
  bestPlaces: string[];
  catastrophic: boolean;
  catastrophicReasons: string[];
};

export type RunState = {
  runId: string;
  startedAt: string;
  updatedAt: string;
  target: "local" | "staging" | "production";
  baseUrl: string;
  batchSize: number;
  minImages: number;
  maxCredits: number;
  completedPlaceIds: string[];
  currentBatchNumber: number;
  estimatedProviderCalls: number;
  estimatedCredits: number;
  exactCostKnown: boolean;
  places: PlaceQaResult[];
  batches: BatchSummary[];
  visionMode: "on" | "off" | "manual";
  visionModel: string | null;
};

export type ProductionVerdict =
  | "PRODUCTION READY"
  | "ALMOST READY - NEEDS MANUAL REVIEW"
  | "NOT PRODUCTION READY";

export type PhotoQaCliOptions = {
  target: "local" | "staging" | "production";
  batchSize: number;
  maxBatches: number;
  runAll: boolean;
  resume: boolean;
  maxCredits: number;
  minImages: number;
  concurrency: number;
  outDir: string;
  vision: "true" | "false" | "auto";
};

export type PhotoQaSeedPlace = {
  id: string;
  placeName: string;
  town: string;
  state: string;
  osmStyleTags: string[];
  searchQueries: string[];
  expectedVisualSignals: string[];
  wrongPlaceWarnings: string[];
};
