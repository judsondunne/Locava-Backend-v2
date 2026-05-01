import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import type { ProfileAchievementsResponse } from "../../contracts/surfaces/profile-achievements.contract.js";
import {
  getRequestContext,
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileAchievementsOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: {
    viewerId: string;
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<ProfileAchievementsResponse> {
    const { viewerId, userId, cursor, limit } = input;
    const cacheKey = buildCacheKey("list", ["profile-achievements-page-v1", viewerId, userId, cursor ?? "start", limit]);
    const cached = await globalCache.get<ProfileAchievementsResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    let page;
    try {
      page = await this.service.loadAchievements({ userId, cursor, limit });
    } catch {
      recordFallback("profile_achievements_invalid_cursor_fallback_to_start");
      page = await this.service.loadAchievements({ userId, cursor: null, limit });
    }
    const ctx = getRequestContext();
    const response: ProfileAchievementsResponse = {
      routeName: "profile.achievements.get",
      profileUserId: userId,
      page: {
        cursorIn: cursor,
        limit,
        count: page.items.length,
        hasMore: page.nextCursor != null,
        nextCursor: page.nextCursor,
        sort: "earnedAtMs_desc",
      },
      items: page.items,
      degraded: Boolean(ctx?.fallbacks.length),
      fallbacks: ctx?.fallbacks.slice() ?? [],
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              timingsMs: {},
              counts: {
                grid: 0,
                collections: 0,
                achievements: page.items.length,
              },
              profilePicSource: null,
              emptyReasons: {
                collections: null,
                achievements: page.emptyReason ?? null,
              },
              dbOps: ctx
                ? {
                    reads: ctx.dbOps.reads,
                    writes: ctx.dbOps.writes,
                    queries: ctx.dbOps.queries,
                  }
                : undefined,
            },
    };
    void globalCache.set(cacheKey, response, 10_000).catch(() => undefined);
    void registerRouteCacheKey(cacheKey, [
      `route:profile.achievements:${userId}`,
      `route:profile.achievements:${userId}:${viewerId}`,
    ]).catch(() => undefined);
    return response;
  }
}
