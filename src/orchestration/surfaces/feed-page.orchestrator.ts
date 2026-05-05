import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { FeedPageResponse } from "../../contracts/surfaces/feed-page.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { wireFeedCandidateToPostCardSummary } from "../../lib/feed/feed-post-card-wire.js";

export class FeedPageOrchestrator {
  constructor(private readonly service: FeedService) {}

  async run(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
    tab: "explore" | "following";
    lat?: number;
    lng?: number;
    radiusKm?: number;
  }): Promise<FeedPageResponse> {
    const { viewerId, cursor, limit, tab, lat, lng, radiusKm } = input;
    const cursorPart = cursor ?? "start";
    const cacheKey = buildCacheKey("list", [
      "feed-page-v1",
      viewerId,
      tab,
      String(lat ?? "_"),
      String(lng ?? "_"),
      String(radiusKm ?? "_"),
      cursorPart,
      String(limit)
    ]);
    const cached = await globalCache.get<FeedPageResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const page = await this.service.loadFeedPage(viewerId, cursor, limit, { tab, lat, lng, radiusKm });
    const requestKey = `${viewerId}:${cursorPart}:${limit}`;
    const response: FeedPageResponse = {
      routeName: "feed.page.get",
      requestKey,
      page: {
        cursorIn: cursor,
        limit,
        count: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "ranked_session"
      },
      items: page.items.map((item, idx) =>
        wireFeedCandidateToPostCardSummary(item, `rank-${viewerId.slice(0, 6)}-p-${cursorPart}-${idx + 1}`, {
          route: "feed.page.get"
        })
      ) as FeedPageResponse["items"],
      degraded: false,
      fallbacks: []
    };

    void globalCache.set(cacheKey, response, 6_000);
    return response;
  }
}
