import type { PlaceCandidate, PlaceCandidatePriorityQueue, PlaceCandidateTier } from "./types.js";

const TIER_RANK: Record<PlaceCandidateTier, number> = {
  A: 0,
  B: 1,
  C: 2,
  REJECTED: 3,
};

const PRIORITY_QUEUE_RANK: Record<PlaceCandidatePriorityQueue, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export function comparePlaceCandidates(a: PlaceCandidate, b: PlaceCandidate): number {
  const queueDiff =
    PRIORITY_QUEUE_RANK[a.priorityQueue ?? "P3"] - PRIORITY_QUEUE_RANK[b.priorityQueue ?? "P3"];
  if (queueDiff !== 0) return queueDiff;
  const priorityDiff = (b.locavaPriorityScore ?? b.locavaScore) - (a.locavaPriorityScore ?? a.locavaScore);
  if (priorityDiff !== 0) return priorityDiff;
  const tierDiff = TIER_RANK[a.candidateTier] - TIER_RANK[b.candidateTier];
  if (tierDiff !== 0) return tierDiff;
  const scoreDiff = b.locavaScore - a.locavaScore;
  if (scoreDiff !== 0) return scoreDiff;
  return a.name.localeCompare(b.name);
}

export function sortPlaceCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates].sort(comparePlaceCandidates);
}

export function sortPlaceCandidatesByScore(candidates: PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates].sort((a, b) => b.locavaScore - a.locavaScore || a.name.localeCompare(b.name));
}
