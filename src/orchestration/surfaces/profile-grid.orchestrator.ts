import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import type { ProfileGridResponse } from "../../contracts/surfaces/profile-grid.contract.js";
import { getRequestContext, recordCacheHit, recordCacheMiss, recordFallback } from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileGridOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: { viewerId: string; userId: string; cursor: string | null; limit: number }): Promise<ProfileGridResponse> {
    const { viewerId, userId, cursor, limit } = input;

    const pageCacheKey = buildCacheKey("list", ["profile-grid-page-v2", viewerId, userId, cursor ?? "start", limit]);
    const cached = await globalCache.get<ProfileGridResponse>(pageCacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    let fallbacks: string[] = [];
    let page;
    try {
      page = await this.service.loadGridPage(userId, cursor, limit);
    } catch {
      fallbacks = ["invalid_cursor_fallback_to_start"];
      recordFallback("invalid_cursor_fallback_to_start");
      page = await this.service.loadGridPage(userId, null, limit);
    }

    const response: ProfileGridResponse = {
      routeName: "profile.grid.get",
      profileUserId: userId,
      page: {
        cursorIn: cursor,
        limit,
        count: page.items.length,
        hasMore: page.nextCursor != null,
        nextCursor: page.nextCursor,
        sort: "updatedAtMs_desc"
      },
      items: page.items,
      degraded: fallbacks.length > 0,
      fallbacks,
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              timingsMs: {},
              counts: {
                grid: page.items.length,
                collections: 0,
                achievements: 0,
              },
              profilePicSource: null,
              dbOps: getRequestContext()
                ? {
                    reads: getRequestContext()!.dbOps.reads,
                    writes: getRequestContext()!.dbOps.writes,
                    queries: getRequestContext()!.dbOps.queries,
                  }
                : undefined,
            }
    };

    void globalCache.set(pageCacheKey, response, 10_000).catch(() => undefined);
    void registerRouteCacheKey(pageCacheKey, [
      `route:profile.grid:${userId}`,
      `route:profile.grid:${userId}:${viewerId}`,
    ]).catch(() => undefined);
    return response;
  }
}
