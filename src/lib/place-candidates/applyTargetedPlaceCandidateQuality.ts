import { classifyPlaceCandidateTier } from "./classifyPlaceCandidateTier.js";
import { dedupeReasonStrings } from "./dedupeReasonStrings.js";
import { detectActualNegativeSignals, hasActualCemeterySignal } from "./placeCandidateActualSignals.js";
import { evaluatePlaceCandidateRouting } from "./placeCandidatePriorityQueue.js";
import type { PlaceCandidate } from "./types.js";

export function applyTargetedPlaceCandidateQuality(candidate: PlaceCandidate): PlaceCandidate {
  const suppressed: string[] = [];
  const actualNegative = detectActualNegativeSignals(candidate);
  let categories = [...candidate.categories];
  let primaryCategory = candidate.primaryCategory;
  const bucketHintsApplied = Boolean(candidate.debug.bucketHintsApplied);

  if (hasActualCemeterySignal(candidate)) {
    suppressed.push("actual_type_cemetery");
    categories = categories.filter((category) => category !== "quarry");
    if (primaryCategory === "quarry") primaryCategory = "cemetery";
    if (!categories.includes("cemetery")) categories.push("cemetery");
  }

  const adjusted: PlaceCandidate = {
    ...candidate,
    categories,
    primaryCategory,
    signals: {
      ...candidate.signals,
      isTooGeneric: candidate.signals.isTooGeneric || actualNegative.includes("administrative"),
    },
    debug: {
      ...candidate.debug,
      bucketHintsApplied,
      bucketHintSuppressedReasons: suppressed,
      actualLabelNegativeSignals: actualNegative,
    },
  };

  const tiered = classifyPlaceCandidateTier(adjusted);
  const withTier = {
    ...adjusted,
    candidateTier: tiered.tier,
    debug: {
      ...adjusted.debug,
      tierReasons: dedupeReasonStrings(tiered.tierReasons),
    },
  };
  const routing = evaluatePlaceCandidateRouting(withTier);
  return {
    ...withTier,
    locavaPriorityScore: routing.locavaPriorityScore,
    eligibleForMediaPipeline: routing.eligibleForMediaPipeline,
    blocked: routing.blocked,
    blockReasons: routing.blockReasons,
    priorityQueue: routing.priorityQueue,
    priorityReasons: routing.priorityReasons,
    recommendedAction: routing.recommendedAction,
    pipelineReady: routing.pipelineReady,
    pipelineReadyReasons: routing.pipelineReadyReasons,
    pipelineBlockReasons: routing.pipelineBlockReasons,
    debug: {
      ...withTier.debug,
      scoreReasons: dedupeReasonStrings([...withTier.debug.scoreReasons, ...routing.priorityReasons]),
    },
  };
}
