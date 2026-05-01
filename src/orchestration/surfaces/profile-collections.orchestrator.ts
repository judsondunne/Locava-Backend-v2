import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import type { ProfileCollectionsResponse } from "../../contracts/surfaces/profile-collections.contract.js";
import {
  getRequestContext,
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileCollectionsOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: {
    viewerId: string;
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<ProfileCollectionsResponse> {
    const { viewerId, userId, cursor, limit } = input;
    const cacheKey = buildCacheKey("list", ["profile-collections-page-v1", viewerId, userId, cursor ?? "start", limit]);
    const cached = await globalCache.get<ProfileCollectionsResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    let page;
    try {
      page = await this.service.loadCollections({ viewerId, userId, cursor, limit });
    } catch {
      recordFallback("profile_collections_invalid_cursor_fallback_to_start");
      page = await this.service.loadCollections({ viewerId, userId, cursor: null, limit });
    }
    const ctx = getRequestContext();
    const response: ProfileCollectionsResponse = {
      routeName: "profile.collections.get",
      profileUserId: userId,
      page: {
        cursorIn: cursor,
        limit,
        count: page.items.length,
        hasMore: page.nextCursor != null,
        nextCursor: page.nextCursor,
        sort: "updatedAtMs_desc",
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
                collections: page.items.length,
                achievements: 0,
              },
              profilePicSource: null,
              emptyReasons: {
                collections: page.emptyReason ?? null,
                achievements: null,
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
      `route:profile.collections:${userId}`,
      `route:profile.collections:${userId}:${viewerId}`,
    ]).catch(() => undefined);
    return response;
  }
}
