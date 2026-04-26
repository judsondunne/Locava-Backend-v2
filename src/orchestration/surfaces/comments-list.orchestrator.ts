import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { CommentsListResponse } from "../../contracts/surfaces/comments-list.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { CommentsService } from "../../services/surfaces/comments.service.js";

export class CommentsListOrchestrator {
  constructor(private readonly service: CommentsService) {}

  async run(input: {
    viewerId: string;
    postId: string;
    cursor: string | null;
    limit: number;
  }): Promise<CommentsListResponse> {
    const cursorPart = input.cursor ?? "start";
    const cacheKey = buildCacheKey("list", ["comments-v1", input.viewerId, input.postId, cursorPart, String(input.limit)]);
    const cached = await globalCache.get<CommentsListResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const page = await this.service.loadCommentsPage(input);
    const requestKey = `${input.viewerId}:${input.postId}:${cursorPart}:${input.limit}`;
    const response: CommentsListResponse = {
      routeName: "comments.list.get",
      requestKey,
      page: {
        cursorIn: input.cursor,
        limit: input.limit,
        count: page.totalCount,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "created_desc"
      },
      items: page.items,
      degraded: false,
      fallbacks: []
    };
    await setRouteCacheEntry(cacheKey, response, 6_000, [
      `route:comments.list:${input.viewerId}:${input.postId}`,
      `route:comments.list:${input.viewerId}`
    ]);
    return response;
  }
}
