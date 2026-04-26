import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import type { ProfileGridResponse } from "../../contracts/surfaces/profile-grid.contract.js";
import { recordCacheHit, recordCacheMiss, recordFallback } from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileGridOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: { userId: string; cursor: string | null; limit: number }): Promise<ProfileGridResponse> {
    const { userId, cursor, limit } = input;

    const pageCacheKey = buildCacheKey("list", ["profile-grid-page-v1", userId, cursor ?? "start", limit]);
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
      fallbacks
    };

    await globalCache.set(pageCacheKey, response, 10_000);
    return response;
  }
}
