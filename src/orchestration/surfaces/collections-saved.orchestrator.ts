import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { CollectionsSavedResponse } from "../../contracts/surfaces/collections-saved.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { CollectionsService } from "../../services/surfaces/collections.service.js";

export class CollectionsSavedOrchestrator {
  constructor(private readonly service: CollectionsService) {}

  async run(input: { viewerId: string; cursor: string | null; limit: number }): Promise<CollectionsSavedResponse> {
    const cursorPart = input.cursor ?? "start";
    const cacheKey = buildCacheKey("list", ["collections-saved-v1", input.viewerId, cursorPart, String(input.limit)]);
    const cached = await globalCache.get<CollectionsSavedResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const page = await this.service.loadSavedPage(input);
    const response: CollectionsSavedResponse = {
      routeName: "collections.saved.get",
      requestKey: `${input.viewerId}:${cursorPart}:${input.limit}`,
      page: {
        cursorIn: input.cursor,
        limit: input.limit,
        count: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "saved_at_desc"
      },
      items: page.items,
      degraded: false,
      fallbacks: []
    };
    await setRouteCacheEntry(cacheKey, response, 8_000, [`route:collections.saved:${input.viewerId}`]);
    return response;
  }
}
