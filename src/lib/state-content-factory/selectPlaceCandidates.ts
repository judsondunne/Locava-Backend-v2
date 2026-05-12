import type { PlaceCandidate, PlaceCandidatePriorityQueue } from "../place-candidates/types.js";

const QUEUE_RANK: Record<PlaceCandidatePriorityQueue, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export function selectPlaceCandidates(input: {
  candidates: PlaceCandidate[];
  priorityQueues: PlaceCandidatePriorityQueue[];
  maxPlacesToProcess: number;
}): PlaceCandidate[] {
  const allowed = new Set(input.priorityQueues);
  const filtered = input.candidates.filter(
    (candidate) =>
      candidate.eligibleForMediaPipeline === true &&
      candidate.blocked !== true &&
      candidate.priorityQueue &&
      allowed.has(candidate.priorityQueue),
  );
  return filtered
    .sort((a, b) => {
      const queueDiff = QUEUE_RANK[a.priorityQueue!] - QUEUE_RANK[b.priorityQueue!];
      if (queueDiff !== 0) return queueDiff;
      const priorityDiff = (b.locavaPriorityScore ?? 0) - (a.locavaPriorityScore ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.locavaScore - a.locavaScore || a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(0, input.maxPlacesToProcess));
}
