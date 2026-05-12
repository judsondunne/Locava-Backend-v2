import type { PlaceCandidate, PlaceCandidateTier } from "./types.js";

export function totalsByTier(candidates: PlaceCandidate[]): Record<PlaceCandidateTier, number> {
  return candidates.reduce(
    (acc, candidate) => {
      acc[candidate.candidateTier] += 1;
      return acc;
    },
    { A: 0, B: 0, C: 0, REJECTED: 0 },
  );
}

export function totalsByPrimaryCategory(candidates: PlaceCandidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const candidate of candidates) {
    const key = candidate.primaryCategory || "other";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
