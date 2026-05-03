import { entityCacheKeys } from "./entity-cache.js";
import { globalCache } from "./global-cache.js";
import { buildCacheKey } from "./types.js";

/** Canonical bootstrap cache segment — must match `profileBootstrapCacheKey` + follow/unfollow eviction. */
export const PROFILE_BOOTSTRAP_CACHE_SEGMENT = "profile-bootstrap-v2";

/** Older deployments may still hold entries under v1; evict both during follow/unfollow + entity invalidation. */
const LEGACY_PROFILE_BOOTSTRAP_CACHE_SEGMENT = "profile-bootstrap-v1";

const PREVIEW_LIMITS = [6, 12, 18] as const;

export function profileBootstrapCacheKey(viewerId: string, profileUserId: string, gridLimit: number): string {
  return buildCacheKey("bootstrap", [PROFILE_BOOTSTRAP_CACHE_SEGMENT, viewerId, profileUserId, gridLimit]);
}

/** All bootstrap cache keys for both cache-label revisions (v1 + legacy v2). */
export function allProfileBootstrapCacheKeys(viewerId: string, profileUserId: string): string[] {
  const keys: string[] = [];
  for (const segment of [PROFILE_BOOTSTRAP_CACHE_SEGMENT, LEGACY_PROFILE_BOOTSTRAP_CACHE_SEGMENT]) {
    for (const lim of PREVIEW_LIMITS) {
      keys.push(buildCacheKey("bootstrap", [segment, viewerId, profileUserId, lim]));
    }
  }
  return keys;
}

/**
 * Eager invalidation after follow/unfollow (and mirrored by `invalidateEntitiesForMutation` for user.follow/unfollow).
 * Clears shaped bootstrap snapshots, profile header entity cache, and user summary / follow-count slices for both users.
 */
export async function evictCachesAfterFollowGraphMutation(viewerId: string, targetUserId: string): Promise<void> {
  const keys = [
    ...allProfileBootstrapCacheKeys(viewerId, targetUserId),
    ...allProfileBootstrapCacheKeys(viewerId, viewerId),
    buildCacheKey("entity", ["profile-relationship-v1", viewerId, targetUserId]),
    buildCacheKey("entity", ["profile-header-v1", viewerId]),
    buildCacheKey("entity", ["profile-header-v1", targetUserId]),
    entityCacheKeys.profileHeaderCanonical(viewerId),
    entityCacheKeys.profileHeaderCanonical(targetUserId),
    entityCacheKeys.userSummary(viewerId),
    entityCacheKeys.userSummary(targetUserId),
    entityCacheKeys.userFirestoreDoc(viewerId),
    entityCacheKeys.userFirestoreDoc(targetUserId),
    entityCacheKeys.userFollowCounts(viewerId),
    entityCacheKeys.userFollowCounts(targetUserId),
  ];
  await Promise.all(keys.map((k) => globalCache.del(k)));
}
