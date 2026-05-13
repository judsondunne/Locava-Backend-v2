import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";

const FOLLOWING_FEED_GEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generationKey(viewerId: string): string {
  return buildCacheKey("entity", ["following-feed-cache-gen-v1", viewerId]);
}

export async function getFollowingFeedCacheGeneration(viewerId: string): Promise<number> {
  const trimmed = viewerId.trim();
  if (!trimmed || trimmed === "anonymous") return 0;
  const v = await globalCache.get<number>(generationKey(trimmed));
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** Bump when follow graph changes so following feed candidate/bootstrap caches miss immediately. */
export async function bumpFollowingFeedCacheGeneration(viewerId: string): Promise<number> {
  const trimmed = viewerId.trim();
  if (!trimmed || trimmed === "anonymous") return 0;
  const key = generationKey(trimmed);
  const next = (await getFollowingFeedCacheGeneration(trimmed)) + 1;
  await globalCache.set(key, next, FOLLOWING_FEED_GEN_TTL_MS);
  return next;
}
