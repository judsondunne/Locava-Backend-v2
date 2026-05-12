import { evaluatePlaceCandidateRouting } from "./placeCandidatePriorityQueue.js";
import type { PlaceCandidate } from "./types.js";

export const PIPELINE_PRIORITY_THRESHOLD = 45;
export const PIPELINE_STRONG_B_THRESHOLD = 58;

export function evaluatePipelineReady(candidate: PlaceCandidate) {
  const routing = evaluatePlaceCandidateRouting(candidate);
  return {
    pipelineReady: routing.pipelineReady,
    pipelineReadyReasons: routing.pipelineReadyReasons,
    pipelineBlockReasons: routing.pipelineBlockReasons,
    locavaPriorityScore: routing.locavaPriorityScore,
    priorityReasons: routing.priorityReasons,
    eligibleForMediaPipeline: routing.eligibleForMediaPipeline,
    blocked: routing.blocked,
    blockReasons: routing.blockReasons,
    priorityQueue: routing.priorityQueue,
    recommendedAction: routing.recommendedAction,
  };
}
