export type PlaceCandidateTier = "A" | "B" | "C" | "REJECTED";

export type PlaceCandidateMediaAvailability = "strong" | "medium" | "weak" | "none" | "unknown";

export type PlaceCandidateMediaSignals = {
  checked: boolean;
  hasWikidataImage: boolean;
  hasCommonsCategory: boolean;
  commonsCategory?: string;
  commonsCategoryFileCount?: number;
  commonsSearchHitCount?: number;
  wikipediaUrl?: string;
  wikidataImagePresent?: boolean;
  mediaAvailability: PlaceCandidateMediaAvailability;
  timedOut?: boolean;
  elapsedMs?: number;
  source?: "wikidata" | "commons_category" | "commons_search" | "none";
};

export type PlaceCandidatePriorityQueue = "P0" | "P1" | "P2" | "P3";

export type PlaceCandidateRecommendedAction =
  | "RUN_MEDIA_NOW"
  | "RUN_MEDIA_LATER"
  | "KEEP_BACKLOG"
  | "BLOCK";

export type PlaceCandidatePartialReason =
  | "LIMIT_REACHED_BEFORE_ALL_BUCKETS"
  | "SOME_BUCKETS_TIMED_OUT"
  | "TOTAL_TIMEOUT"
  | "MEDIA_SIGNAL_PARTIAL";

export type PlaceCandidate = {
  placeCandidateId: string;
  name: string;
  state: string;
  stateCode?: string;
  country: "US";
  lat: number;
  lng: number;
  categories: string[];
  primaryCategory?: string;
  candidateTier: PlaceCandidateTier;
  sourceIds: {
    wikidata?: string;
    wikipedia?: string;
    commonsCategory?: string;
    osm?: string;
    nps?: string;
    usgs?: string;
  };
  sourceUrls: {
    wikidata?: string;
    wikipedia?: string;
    commonsCategory?: string;
    osm?: string;
  };
  rawSources: string[];
  sourceConfidence: number;
  locavaScore: number;
  locavaPriorityScore?: number;
  mediaSignalScore?: number;
  eligibleForMediaPipeline?: boolean;
  blocked?: boolean;
  blockReasons?: string[];
  priorityQueue?: PlaceCandidatePriorityQueue;
  priorityReasons?: string[];
  recommendedAction?: PlaceCandidateRecommendedAction;
  pipelineReady?: boolean;
  pipelineReadyReasons?: string[];
  pipelineBlockReasons?: string[];
  mediaSignals?: PlaceCandidateMediaSignals;
  signals: {
    hasCoordinates: boolean;
    hasWikipedia: boolean;
    hasWikidata: boolean;
    hasCommonsCategory: boolean;
    hasImageField?: boolean;
    hasUsefulCategory: boolean;
    isOutdoorLikely: boolean;
    isLandmarkLikely: boolean;
    isTourismLikely: boolean;
    isTooGeneric: boolean;
  };
  debug: {
    matchedSourceCategories: string[];
    normalizedFrom: string[];
    scoreReasons: string[];
    tierReasons: string[];
    dedupeKey: string;
    sourceBucketIds?: string[];
    sourceBucketLabels?: string[];
    targetedCategoryHints?: string[];
    actualTypeLabels?: string[];
    actualLabelNegativeSignals?: string[];
    bucketHintsApplied?: boolean;
    bucketHintSuppressedReasons?: string[];
    diversityApplied?: boolean;
    diversityReason?: string;
    categoryRankWithinBucket?: number;
    raw?: unknown;
  };
};

export type PlaceCandidateMode = "fast_smoke" | "fast_targeted" | "deep_discovery";

export type PlaceCandidateBucketBreakdown = {
  bucketId: string;
  label: string;
  fetched: number;
  accepted: number;
  tierA: number;
  tierB: number;
  tierC: number;
  pipelineReady: number;
  timedOut: boolean;
  elapsedMs: number;
};

export type GenerateStatePlaceCandidatesRequest = {
  stateName: string;
  stateCode?: string;
  mode?: PlaceCandidateMode;
  limit?: number;
  totalTimeoutMs?: number;
  perQueryTimeoutMs?: number;
  sources?: string[];
  includeRaw?: boolean;
  dryRun?: boolean;
  minScore?: number;
  includeMediaSignals?: boolean;
  strictMinScore?: boolean;
};

export type PlaceCandidateRejected = {
  name?: string;
  reason: string;
  source: string;
  debug?: unknown;
};

export type PlaceCandidateRunEventType =
  | "PLACE_CANDIDATE_RUN_STARTED"
  | "PLACE_CANDIDATE_FAST_SMOKE_STARTED"
  | "PLACE_CANDIDATE_FAST_SMOKE_DONE"
  | "PLACE_CANDIDATE_FAST_SMOKE_TIMEOUT"
  | "PLACE_CANDIDATE_FAST_SMOKE_PARTIAL_RETURNED"
  | "PLACE_CANDIDATE_FAST_TARGETED_STARTED"
  | "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_STARTED"
  | "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_DONE"
  | "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_TIMEOUT"
  | "PLACE_CANDIDATE_FAST_TARGETED_PARTIAL_RETURNED"
  | "PLACE_CANDIDATE_FAST_TARGETED_DONE"
  | "PLACE_CANDIDATE_BUCKET_FALLBACK_STARTED"
  | "PLACE_CANDIDATE_BUCKET_FALLBACK_DONE"
  | "PLACE_CANDIDATE_BUCKET_FALLBACK_TIMEOUT"
  | "PLACE_CANDIDATE_DEEP_DISCOVERY_STARTED"
  | "PLACE_CANDIDATE_DEEP_DISCOVERY_PARTIAL_RETURNED"
  | "PLACE_CANDIDATE_DEEP_DISCOVERY_TIMEOUT"
  | "PLACE_CANDIDATE_SOURCE_STARTED"
  | "PLACE_CANDIDATE_SOURCE_PROGRESS"
  | "PLACE_CANDIDATE_SOURCE_DONE"
  | "PLACE_CANDIDATE_WIKIDATA_QUERY_STARTED"
  | "PLACE_CANDIDATE_WIKIDATA_QUERY_DONE"
  | "PLACE_CANDIDATE_WIKIDATA_QUERY_TIMEOUT"
  | "PLACE_CANDIDATE_WIKIDATA_PARTIAL_SOURCE_DONE"
  | "PLACE_CANDIDATES_NORMALIZED"
  | "PLACE_CANDIDATES_DEDUPED"
  | "PLACE_CANDIDATES_SCORED"
  | "PLACE_CANDIDATE_RUN_DONE"
  | "PLACE_CANDIDATE_RUN_FAILED";

export type PlaceCandidateRunEvent = {
  cursor?: number;
  timestamp?: string;
  type: PlaceCandidateRunEventType;
  runId: string;
  stateName: string;
  stateCode?: string;
  source?: string;
  counts?: Record<string, number | string>;
  elapsedMs?: number;
  queryElapsedMs?: number;
  totalTimeoutMs?: number;
  perQueryTimeoutMs?: number;
  partial?: boolean;
  timeout?: boolean;
  timeoutReason?: string;
  limit?: number;
  minScore?: number;
  dryRun: boolean;
  message?: string;
};

export type PlaceCandidateDevRunStatus = "running" | "complete" | "failed";

export type PlaceCandidateDevRunState = {
  runId: string;
  status: PlaceCandidateDevRunStatus;
  createdAtMs: number;
  updatedAtMs: number;
  request: GenerateStatePlaceCandidatesRequest;
  result: GenerateStatePlaceCandidatesResponse | null;
  error: string | null;
  logs: string[];
  events: PlaceCandidateRunEvent[];
  nextEventCursor: number;
};

export type PlaceCandidateSourceTiming = {
  source: string;
  mode: "fast_smoke" | "fast_smoke_minimal" | "fast_targeted_bucket" | "batched" | "per_type";
  typeQid?: string;
  typeLabel?: string;
  elapsedMs: number;
  queryElapsedMs?: number;
  fetched: number;
  timedOut?: boolean;
};

export type GenerateStatePlaceCandidatesResponse = {
  ok: true;
  dryRun: true;
  mode: PlaceCandidateMode;
  sourceMode: PlaceCandidateMode;
  partial: boolean;
  timeout: boolean;
  timeoutReason?: string;
  partialReason?: PlaceCandidatePartialReason;
  bucketTimeoutCount?: number;
  bucketCompletedCount?: number;
  bucketSkippedCount?: number;
  limitReached?: boolean;
  bucketBreakdown?: PlaceCandidateBucketBreakdown[];
  mediaSignalSummary?: {
    checked: number;
    strong: number;
    medium: number;
    weak: number;
    none: number;
    unknown: number;
    timedOut: number;
    elapsedMs: number;
    partial: boolean;
  };
  blockedCandidates?: PlaceCandidate[];
  needsReviewCandidates?: PlaceCandidate[];
  eligibleCandidates?: PlaceCandidate[];
  topPriorityCandidates?: PlaceCandidate[];
  backlogCandidates?: PlaceCandidate[];
  stateName: string;
  stateCode?: string;
  sourcesUsed: string[];
  candidates: PlaceCandidate[];
  topCandidatesForMediaPipeline: PlaceCandidate[];
  rejected: PlaceCandidateRejected[];
  totals: {
    rawCandidates: number;
    normalizedCandidates: number;
    dedupedCandidates: number;
    rejectedCandidates: number;
    returnedCandidates: number;
    eligibleCandidates?: number;
    blockedCandidates?: number;
    p0?: number;
    p1?: number;
    p2?: number;
    p3?: number;
  };
  totalsByTier: Record<PlaceCandidateTier, number>;
  totalsByPrimaryCategory: Record<string, number>;
  sourceTimings: PlaceCandidateSourceTiming[];
  warnings: string[];
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  elapsedMs: number;
  events: PlaceCandidateRunEvent[];
};

export type WikidataRawPlaceCandidate = {
  source: "wikidata";
  qid: string;
  name: string;
  lat: number;
  lng: number;
  instanceLabels: string[];
  sourceBucketIds?: string[];
  sourceBucketLabels?: string[];
  targetedCategoryHints?: string[];
  wikipediaUrl?: string;
  commonsCategory?: string;
  imageField?: string;
  raw?: unknown;
};

export type PlaceCandidateSourceResult = {
  source: string;
  raw: WikidataRawPlaceCandidate[];
};
