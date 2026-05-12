import type {
  WikimediaAssetHygieneFields,
  WikimediaAssetHygieneSummary,
  WikimediaRemovedAssetSummary,
} from "./WikimediaMvpHygieneTypes.js";

export type WikimediaMvpCandidateStatus = "KEEP" | "REVIEW" | "REJECT";

export type WikimediaMvpRunStatus = "idle" | "running" | "complete" | "failed";

export type WikimediaMvpBudget = {
  wikimediaRequests: number;
  firestoreReadsEstimated: number;
  firestoreWritesAttempted: number;
  firestoreWritesSkippedDryRun: number;
  cacheHits: number;
  cacheMisses: number;
  elapsedMs: number;
};

export type WikimediaMvpRunCaps = {
  maxPlacesPerRun: number;
  maxCandidatesPerPlace: number;
  maxSearchPagesPerPlace: number;
  maxHydrateTitlesPerPlace: number;
  fetchAllMaxCandidatesPerPlace: number;
  fetchAllMaxSearchPages: number;
  placeTimeoutMs: number;
  /** After analysis, cap non-REJECT candidates passed into grouping (balanced / fast). */
  maxAnalyzedCandidatesForGrouping?: number;
};

export type WikimediaMvpSeedPlace = {
  placeName: string;
  searchQuery: string;
  stateName?: string;
  stateCode?: string;
  nearestTown?: string;
  countyName?: string;
  placeCategoryKeywords?: string[];
  /** Commons category title from Wikidata / candidate (with or without `Category:` prefix). */
  commonsCategoryFromWikidata?: string;
  wikidataQid?: string;
  wikipediaTitle?: string;
  latitude?: number | null;
  longitude?: number | null;
  rationale?: string;
  themes?: string[];
};

export type WikimediaMvpNormalizedAsset = {
  title: string;
  pageUrl: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  mime: string;
  categories: string[];
  titleLower: string;
  lat: number | null;
  lon: number | null;
  dayKey: string;
  dateSource: string;
  capturedAtMs: number | null;
  descriptionText: string | null;
  author?: string | null;
  license?: string | null;
  credit?: string | null;
  /** Discovery: best Commons search / category query that yielded this file. */
  matchedQuery?: string;
  matchedQueryRank?: number;
  queryVariantType?: string;
  /** e.g. commons_category_from_wikidata, commons_search_exact_name */
  sourceLabel?: string;
  /** 1 = highest confidence (Wikidata category), 6 = broad fallback. */
  sourceConfidenceRank?: number;
  allMatchedQueries?: string[];
};

export type WikimediaMvpCandidateAnalysis = {
  sourceTitle: string;
  generatedTitle: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  fullImageUrl: string;
  author: string | null;
  license: string | null;
  credit: string | null;
  activities: string[];
  activityReasoning: string[];
  activityUncertainty: string | null;
  titleConfidence: "high" | "medium" | "low";
  placeMatchConfidence: number;
  mediaPlaceMatchScore?: number;
  mediaPlaceMatchReasons?: string[];
  mediaPlaceMismatchReasons?: string[];
  matchedQuery?: string;
  matchedQueryRank?: number;
  queryVariantType?: string;
  sourceLabel?: string;
  sourceConfidenceRank?: number;
  /** Miles from seed place coordinates when both asset and place have coordinates. */
  assetDistanceMilesFromPlace?: number | null;
  qualityScore: number;
  relevanceScore: number;
  coolnessScore: number;
  duplicateScore: number | null;
  duplicateReason: string | null;
  status: WikimediaMvpCandidateStatus;
  reasoning: string[];
  scores: Record<string, number>;
  postPreview: Record<string, unknown> | null;
  candidateId?: string;
  groupId?: string;
} & Partial<WikimediaAssetHygieneFields>;

export type WikimediaAssetGroup = {
  groupId: string;
  placeName: string;
  groupKey: string;
  groupMethod:
    | "exactDate"
    | "month"
    | "year"
    | "unknownDateSingleAsset"
    | "fallback"
    | "place_match_fallback";
  dateRange?: {
    earliest?: string;
    latest?: string;
  };
  hasLocatedAsset: boolean;
  locatedAssetCount: number;
  assetCount: number;
  assets: Array<
    WikimediaMvpCandidateAnalysis & {
      candidateId: string;
      dayKey: string;
      capturedAtMs: number | null;
      assetLatitude: number | null;
      assetLongitude: number | null;
      hasRealAssetLocation: boolean;
      groupId?: string;
      width: number;
      height: number;
    }
  >;
  representativeAssetId: string;
  generatedTitle: string;
  activities: string[];
  status: WikimediaMvpCandidateStatus;
  rejectionReasons: string[];
  reasoning: string[];
  dryRunPostPreview?: unknown;
  originalAssetCount?: number;
  keptAssetCount?: number;
  rejectedAssetCount?: number;
  reviewAssetCount?: number;
  rejectedDuplicateCount?: number;
  rejectedHygieneCount?: number;
  removedAssets?: WikimediaRemovedAssetSummary[];
  reviewAssets?: WikimediaRemovedAssetSummary[];
  assetHygieneSummary?: WikimediaAssetHygieneSummary;
  /** When set, post preview may use place coordinates because assets lack geotags. */
  locationFallback?: "none" | "place_candidate";
};

export type WikimediaPostMediaLocationRole =
  | "location_anchor"
  | "matched_unlocated_ridealong"
  | "excluded_unlocated"
  | "excluded_wrong_location";

export type WikimediaGeneratedPostMedia = {
  candidateId: string;
  sourceTitle: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  fullImageUrl: string;
  author: string | null;
  license: string | null;
  credit: string | null;
  width?: number;
  height?: number;
  suppliesPostLocation: boolean;
  hasRealAssetLocation: boolean;
  hygieneStatus?: WikimediaAssetHygieneFields["hygieneStatus"];
  duplicateDecision?: WikimediaAssetHygieneFields["duplicateDecision"];
  hygieneReasons?: string[];
  hygieneWarnings?: string[];
  visualHashDistanceToPrimary?: number;
  /** State Content Factory / location trust (optional). */
  mediaPlaceMatchScore?: number;
  mediaPlaceMismatchReasons?: string[];
  sourceConfidenceRank?: number;
  matchedQuery?: string;
  assetLatitude?: number | null;
  assetLongitude?: number | null;
  /** True when real Commons asset lat/lng exist (same idea as hasRealAssetLocation). */
  hasAssetCoordinates?: boolean;
  assetDistanceMilesFromPlace?: number | null;
  includedInStageablePreview?: boolean;
  locationRole?: WikimediaPostMediaLocationRole;
};

/** `asset_geotag_required` = Locava production policy (no place-coordinate staging). */
export type StateContentLocationTrustMode = "asset_geotag_required" | "legacy_place_fallback_allowed";

export type WikimediaGeneratedPostLocationTrust = {
  mode: StateContentLocationTrustMode;
  stagingAllowed: boolean;
  /** Final coordinates used for a stageable post (from located assets only). */
  stagingPostLat: number | null;
  stagingPostLng: number | null;
  locationSourceForStaging: "asset_geotag" | "located_asset_representative" | "located_asset_centroid" | "none";
  locationConfidenceForStaging: "high" | "medium" | "low";
  placeFallbackAttemptedBlocked: boolean;
  locatedAssetsClustered: boolean;
  trustRejectionCodes: string[];
  locatedAnchorCandidateId?: string;
  locatedAssetCountInPreview: number;
  nonlocatedRidealongCount: number;
  excludedUnlocatedCount: number;
  wrongLocationExcludedCount: number;
  /** When false, legacy computeFactory may still use place pin for preview maps. */
  bypassed?: boolean;
};

export type WikimediaGeneratedPost = {
  postId: string;
  groupId: string;
  placeName: string;
  generatedTitle: string;
  titleReasoning: string[];
  titleConfidence: "high" | "medium" | "low";
  activities: string[];
  activityReasoning: string[];
  status: WikimediaMvpCandidateStatus;
  rejectionReasons: string[];
  reasoning: string[];
  groupMethod: WikimediaAssetGroup["groupMethod"];
  dateRange?: WikimediaAssetGroup["dateRange"];
  assetCount: number;
  locatedAssetCount: number;
  selectedLocation: {
    candidateId: string;
    latitude: number | null;
    longitude: number | null;
    reasoning: string;
  };
  groupedCandidateIds: string[];
  media: WikimediaGeneratedPostMedia[];
  /** Location-trust evaluation for State Content Factory (asset geotag required path). */
  locationTrust?: WikimediaGeneratedPostLocationTrust;
  dryRunPostPreview: Record<string, unknown>;
  candidateReasoning: Array<{ candidateId: string; reasoning: string[] }>;
  originalAssetCount?: number;
  keptAssetCount?: number;
  rejectedAssetCount?: number;
  reviewAssetCount?: number;
  rejectedDuplicateCount?: number;
  rejectedHygieneCount?: number;
  removedAssets?: WikimediaRemovedAssetSummary[];
  reviewAssets?: WikimediaRemovedAssetSummary[];
  assetHygieneSummary?: WikimediaAssetHygieneSummary;
};

export type WikimediaMvpPlaceSummary = {
  candidateCount: number;
  assetGroupsCount: number;
  generatedPostsCount: number;
  keptGeneratedPostsCount: number;
  reviewGeneratedPostsCount: number;
  rejectedGeneratedPostsCount: number;
  rejectedNoLocationGroupCount: number;
  multiAssetPostCount: number;
  singleAssetPostCount: number;
  originalAssetCount?: number;
  rejectedDuplicateCount?: number;
  rejectedHygieneCount?: number;
  possibleDuplicateReviewCount?: number;
  rejectedPanoramaCount?: number;
  rejectedLowQualityCount?: number;
  rejectedBlackAndWhiteOrFilterCount?: number;
  budget: WikimediaMvpBudget;
};

export type WikimediaCommonsQueryStat = {
  query: string;
  variantType: string;
  sourceLabel: string;
  /** Raw hits returned from Commons API for this query (may include duplicates). */
  resultCount: number;
  /** New unique file titles attributed to this query before global dedupe. */
  newTitlesIngested?: number;
  /** Hydrated assets whose best matched query equals this row's query. */
  hydratedCount?: number;
  keptAssetCount: number;
  rejectedAssetCount?: number;
  timedOut?: boolean;
  topRejectionReasons?: Array<{ reason: string; count: number }>;
};

export type WikimediaMvpPlaceResult = {
  placeName: string;
  normalizedPlaceName: string;
  wikimediaQueryTerms: string[];
  commonsQueryPlan?: Array<{ query: string; variantType: string; rank: number }>;
  commonsQueryStats?: WikimediaCommonsQueryStat[];
  partialReason?: string;
  /** Unique titles collected from Commons before hydrate. */
  titlesDiscoveredCount?: number;
  /** Rows returned from hydrate. */
  assetsHydratedCount?: number;
  /** Candidates passing analysis + hygiene that remain eligible for previews (not pipeline-rejected). */
  assetsAcceptedForGroupingCount?: number;
  /** Media items in non-rejected generated post previews. */
  assetsGroupedIntoPreviewsCount?: number;
  candidateCount: number;
  /**
   * Candidates with analysis status KEEP (excludes hygiene-only rejects; see assetsAcceptedAfterHygieneCount).
   * @deprecated Prefer assetsAcceptedAfterHygieneCount + assetsStrictKeepCount for dashboards.
   */
  keptCount: number;
  rejectedCount: number;
  reviewCount: number;
  /** KEEP or REVIEW and hygiene not REJECT — eligible for previews pipeline. */
  assetsAcceptedAfterHygieneCount?: number;
  /** Analysis status KEEP and hygiene not REJECT. */
  assetsStrictKeepCount?: number;
  /** status REJECT or hygieneStatus REJECT. */
  assetsPipelineRejectedCount?: number;
  totalRuntimeMs: number;
  budget: WikimediaMvpBudget;
  errors: string[];
  warnings: string[];
  candidateAnalysis: WikimediaMvpCandidateAnalysis[];
  generatedPosts: WikimediaGeneratedPost[];
  assetGroups: WikimediaAssetGroup[];
  summary: WikimediaMvpPlaceSummary;
  candidates: WikimediaMvpCandidateAnalysis[];
};

/** Early exit from multi-query Commons collection (balanced / fast_preview). */
export type WikimediaMvpCollectEarlyStop = {
  enabled: boolean;
  minDiscoveredTitles: number;
  maxPlanRankWhileEarly: number;
};

export type WikimediaMvpRunEventLevel = "info" | "warn" | "error";

export type WikimediaMvpRunEvent = {
  cursor: number;
  timestamp: string;
  level: WikimediaMvpRunEventLevel;
  runId: string;
  placeName?: string;
  message: string;
  data?: Record<string, unknown>;
};

export type WikimediaMvpRunState = {
  runId: string;
  status: WikimediaMvpRunStatus;
  createdAtMs: number;
  updatedAtMs: number;
  places: string[];
  normalizedPlaces: string[];
  nextPlaceIndex: number;
  limitPerPlace: number;
  fetchAll: boolean;
  caps: WikimediaMvpRunCaps;
  dryRun: boolean;
  allowWrites: boolean;
  logs: string[];
  events: WikimediaMvpRunEvent[];
  nextEventCursor: number;
  placeResults: WikimediaMvpPlaceResult[];
  seeds?: WikimediaMvpSeedPlace[];
  budget: WikimediaMvpBudget;
  error: string | null;
  collectEarlyStop?: WikimediaMvpCollectEarlyStop;
  /** When true, do not emit per-candidate Wikimedia run events (large runs). */
  silencePerCandidateWikimediaEvents?: boolean;
};
