import type { AppEnv } from "../../config/env.js";
import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaMvpPlaceResult } from "../wikimediaMvp/WikimediaMvpTypes.js";
import {
  runWikimediaPlacePreviewPipeline,
  WIKIMEDIA_PLACE_PREVIEW_PIPELINE_ENTRYPOINT,
} from "../wikimediaMvp/runWikimediaPlacePreviewPipeline.js";
import {
  buildWikimediaSearchLabelFromPlaceCandidate,
  buildWikimediaSeedFromPlaceCandidate,
} from "./buildWikimediaSeedFromPlaceCandidate.js";
import { applyLocationTrustPolicy } from "./applyLocationTrustPolicy.js";
import { buildAssetRejectDiagnosticsMerged } from "./buildAssetRejectDiagnostics.js";
import { resolveWikimediaPipelineConfig } from "./resolveWikimediaPipelineConfig.js";
import { computeFactoryPostDisplay } from "./computeFactoryPostDisplay.js";
import { evaluateGeneratedPostQuality } from "./evaluateGeneratedPostQuality.js";
import type {
  StateContentFactoryEvaluatedPost,
  StateContentFactoryRunConfig,
  StateContentFactoryRunEvent,
  StateContentPlaceProcessResult,
} from "./types.js";
import type { WikimediaCommonsQueryStat } from "../wikimediaMvp/WikimediaMvpTypes.js";
import { buildStateContentPlacePreviewSummaries } from "./buildStateContentPlacePreviewSummaries.js";

export const STATE_CONTENT_WIKIMEDIA_POST_GENERATION_ENTRYPOINT = WIKIMEDIA_PLACE_PREVIEW_PIPELINE_ENTRYPOINT;

function classifyZeroPreviewStatus(input: {
  candidateCount: number;
  generatedPostsCount: number;
  rejectedNoLocationGroupCount: number;
  assetGroupsCount: number;
  errors: string[];
}): Exclude<StateContentPlaceProcessResult["status"], "processed" | "rejected_by_quality_gate"> {
  if (input.errors.length > 0 && input.candidateCount === 0) {
    const joined = input.errors.join(" ").toLowerCase();
    if (joined.includes("abort") || joined.includes("timeout")) return "timeout";
    return "failed";
  }
  if (input.candidateCount === 0) return "no_media";
  if (input.assetGroupsCount === 0) return "no_usable_media";
  if (input.rejectedNoLocationGroupCount > 0 && input.generatedPostsCount === 0) return "no_geotagged_group";
  if (input.generatedPostsCount === 0) return "no_post_previews";
  return "no_post_previews";
}

export function buildStateContentPlaceProcessResult(input: {
  candidate: PlaceCandidate;
  placeResult: WikimediaMvpPlaceResult;
  evaluatedPosts: StateContentFactoryEvaluatedPost[];
  elapsedMs: number;
  failureReason?: string;
}): StateContentPlaceProcessResult {
  const summary = input.placeResult.summary;
  const generatedPosts = input.placeResult.generatedPosts;
  const rejectedGroups = input.placeResult.assetGroups
    .filter((group) => group.rejectionReasons.length > 0)
    .map((group) => ({
      reason: group.rejectionReasons.join(", "),
      assetCount: group.assetCount,
      geotaggedAssetCount: group.locatedAssetCount,
    }));
  const stageablePostPreviews = input.evaluatedPosts.filter((row) => row.qualityStatus === "stageable").length;
  const needsReviewPostPreviews = input.evaluatedPosts.filter((row) => row.qualityStatus === "needs_review").length;
  const rejectedPostPreviews = input.evaluatedPosts.filter((row) => row.qualityStatus === "rejected").length;
  const wouldStageForReview = stageablePostPreviews;
  const wouldAutoApprove = stageablePostPreviews;
  const status =
    input.failureReason != null
      ? input.failureReason.toLowerCase().includes("timeout")
        ? "timeout"
        : "failed"
      : generatedPosts.length === 0
        ? classifyZeroPreviewStatus({
            candidateCount: summary.candidateCount,
            generatedPostsCount: summary.generatedPostsCount,
            rejectedNoLocationGroupCount: summary.rejectedNoLocationGroupCount,
            assetGroupsCount: summary.assetGroupsCount,
            errors: input.placeResult.errors,
          })
        : stageablePostPreviews > 0 || needsReviewPostPreviews > 0
          ? "processed"
          : rejectedPostPreviews > 0
            ? "rejected_by_quality_gate"
            : "no_post_previews";

  const analysis = input.placeResult.candidateAnalysis ?? [];
  let { topAssetRejectReasons, sampleRejectedAssets } = buildAssetRejectDiagnosticsMerged(
    analysis,
    input.placeResult.assetGroups,
  );
  const pipelineRejectedCount =
    input.placeResult.assetsPipelineRejectedCount ??
    analysis.filter((c) => c.status === "REJECT" || c.hygieneStatus === "REJECT").length;
  if (pipelineRejectedCount > 0 && topAssetRejectReasons.length === 0) {
    topAssetRejectReasons = [{ reason: "reject_unknown_pipeline", count: pipelineRejectedCount }];
    if (sampleRejectedAssets.length === 0 && analysis.length > 0) {
      const first = analysis.find((c) => c.status === "REJECT" || c.hygieneStatus === "REJECT");
      if (first) {
        sampleRejectedAssets = [
          {
            title: first.sourceTitle,
            sourceUrl: first.sourceUrl,
            thumbnailUrl: first.thumbnailUrl ?? undefined,
            matchedQuery: first.matchedQuery,
            matchedQueryRank: first.matchedQueryRank,
            mediaPlaceMatchScore: first.mediaPlaceMatchScore,
            assetDistanceMilesFromPlace: first.assetDistanceMilesFromPlace ?? null,
            reasons: ["pipeline_reject_sample"],
          },
        ];
      }
    }
  }

  const locatedAssetsFound = analysis.filter((c) => (c as { hasRealAssetLocation?: boolean }).hasRealAssetLocation === true)
    .length;

  let validLocatedAssetsInStageablePreviews = 0;
  let nonlocatedRidealongAssetsIncluded = 0;
  let excludedUnlocatedAssets = 0;
  let wrongLocationAssetsExcluded = 0;
  for (const row of input.evaluatedPosts) {
    const lt = row.generatedPost.locationTrust;
    if (!lt || lt.bypassed) continue;
    if (row.qualityStatus === "stageable") {
      validLocatedAssetsInStageablePreviews += lt.locatedAssetCountInPreview;
      nonlocatedRidealongAssetsIncluded += lt.nonlocatedRidealongCount;
    }
    excludedUnlocatedAssets += lt.excludedUnlocatedCount;
    wrongLocationAssetsExcluded += lt.wrongLocationExcludedCount;
  }

  const commonsQueryStats: WikimediaCommonsQueryStat[] =
    input.placeResult.commonsQueryStats && input.placeResult.commonsQueryStats.length > 0
      ? input.placeResult.commonsQueryStats
      : (input.placeResult.commonsQueryPlan ?? []).map((p) => ({
          query: p.query,
          variantType: p.variantType,
          sourceLabel: "stats_missing",
          resultCount: 0,
          newTitlesIngested: 0,
          hydratedCount: 0,
          keptAssetCount: 0,
          rejectedAssetCount: 0,
          topRejectionReasons: [],
        }));

  const found = input.placeResult.titlesDiscoveredCount ?? summary.candidateCount;
  const hydrated = input.placeResult.assetsHydratedCount ?? summary.candidateCount;
  const accepted =
    input.placeResult.assetsAcceptedAfterHygieneCount ??
    input.placeResult.assetsAcceptedForGroupingCount ??
    0;
  const strictKeep = input.placeResult.assetsStrictKeepCount ?? input.placeResult.keptCount;
  const pipelineRejected =
    input.placeResult.assetsPipelineRejectedCount ??
    input.placeResult.candidateAnalysis.filter((c) => c.status === "REJECT" || c.hygieneStatus === "REJECT").length;
  const groupedInto = input.placeResult.assetsGroupedIntoPreviewsCount ?? 0;

  return {
    placeCandidateId: input.candidate.placeCandidateId,
    placeName: input.candidate.name,
    priorityQueue: input.candidate.priorityQueue,
    lat: input.candidate.lat,
    lng: input.candidate.lng,
    status,
    mediaAssetsFound: found,
    mediaAssetsHydrated: hydrated,
    mediaAssetsAcceptedForPipeline: accepted,
    mediaAssetsStrictKeep: strictKeep,
    mediaAssetsKept: accepted,
    mediaAssetsRejected: pipelineRejected,
    mediaAssetsGroupedIntoPreviews: groupedInto,
    groupsBuilt: summary.assetGroupsCount,
    groupsRejected: rejectedGroups.length,
    postPreviewsGenerated: generatedPosts.length,
    postPreviewsRejected: rejectedPostPreviews,
    stageablePostPreviews,
    needsReviewPostPreviews,
    wouldStageForReview,
    wouldAutoApprove,
    wouldStage: stageablePostPreviews,
    locatedAssetsFound,
    validLocatedAssetsInStageablePreviews,
    nonlocatedRidealongAssetsIncluded,
    excludedUnlocatedAssets,
    wrongLocationAssetsExcluded,
    postPreviewsLocationUnverified: needsReviewPostPreviews,
    stagedPostsCreated: 0,
    previews: buildStateContentPlacePreviewSummaries({
      evaluatedPosts: input.evaluatedPosts,
      assetGroups: input.placeResult.assetGroups,
    }),
    rejectedGroups,
    failureReason: input.failureReason,
    elapsedMs: input.elapsedMs,
    wikimediaQueryTerms: input.placeResult.wikimediaQueryTerms,
    commonsQueryPlan: input.placeResult.commonsQueryPlan,
    commonsQueryStats,
    errors: input.placeResult.errors,
    warnings: input.placeResult.warnings,
    topAssetRejectReasons,
    sampleRejectedAssets,
  };
}

export async function processStateContentFactoryPlace(input: {
  env: AppEnv;
  config: StateContentFactoryRunConfig;
  candidate: PlaceCandidate;
  onEvent?: (event: Omit<StateContentFactoryRunEvent, "runId" | "cursor" | "timestamp">) => void;
}): Promise<{
  placeResult: WikimediaMvpPlaceResult;
  evaluatedPosts: StateContentFactoryEvaluatedPost[];
  placeProcessResult: StateContentPlaceProcessResult;
}> {
  const startedAt = Date.now();
  const placeLabel =
    input.candidate.primaryCategory === "manual"
      ? input.candidate.name.trim().slice(0, 120)
      : buildWikimediaSearchLabelFromPlaceCandidate(input.candidate);
  const wikimediaSeed = buildWikimediaSeedFromPlaceCandidate(input.candidate);
  const resolved = resolveWikimediaPipelineConfig(input.config, input.env);
  const fetchAll = resolved.fetchAll;
  const maxPreviews = Math.min(input.config.maxPostPreviewsPerPlace, resolved.maxPostPreviewsPerPlace);
  const silenceCandidates =
    input.config.maxPlacesToProcess > 6 && input.config.runKind !== "post_only";
  input.onEvent?.({
    type: "STATE_CONTENT_PLACE_PROCESS_STARTED",
    phase: "place_processing",
    placeCandidateId: input.candidate.placeCandidateId,
    placeName: input.candidate.name,
    counts: {
      priorityQueue: input.candidate.priorityQueue ?? "unknown",
      lat: input.candidate.lat ?? 0,
      lng: input.candidate.lng ?? 0,
    },
    message: `Wikimedia mode=${resolved.mode}${fetchAll ? " (fetch all)" : ""} — finding Commons images for “${placeLabel}”…`,
  });
  const placeResultBundle = await runWikimediaPlacePreviewPipeline({
    env: {
      ...input.env,
      WIKIMEDIA_MVP_PLACE_TIMEOUT_MS: resolved.perPlaceTimeoutMs,
    },
    placeLabel,
    limitPerPlace: resolved.maxCommonsResultsPerPlace,
    fetchAll,
    dryRun: true,
    matchStandaloneDevApi: false,
    seed: wikimediaSeed,
    capsOverride: resolved.capsOverride,
    collectEarlyStop: resolved.collectEarlyStop,
    silencePerCandidateWikimediaEvents: silenceCandidates,
  });
  const placeResult = placeResultBundle.placeResult;
  const summary = placeResult.summary;

  input.onEvent?.({
    type: "STATE_CONTENT_PLACE_MEDIA_DONE",
    phase: "place_processing",
    placeName: input.candidate.name,
    counts: {
      assetsFound: placeResult.titlesDiscoveredCount ?? summary.candidateCount,
      assetsHydrated: placeResult.assetsHydratedCount ?? summary.candidateCount,
      assetsAccepted: placeResult.assetsAcceptedAfterHygieneCount ?? 0,
      assetsStrictKeep: placeResult.assetsStrictKeepCount ?? 0,
      assetsRejected: placeResult.assetsPipelineRejectedCount ?? 0,
    },
    message: summary.candidateCount === 0 ? "NO_MEDIA_FOUND" : undefined,
  });

  input.onEvent?.({
    type: "STATE_CONTENT_PLACE_GROUPING_DONE",
    phase: "place_processing",
    placeName: input.candidate.name,
    counts: {
      groupsBuilt: summary.assetGroupsCount,
      groupsRejected: placeResult.assetGroups.filter((group) => group.rejectionReasons.length > 0).length,
    },
  });

  const generatedPosts = placeResult.generatedPosts.slice(0, maxPreviews);
  const locationTrustMode = input.config.locationTrustMode ?? "asset_geotag_required";
  const evaluatedPosts: StateContentFactoryEvaluatedPost[] = generatedPosts.map((gp) => {
    const group = placeResult.assetGroups.find((g) => g.groupId === gp.groupId);
    const generatedPost = applyLocationTrustPolicy({
      candidate: input.candidate,
      generatedPost: gp,
      group,
      mode: locationTrustMode,
    });
    const factoryDisplay = computeFactoryPostDisplay({
      candidate: input.candidate,
      generatedPost,
    });
    const quality = evaluateGeneratedPostQuality({
      candidate: input.candidate,
      generatedPost,
      qualityPreviewMode: input.config.qualityPreviewMode,
      qualityThreshold: input.config.qualityThreshold,
      locationTrustMode,
      effectiveTitle: factoryDisplay.title,
      effectiveDescription: factoryDisplay.description,
      effectiveLat: factoryDisplay.lat,
      effectiveLng: factoryDisplay.lng,
    });
    return {
      generatedPost,
      placeCandidate: input.candidate,
      factoryDisplay,
      qualityStatus: quality.status,
      qualityReasons: quality.reasons,
      qualityRuleFailures: quality.ruleFailures,
      qualityPrimaryFailure: quality.primaryFailure,
      duplicateHash: quality.duplicateHash,
    };
  });

  const placeProcessResult = buildStateContentPlaceProcessResult({
    candidate: input.candidate,
    placeResult,
    evaluatedPosts,
    elapsedMs: Date.now() - startedAt,
    failureReason: placeResult.errors[0],
  });

  if (placeProcessResult.postPreviewsGenerated === 0) {
    const zeroEventType =
      placeProcessResult.status === "no_media"
        ? "STATE_CONTENT_PLACE_NO_MEDIA"
        : placeProcessResult.status === "no_usable_media"
          ? "STATE_CONTENT_PLACE_NO_USABLE_MEDIA"
          : "STATE_CONTENT_PLACE_NO_POST_PREVIEWS";
    input.onEvent?.({
      type: zeroEventType,
      phase: "place_processing",
      placeName: input.candidate.name,
      message: placeProcessResult.status,
      counts: {
        mediaAssetsFound: placeProcessResult.mediaAssetsFound,
        groupsBuilt: placeProcessResult.groupsBuilt,
      },
    });
  } else {
    input.onEvent?.({
      type: "STATE_CONTENT_PLACE_PREVIEWS_BUILT",
      phase: "place_processing",
      placeName: input.candidate.name,
      counts: {
        postPreviewsGenerated: placeProcessResult.postPreviewsGenerated,
        postPreviewsRejected: placeProcessResult.postPreviewsRejected,
        stageablePostPreviews: placeProcessResult.stageablePostPreviews,
        wouldStage: placeProcessResult.stageablePostPreviews,
        wouldAutoApprove: placeProcessResult.wouldAutoApprove,
      },
    });
  }

  input.onEvent?.({
    type: "STATE_CONTENT_PLACE_PREVIEW_DONE",
    phase: "place_processing",
    placeName: input.candidate.name,
    counts: {
      postPreviewsGenerated: placeProcessResult.postPreviewsGenerated,
      postPreviewsRejected: placeProcessResult.postPreviewsRejected,
      stageablePostPreviews: placeProcessResult.stageablePostPreviews,
      wouldStageForReview: placeProcessResult.stageablePostPreviews,
      wouldAutoApprove: placeProcessResult.wouldAutoApprove,
    },
  });

  input.onEvent?.({
    type: "STATE_CONTENT_PLACE_PROCESS_DONE",
    phase: "place_processing",
    placeName: input.candidate.name,
    elapsedMs: placeProcessResult.elapsedMs,
    counts: {
      status: placeProcessResult.status,
      placesProcessed: 1,
    },
  });

  return { placeResult, evaluatedPosts, placeProcessResult };
}
