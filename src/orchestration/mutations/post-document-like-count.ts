/**
 * Posts may store like totals under several denormalized keys (`likeCount`,
 * `likesCount`, nested `stats.*`). Prefer the **maximum** finite non-negative
 * value so a stale/low `likeCount` cannot shadow a correct `likesCount`.
 */
export function readPostLikeCountFromFirestoreData(data: Record<string, unknown>): number {
  const nums: number[] = [];
  const push = (raw: unknown): void => {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      nums.push(Math.max(0, Math.floor(raw)));
    }
  };
  push(data.likeCount);
  push(data.likesCount);
  push(data.numLikes);
  const stats = data.stats;
  if (stats && typeof stats === "object") {
    const s = stats as Record<string, unknown>;
    push(s.likeCount);
    push(s.likesCount);
    push(s.likes);
  }
  return nums.length > 0 ? Math.max(...nums) : 0;
}
