/**
 * Defensive merge for follower/following counters when hydrating profile state from multiple sources
 * (bootstrap, session, cached profile). Prevents a transient missing field or literal `0` from overwriting
 * a previously verified positive count.
 */
export function mergeProfileSocialCount(
  previous: number | null | undefined,
  incoming: number | null | undefined
): number {
  const prev = previous != null && Number.isFinite(previous) ? Math.max(0, Math.floor(Number(previous))) : null;
  const inc = incoming != null && Number.isFinite(incoming) ? Math.max(0, Math.floor(Number(incoming))) : null;
  if (inc != null && inc > 0) return inc;
  if (prev != null && prev > 0 && (inc === null || inc === 0)) return prev;
  if (inc != null) return inc;
  return prev ?? 0;
}
