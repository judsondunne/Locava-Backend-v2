import type { FastTargetedBucketRunResult } from "./wikidataFastTargetedSource.js";
import type { PlaceCandidate, PlaceCandidateBucketBreakdown } from "./types.js";

export function aggregateFastTargetedBucketBreakdown(
  bucketRuns: FastTargetedBucketRunResult[],
  acceptedCandidates: PlaceCandidate[],
): PlaceCandidateBucketBreakdown[] {
  return bucketRuns.map((run) => {
    const matched = acceptedCandidates.filter((candidate) => candidate.debug.sourceBucketIds?.includes(run.bucketId));
    return {
      bucketId: run.bucketId,
      label: run.label,
      fetched: run.fetched,
      accepted: matched.length,
      tierA: matched.filter((candidate) => candidate.candidateTier === "A").length,
      tierB: matched.filter((candidate) => candidate.candidateTier === "B").length,
      tierC: matched.filter((candidate) => candidate.candidateTier === "C").length,
      pipelineReady: matched.filter((candidate) => candidate.eligibleForMediaPipeline ?? candidate.pipelineReady).length,
      timedOut: run.timedOut,
      elapsedMs: run.elapsedMs,
    };
  });
}
