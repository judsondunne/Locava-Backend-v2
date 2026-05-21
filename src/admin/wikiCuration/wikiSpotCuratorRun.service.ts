import { buildCaptionStyleWarningsForDryReview } from "./wikiSpotCuratorCaptionLint.js";
import {
  WikiSpotCuratorAiResponseSchema,
  type WikiCurationUsage,
  type WikiSpotCuratorDecisionRow,
  type WikiSpotCuratorDryReviewJobResult
} from "./wikiSpotCurator.schema.js";
import {
  buildWikiSpotCuratorSystemPrompt,
  buildWikiSpotCuratorUserPayload,
  type WikiCuratorPromptCandidate
} from "./wikiSpotCuratorPrompt.js";
import { loadWikiCurationSpotCandidates, type WikiCurationCandidatePost } from "./wikiCurationFirestore.service.js";
import { wikiSpotCurationGeminiModel } from "./wikiCurationEnv.js";
import {
  alignDecisionsToCandidates,
  normalizeFinalRanksForCuratorDecisions,
  recomputeSummaryWithCaps
} from "./wikiSpotCuratorNormalize.js";
import { detectViewHintsFromCandidate } from "./wikiSpotCuratorViewHints.js";
import { backendDistanceBucketFromMeters, distanceMetersFromAnchor } from "./wikiSpotCuratorGeo.js";
import { buildCurationInspectionWarnings, enforceLaneSelectionAndDedupe } from "./wikiSpotCuratorLaneSelection.js";
import { estimateGeminiCostUsd } from "./wikiSpotCuratorPricing.js";
import { wikiCurationAppendLog, wikiCurationCompleteJob, wikiCurationFailJob } from "./wikiCurationJobStore.js";
import { geminiGenerateContentJson } from "./geminiGenerateContent.js";

function tryParseJsonLenient(text: string): unknown {
  const t = String(text || "").trim();
  try {
    return JSON.parse(t) as unknown;
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(t.slice(start, end + 1)) as unknown;
    }
    throw new Error("invalid_json");
  }
}

function buildPromptCandidates(
  posts: WikiCurationCandidatePost[],
  anchorLat: number | null,
  anchorLng: number | null,
  maxImagesPerCandidate: number,
  coreRadiusMeters: number,
  nearbyRadiusMeters: number,
  extendedContextRadiusMeters: number
): { candidates: WikiCuratorPromptCandidate[]; imageCountForUsage: number } {
  const lim = Math.max(0, Math.min(12, Math.floor(maxImagesPerCandidate) || 3));
  let imageCountForUsage = 0;
  const candidates: WikiCuratorPromptCandidate[] = posts.map((p) => {
    const hints = detectViewHintsFromCandidate(p);
    const meters = distanceMetersFromAnchor(p.latitude, p.longitude, anchorLat, anchorLng);
    const backendDistanceBucket = backendDistanceBucketFromMeters(
      meters,
      coreRadiusMeters,
      nearbyRadiusMeters,
      extendedContextRadiusMeters
    );
    const media = (p.media || []).slice(0, lim);
    imageCountForUsage += media.length;
    return {
      ...p,
      media,
      distanceMetersFromAnchor: meters,
      backendDistanceBucket,
      detectedViewHints: hints
    };
  });
  return { candidates, imageCountForUsage };
}

function mergeGeographyFromCandidates(
  decisions: WikiSpotCuratorDecisionRow[],
  enrichedByPostId: Map<string, WikiCuratorPromptCandidate>
): WikiSpotCuratorDecisionRow[] {
  return decisions.map((d) => {
    const e = enrichedByPostId.get(d.postId);
    if (!e) {
      return {
        ...d,
        distanceMetersFromAnchor: d.distanceMetersFromAnchor ?? null,
        backendDistanceBucket: d.backendDistanceBucket ?? "unclear"
      };
    }
    return {
      ...d,
      distanceMetersFromAnchor: e.distanceMetersFromAnchor,
      backendDistanceBucket: e.backendDistanceBucket
    };
  });
}

export type WikiSpotDryReviewJobParams = {
  jobId: string;
  runId: string;
  spotId: string;
  /** Legacy: when set without maxTotalPostsPerSpot, caps total publishes. */
  maxPostsPerSpot?: number;
  maxCorePostsPerSpot?: number;
  maxContextPostsPerSpot?: number;
  maxTotalPostsPerSpot?: number;
  maxImagesPerCandidate?: number;
  allowContextualFarRelevant?: boolean;
  rejectPlaneViews?: boolean;
  coreRadiusMeters?: number;
  nearbyRadiusMeters?: number;
  extendedContextRadiusMeters?: number;
  geminiApiKey: string;
};

export async function runWikiSpotDryReviewJob(input: WikiSpotDryReviewJobParams): Promise<void> {
  const { jobId, runId, spotId } = input;

  const maxCorePostsPerSpot = Math.max(0, Math.min(30, Math.floor(input.maxCorePostsPerSpot ?? 5)));
  const maxContextPostsPerSpot = Math.max(0, Math.min(30, Math.floor(input.maxContextPostsPerSpot ?? 3)));
  let maxTotalPostsPerSpot = Math.max(0, Math.min(40, Math.floor(input.maxTotalPostsPerSpot ?? 8)));
  const legacy = input.maxPostsPerSpot;
  if (input.maxTotalPostsPerSpot == null && legacy != null) {
    maxTotalPostsPerSpot = Math.max(0, Math.min(40, Math.floor(legacy)));
  }
  const maxImagesPerCandidate = Math.max(0, Math.min(12, Math.floor(input.maxImagesPerCandidate ?? 3)));
  const allowContextualFarRelevant = input.allowContextualFarRelevant !== false;
  const rejectPlaneViews = input.rejectPlaneViews !== false;
  const coreRadiusMeters = Math.max(100, Math.min(500_000, Math.floor(input.coreRadiusMeters ?? 1000)));
  const nearbyRadiusMeters = Math.max(coreRadiusMeters, Math.min(1_000_000, Math.floor(input.nearbyRadiusMeters ?? 3000)));
  const extendedContextRadiusMeters = Math.max(
    nearbyRadiusMeters,
    Math.min(2_000_000, Math.floor(input.extendedContextRadiusMeters ?? 20_000))
  );

  const curationOptions = {
    maxCorePostsPerSpot,
    maxContextPostsPerSpot,
    maxTotalPostsPerSpot,
    maxImagesPerCandidate,
    allowContextualFarRelevant,
    rejectPlaneViews,
    coreRadiusMeters,
    nearbyRadiusMeters,
    extendedContextRadiusMeters
  };

  try {
    wikiCurationAppendLog(
      jobId,
      `selected run=${runId} spot=${spotId} core=${maxCorePostsPerSpot} context=${maxContextPostsPerSpot} total=${maxTotalPostsPerSpot} maxImages=${maxImagesPerCandidate}`
    );
    const loaded = await loadWikiCurationSpotCandidates({ runId, spotId });
    const posts = loaded.posts;
    wikiCurationAppendLog(jobId, `loaded candidate posts=${posts.length}`);
    if (!posts.length) {
      const empty: WikiSpotCuratorDryReviewJobResult = {
        spotId,
        spotName: loaded.spotName || spotId,
        maxPostsForSpot: maxTotalPostsPerSpot,
        summary: {
          candidateCount: 0,
          recommendedPublishCount: 0,
          recommendedPublishCoreCount: 0,
          recommendedPublishContextCount: 0,
          recommendedSkipCount: 0,
          recommendedNeedsReviewCount: 0,
          overallReasoning: "No staged posts found for this spot.",
          maxCorePostsPerSpot,
          maxContextPostsPerSpot,
          maxTotalPostsPerSpot
        },
        decisions: [],
        dryReviewHints: { captionStyleWarnings: [], decisionInspectionWarnings: [] },
        curationOptions,
        usage: {
          provider: "gemini",
          model: wikiSpotCurationGeminiModel(),
          candidateCount: 0,
          imageCount: 0,
          maxImagesPerCandidate,
          freshCall: false
        }
      };
      wikiCurationCompleteJob(jobId, empty);
      return;
    }

    const key = String(input.geminiApiKey || "").trim();
    if (!key.length) {
      wikiCurationFailJob(jobId, "Missing Gemini API key (expected x-wiki-curation-gemini-api-key on dry-review request)");
      return;
    }
    wikiCurationAppendLog(jobId, "using Gemini API key from x-wiki-curation-gemini-api-key only");

    const { candidates: promptCandidates, imageCountForUsage } = buildPromptCandidates(
      posts,
      loaded.anchorLat,
      loaded.anchorLng,
      maxImagesPerCandidate,
      coreRadiusMeters,
      nearbyRadiusMeters,
      extendedContextRadiusMeters
    );
    const enrichedByPostId = new Map(promptCandidates.map((c) => [c.postId, c]));

    const model = wikiSpotCurationGeminiModel();
    const system = buildWikiSpotCuratorSystemPrompt();
    const user = buildWikiSpotCuratorUserPayload({
      spotId,
      spotName: loaded.spotName,
      maxCorePostsPerSpot,
      maxContextPostsPerSpot,
      maxTotalPostsPerSpot,
      anchorLat: loaded.anchorLat,
      anchorLng: loaded.anchorLng,
      coreRadiusMeters,
      nearbyRadiusMeters,
      extendedContextRadiusMeters,
      candidates: promptCandidates
    });

    wikiCurationAppendLog(jobId, `Gemini request started model=${model}`);
    const gemini = await geminiGenerateContentJson({
      apiKey: key,
      model,
      systemInstruction: system,
      userText: user,
      temperature: 0.35
    });

    const estimatedInputTokens = Math.max(0, Math.ceil((system.length + user.length) / 4) + imageCountForUsage * 280);

    const usageBase: WikiCurationUsage = {
      provider: "gemini",
      model,
      candidateCount: posts.length,
      imageCount: imageCountForUsage,
      maxImagesPerCandidate,
      estimatedInputTokens,
      promptTokenCount: gemini.usage?.promptTokenCount,
      candidatesTokenCount: gemini.usage?.candidatesTokenCount,
      totalTokenCount: gemini.usage?.totalTokenCount,
      freshCall: true
    };

    if (gemini.errorDetail || !gemini.text) {
      const detail = String(gemini.errorDetail || "empty_model_output");
      if (
        detail.toLowerCase().includes("leaked") ||
        detail.includes("PERMISSION_DENIED") ||
        gemini.httpStatus === 403
      ) {
        wikiCurationAppendLog(
          jobId,
          "Hint: paste a fresh Google AI Studio key in the dashboard field (sent as x-wiki-curation-gemini-api-key). Google revokes leaked keys."
        );
      }
      wikiCurationFailJob(jobId, `gemini_http_${gemini.httpStatus}: ${detail.slice(0, 500)}`);
      return;
    }
    wikiCurationAppendLog(jobId, "Gemini response received");

    const cost = estimateGeminiCostUsd({
      model,
      promptTokens: usageBase.promptTokenCount ?? usageBase.estimatedInputTokens,
      outputTokens: usageBase.candidatesTokenCount ?? 0
    });
    usageBase.estimatedCostUsd = cost.estimatedCostUsd;
    usageBase.pricingSource = cost.pricingSource;

    const content = gemini.text;
    let parsedJson: unknown;
    try {
      parsedJson = tryParseJsonLenient(content);
    } catch (e) {
      wikiCurationFailJob(jobId, `json_parse_failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const zFull = WikiSpotCuratorAiResponseSchema.safeParse(parsedJson);
    if (!zFull.success) {
      wikiCurationFailJob(jobId, `schema_validation_failed: ${zFull.error.message}`);
      return;
    }
    wikiCurationAppendLog(jobId, "JSON schema validation ok (top-level)");

    const candidateIds = posts.map((p) => p.postId);
    const aligned = alignDecisionsToCandidates({
      candidateIds,
      rawDecisions: zFull.data.decisions as unknown[],
      spotId,
      spotName: loaded.spotName,
      maxPostsForSpot: maxTotalPostsPerSpot
    });
    if (aligned.issues.length) {
      wikiCurationAppendLog(jobId, `decision row issues=${aligned.issues.length}`);
    }

    const rankNormalized = normalizeFinalRanksForCuratorDecisions(aligned.decisions);
    const mergedGeo = mergeGeographyFromCandidates(rankNormalized, enrichedByPostId);

    const enforced = enforceLaneSelectionAndDedupe(mergedGeo, enrichedByPostId, {
      maxCorePostsPerSpot,
      maxContextPostsPerSpot,
      maxTotalPostsPerSpot,
      rejectPlaneViews,
      allowContextualFarRelevant,
      coreRadiusMeters,
      nearbyRadiusMeters,
      extendedContextRadiusMeters
    });

    const summary = recomputeSummaryWithCaps({
      candidateCount: candidateIds.length,
      decisions: enforced,
      overallReasoning: zFull.data.summary.overallReasoning,
      maxCorePostsPerSpot,
      maxContextPostsPerSpot,
      maxTotalPostsPerSpot
    });

    const captionWarnings = buildCaptionStyleWarningsForDryReview(enforced).map((w) => ({
      postId: w.postId,
      patternsMatched: [...w.patternsMatched]
    }));
    const inspectionWarnings = buildCurationInspectionWarnings(enforced, enrichedByPostId);
    for (const w of inspectionWarnings) {
      const row = enforced.find((d) => d.postId === w.postId);
      if (!row) continue;
      row.curationWarnings = [...(row.curationWarnings || []), w.message];
    }

    const result: WikiSpotCuratorDryReviewJobResult = {
      spotId,
      spotName: loaded.spotName || zFull.data.spotName,
      maxPostsForSpot: maxTotalPostsPerSpot,
      summary,
      decisions: enforced,
      dryReviewHints: {
        captionStyleWarnings: captionWarnings,
        decisionInspectionWarnings: inspectionWarnings
      },
      usage: usageBase,
      curationOptions
    };

    wikiCurationAppendLog(
      jobId,
      `counts publish=${summary.recommendedPublishCount} (core ${summary.recommendedPublishCoreCount ?? 0} + ctx ${summary.recommendedPublishContextCount ?? 0}) skip=${summary.recommendedSkipCount} needs_review=${summary.recommendedNeedsReviewCount}`
    );
    wikiCurationCompleteJob(jobId, result);
  } catch (e) {
    wikiCurationFailJob(jobId, e instanceof Error ? e.message : String(e));
  }
}
