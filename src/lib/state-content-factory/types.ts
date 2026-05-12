import type { PlaceCandidate, PlaceCandidateMode } from "../place-candidates/types.js";
import type {
  WikimediaCommonsQueryStat,
  WikimediaGeneratedPost,
  StateContentLocationTrustMode,
} from "../wikimediaMvp/WikimediaMvpTypes.js";
import type { FactoryPostDisplayFields } from "./computeFactoryPostDisplay.js";

export type StateContentFactoryRunMode = "dry_run" | "stage_only";
export type StateContentFactoryQualityThreshold = "strict" | "normal" | "loose";
export type StateContentFactoryPhase =
  | "idle"
  | "place_discovery"
  | "candidate_selection"
  | "place_processing"
  | "staging"
  | "complete"
  | "failed";

export type StateContentFactoryRunStatus = "running" | "completed" | "failed" | "cancelled";

export type StateContentFactoryPostQualityStatus = "stageable" | "needs_review" | "rejected";

export type StateContentFactoryStagedPostStatus = "staged" | "approved" | "rejected" | "needs_review" | "duplicate";

export type StateContentFactoryRunEventType =
  | "STATE_CONTENT_RUN_STARTED"
  | "STATE_CONTENT_PLACE_DISCOVERY_STARTED"
  | "STATE_CONTENT_PLACE_DISCOVERY_DONE"
  | "STATE_CONTENT_CANDIDATES_SELECTED"
  | "STATE_CONTENT_PLACE_PROCESS_STARTED"
  | "STATE_CONTENT_PLACE_MEDIA_DONE"
  | "STATE_CONTENT_PLACE_GROUPING_DONE"
  | "STATE_CONTENT_PLACE_NO_MEDIA"
  | "STATE_CONTENT_PLACE_NO_USABLE_MEDIA"
  | "STATE_CONTENT_PLACE_NO_POST_PREVIEWS"
  | "STATE_CONTENT_PLACE_PREVIEWS_BUILT"
  | "STATE_CONTENT_PLACE_PREVIEW_DONE"
  | "STATE_CONTENT_PLACE_PROCESS_DONE"
  | "STATE_CONTENT_PLACE_PROCESS_FAILED"
  | "STATE_CONTENT_POST_PREVIEW_BUILT"
  /** One summary per place after previews are evaluated (replaces repeated POST_PREVIEW_BUILT spam). */
  | "STATE_CONTENT_PLACE_POST_PREVIEWS_SUMMARY"
  | "STATE_CONTENT_POST_PREVIEW_REJECTED"
  | "STATE_CONTENT_STAGE_WRITE_SKIPPED_DRY_RUN"
  | "STATE_CONTENT_STAGED_POST_CREATED"
  | "STATE_CONTENT_READ_BUDGET_WARNING"
  | "STATE_CONTENT_READ_BUDGET_EXCEEDED"
  | "STATE_CONTENT_WRITE_BUDGET_WARNING"
  | "STATE_CONTENT_WRITE_BUDGET_EXCEEDED"
  | "STATE_CONTENT_EXTERNAL_REQUEST_BUDGET_WARNING"
  | "STATE_CONTENT_EXTERNAL_REQUEST_BUDGET_EXCEEDED"
  | "STATE_CONTENT_RUN_PARTIAL"
  | "STATE_CONTENT_RUN_DONE"
  | "STATE_CONTENT_RUN_FAILED";

export type StateContentPlaceProcessStatus =
  | "processed"
  | "no_media"
  | "no_usable_media"
  | "no_geotagged_group"
  | "no_post_previews"
  | "rejected_by_quality_gate"
  | "failed"
  | "timeout";

export type StateContentPreviewMedia = {
  title?: string;
  /** Direct image URL (alias of full image). */
  fullImageUrl?: string;
  /** Direct thumbnail image URL (alias of thumbUrl). */
  thumbnailUrl?: string;
  imageUrl?: string;
  thumbUrl?: string;
  displayUrl?: string;
  commonsUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  license?: string;
  creator?: string;
  attributionText?: string;
  hasAssetCoordinates?: boolean;
  assetLat?: number;
  assetLng?: number;
  assetDistanceMilesFromPlace?: number | null;
  includedInStageablePreview?: boolean;
  locationRole?: string;
};

export type StateContentPreviewCover = {
  imageUrl?: string;
  thumbUrl?: string;
  displayUrl?: string;
  commonsUrl?: string;
  title?: string;
};

export type StateContentPreviewAttribution = {
  title?: string;
  creator?: string;
  license?: string;
  sourceUrl?: string;
  commonsUrl?: string;
};

export type StateContentPreviewGrouping = {
  assetCount: number;
  geotaggedAssetCount?: number;
  startAt?: string;
  endAt?: string;
};

export type StateContentPreviewSummary = {
  postId: string;
  groupId: string;
  title: string;
  description: string;
  /** Wikimedia/file-derived title before factory display override. */
  wikimediaSuggestedTitle?: string;
  descriptionSource?: "wikimedia_caption" | "wikimedia_generated" | "fallback_place_description";
  mediaCount: number;
  locationSource: string;
  locationConfidence?: "high" | "medium" | "low";
  qualityStatus: StateContentFactoryPostQualityStatus;
  qualityScore: number;
  warnings: string[];
  /** Extra factory / quality gate warnings (e.g. place coordinate fallback). */
  factoryPreviewWarnings?: string[];
  rejectReasons: string[];
  ruleFailures: string[];
  primaryFailure?: string;
  wikimediaStatus: string;
  wikimediaRejectionReasons: string[];
  media: StateContentPreviewMedia[];
  cover?: StateContentPreviewCover;
  attribution: StateContentPreviewAttribution[];
  grouping?: StateContentPreviewGrouping;
  /** Location-trust / staging diagnostics for dashboard cards. */
  locationTrust?: {
    stagingAllowed: boolean;
    placeFallbackBlocked?: boolean;
    trustRejectionCodes?: string[];
    anchorCandidateId?: string;
    anchorAssetTitle?: string;
    postLat?: number | null;
    postLng?: number | null;
    locationSource?: string;
    locatedAssetCount?: number;
    nonlocatedRidealongCount?: number;
    excludedUnlocatedCount?: number;
    wrongLocationExcludedCount?: number;
  };
  debug?: Record<string, unknown>;
};

export type StateContentPlaceProcessResult = {
  placeCandidateId: string;
  placeName: string;
  priorityQueue?: PlaceCandidate["priorityQueue"];
  lat?: number;
  lng?: number;
  status: StateContentPlaceProcessStatus;
  /** Titles discovered from Commons before hydrate. */
  mediaAssetsFound: number;
  /** Rows hydrated from Commons. */
  mediaAssetsHydrated?: number;
  /** KEEP or REVIEW with hygiene pass — eligible for post previews. */
  mediaAssetsAcceptedForPipeline?: number;
  /** Analysis KEEP + hygiene pass (high-confidence subset). */
  mediaAssetsStrictKeep?: number;
  /**
   * @deprecated Use mediaAssetsAcceptedForPipeline — previously meant analysis KEEP only and contradicted previews.
   */
  mediaAssetsKept: number;
  /** Analysis REJECT or hygiene REJECT. */
  mediaAssetsRejected: number;
  /** Media items attached to non-rejected previews. */
  mediaAssetsGroupedIntoPreviews?: number;
  groupsBuilt: number;
  groupsRejected: number;
  postPreviewsGenerated: number;
  postPreviewsRejected: number;
  stageablePostPreviews: number;
  needsReviewPostPreviews: number;
  /** Same as stageablePostPreviews (no manual review queue). */
  wouldStageForReview: number;
  /** Same as stageablePostPreviews. */
  wouldAutoApprove: number;
  /** @deprecated Alias of stageablePostPreviews — was stageable+needs_review. */
  wouldStage: number;
  /** Wikimedia assets with real coordinates in the pipeline. */
  locatedAssetsFound?: number;
  /** Located anchors counted inside stageable previews for this place. */
  validLocatedAssetsInStageablePreviews?: number;
  nonlocatedRidealongAssetsIncluded?: number;
  excludedUnlocatedAssets?: number;
  wrongLocationAssetsExcluded?: number;
  postPreviewsLocationUnverified?: number;
  stagedPostsCreated: number;
  previews: StateContentPreviewSummary[];
  rejectedGroups: Array<{
    reason: string;
    assetCount: number;
    geotaggedAssetCount: number;
  }>;
  failureReason?: string;
  elapsedMs: number;
  wikimediaQueryTerms?: string[];
  commonsQueryPlan?: Array<{ query: string; variantType: string; rank: number }>;
  commonsQueryStats?: WikimediaCommonsQueryStat[];
  errors?: string[];
  warnings?: string[];
  topAssetRejectReasons?: Array<{ reason: string; count: number }>;
  sampleRejectedAssets?: Array<{
    title: string;
    sourceUrl: string;
    thumbnailUrl?: string;
    matchedQuery?: string;
    matchedQueryRank?: number;
    mediaPlaceMatchScore?: number;
    assetDistanceMilesFromPlace?: number | null;
    reasons: string[];
  }>;
};

export type StateContentFactoryBudgetSnapshot = {
  firestoreReads: number;
  firestoreWrites: number;
  externalRequests: number;
  wikidataRequests: number;
  commonsRequests: number;
  mediaRequests: number;
  maxFirestoreReads: number;
  maxFirestoreWrites: number;
  maxExternalRequests: number;
  maxPlacesProcessed: number;
};

export type StateContentFactoryWriteCounts = {
  stateContentRuns: number;
  placeCandidates: number;
  stagedGeneratedPosts: number;
  publicPosts: number;
};

export type StateContentFactoryRunKind = "full" | "place_only" | "post_only";

/** strict/normal = staging intent thresholds; preview_all = same quality labels, UI shows all previews (dry-run debug). */
export type StateContentFactoryQualityPreviewMode = "strict" | "normal" | "preview_all";

export type StateContentFactoryRunConfig = {
  runKind: StateContentFactoryRunKind;
  stateName: string;
  stateCode?: string;
  runMode: StateContentFactoryRunMode;
  postOnlyPlace?: string;
  placeSource: "wikidata";
  placeDiscoveryMode: PlaceCandidateMode;
  candidateLimit: number;
  priorityQueues: Array<"P0" | "P1" | "P2" | "P3">;
  maxPlacesToProcess: number;
  includeMediaSignals: boolean;
  qualityThreshold: StateContentFactoryQualityThreshold;
  qualityPreviewMode: StateContentFactoryQualityPreviewMode;
  maxPostPreviewsPerPlace: number;
  maxAssetsPerPostPreview: number;
  groupTimeWindowMinutes: number;
  totalTimeoutMs: number;
  perPlaceTimeoutMs: number;
  /**
   * When true (default), each place uses Wikimedia `fetchAll` mode (more search pages + higher candidate cap),
   * matching exhaustive Commons harvesting. Set false for faster/shallower runs.
   */
  wikimediaFetchAllExhaustive?: boolean;
  /** Wikimedia harvest profile: fast_preview | balanced | exhaustive. */
  wikimediaMode?: "fast_preview" | "balanced" | "exhaustive";
  /** Dev post-test only: explicit coordinates for manual place label. */
  postTestLatitude?: number;
  postTestLongitude?: number;
  /** Default asset_geotag_required: never stage without real asset coordinates. */
  locationTrustMode?: StateContentLocationTrustMode;
  allowStagingWrites: boolean;
  allowPublicPublish: boolean;
};

export type StateContentFactoryRunCounts = {
  rawCandidates: number;
  eligibleCandidates: number;
  blockedCandidates: number;
  selectedPlaces: number;
  placesProcessed: number;
  placesFailed: number;
  placesWithPreviews: number;
  placesWithNoMedia: number;
  placesWithNoPostPreviews: number;
  postPreviewsGenerated: number;
  postPreviewsRejected: number;
  postPreviewsStageable: number;
  postPreviewsNeedsReview: number;
  /** Same as postPreviewsStageable. */
  wouldStageForReviewPosts: number;
  /** Same as postPreviewsStageable. */
  wouldAutoApprovePosts: number;
  /** @deprecated Alias of postPreviewsStageable. */
  wouldStagePosts: number;
  stagedPostsCreated: number;
  publicPostsWritten: number;
};

export type StateContentFactoryEvaluatedPost = {
  generatedPost: WikimediaGeneratedPost;
  placeCandidate: PlaceCandidate;
  qualityStatus: StateContentFactoryPostQualityStatus;
  qualityReasons: string[];
  qualityRuleFailures: string[];
  qualityPrimaryFailure?: string;
  duplicateHash?: string;
  stagedPostId?: string;
  /** Factory-only display fields (place-based title, fallback description, coordinate fallback). */
  factoryDisplay?: FactoryPostDisplayFields;
};

export type StateContentFactoryRunResult = {
  ok: boolean;
  dryRun: boolean;
  runId: string;
  runMode: StateContentFactoryRunMode;
  partial: boolean;
  partialReason?: string;
  phase: StateContentFactoryPhase;
  stateName: string;
  stateCode?: string;
  elapsedMs: number;
  counts: StateContentFactoryRunCounts;
  budget: StateContentFactoryBudgetSnapshot;
  wouldWrite: StateContentFactoryWriteCounts;
  actualWrites: StateContentFactoryWriteCounts;
  publicPostsWritten: number;
  selectedCandidates: PlaceCandidate[];
  evaluatedPosts: StateContentFactoryEvaluatedPost[];
  placeResults: StateContentPlaceProcessResult[];
  placeDiscovery?: unknown;
  usingPostGenerationEntrypoint: string;
  /** Mirrors request: exhaustive Wikimedia `fetchAll` per place when true. */
  wikimediaFetchAllExhaustive: boolean;
  wikimediaMode?: "fast_preview" | "balanced" | "exhaustive";
  qualityPreviewMode: StateContentFactoryQualityPreviewMode;
  warnings: string[];
};

export type StateContentFactoryRunEvent = {
  cursor?: number;
  timestamp?: string;
  type: StateContentFactoryRunEventType;
  runId: string;
  phase?: StateContentFactoryPhase;
  stateName?: string;
  stateCode?: string;
  placeCandidateId?: string;
  placeName?: string;
  elapsedMs?: number;
  counts?: Record<string, number | string>;
  firestoreReads?: number;
  firestoreWrites?: number;
  maxFirestoreReads?: number;
  maxFirestoreWrites?: number;
  externalRequests?: number;
  maxExternalRequests?: number;
  percentUsed?: number;
  source?: string;
  dryRun?: boolean;
  allowStagingWrites?: boolean;
  publicPostsWritten?: number;
  message?: string;
};

export type StateContentFactoryDevRunState = {
  runId: string;
  status: StateContentFactoryRunStatus;
  phase: StateContentFactoryPhase;
  createdAtMs: number;
  updatedAtMs: number;
  request: StateContentFactoryRunConfig;
  currentPlaceName?: string;
  result: StateContentFactoryRunResult | null;
  error: string | null;
  logs: string[];
  events: StateContentFactoryRunEvent[];
  nextEventCursor: number;
};

export type StateContentFactoryStagedPostRecord = {
  stagedPostId: string;
  runId: string;
  placeCandidateId: string;
  status: StateContentFactoryStagedPostStatus;
  publishStatus: "not_published";
  stateName: string;
  stateCode?: string;
  place: Pick<PlaceCandidate, "placeCandidateId" | "name" | "lat" | "lng" | "primaryCategory" | "priorityQueue">;
  postPreview: Record<string, unknown>;
  quality: {
    status: StateContentFactoryPostQualityStatus;
    reasons: string[];
    duplicateHash?: string;
  };
  attribution: Record<string, unknown>;
  duplicate?: Record<string, unknown>;
  debug?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
