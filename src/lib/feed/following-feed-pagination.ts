/**
 * Following feed pagination helpers — keep exhaustion truthful when bounded Firestore
 * windows return fewer docs than the viewer still has in corpus.
 */

export const FOLLOWING_PER_CHUNK_LIMIT_MAX = 50;

export function computeFollowingFetchTarget(input: {
  requiredCandidateCount: number;
  limit: number;
  scanFloor: number;
  maxTarget: number;
}): number {
  const { requiredCandidateCount, limit, scanFloor, maxTarget } = input;
  return Math.min(
    Math.max(requiredCandidateCount + 16, limit + 8, scanFloor),
    maxTarget
  );
}

export function computeFollowingPerChunkLimit(input: {
  requiredCandidateCount: number;
  remainingTarget: number;
  maxPerChunk?: number;
}): number {
  const maxPerChunk = input.maxPerChunk ?? FOLLOWING_PER_CHUNK_LIMIT_MAX;
  return Math.max(
    4,
    Math.min(
      maxPerChunk,
      Math.max(input.requiredCandidateCount + 4, input.remainingTarget)
    )
  );
}

/**
 * True only when every chunk query returned fewer docs than requested (no more posts)
 * and we did not stop early due to read/query budgets.
 */
export function computeFollowingSourceExhausted(input: {
  hitReadBudget: boolean;
  hitQueryBudget: boolean;
  anyChunkReturnedFullLimit: boolean;
}): boolean {
  if (input.hitReadBudget || input.hitQueryBudget) return false;
  if (input.anyChunkReturnedFullLimit) return false;
  return true;
}

export function computeFollowingPageHasMore(input: {
  endExclusive: number;
  rankedLength: number;
  sourceExhausted: boolean;
}): boolean {
  return input.endExclusive < input.rankedLength || input.sourceExhausted === false;
}
