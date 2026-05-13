/**
 * Read denormalized like total from a Firestore post document.
 * Uses a strict first-defined-wins chain on numeric fields only — never Math.max across
 * competing keys (stale high `stats.*` or legacy mirrors must not inflate counts).
 */
export function readPostLikeCountFromFirestoreData(data: Record<string, unknown>): number {
  const candidates: unknown[] = [
    data.likesCount,
    data.likeCount,
    data.numLikes,
  ];
  const stats = data.stats;
  if (stats && typeof stats === "object") {
    const s = stats as Record<string, unknown>;
    candidates.push(s.likesCount, s.likeCount);
  }
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) {
      return Math.max(0, Math.floor(v));
    }
  }
  return 0;
}
