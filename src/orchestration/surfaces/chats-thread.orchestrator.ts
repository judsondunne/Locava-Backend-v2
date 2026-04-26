import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ChatsThreadResponse } from "../../contracts/surfaces/chats-thread.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsThreadOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: { viewerId: string; conversationId: string; cursor: string | null; limit: number }): Promise<ChatsThreadResponse> {
    const cursorPart = input.cursor ?? "start";
    const cacheKey = buildCacheKey("list", ["chats-thread-v1", input.viewerId, input.conversationId, cursorPart, String(input.limit)]);
    const cached = await globalCache.get<ChatsThreadResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const page = await this.service.loadThreadPage(input);
    const response: ChatsThreadResponse = {
      requestKey: `${input.viewerId}:${input.conversationId}:${cursorPart}:${input.limit}`,
      page: {
        cursorIn: input.cursor ?? "start",
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        order: "created_desc"
      },
      conversationId: input.conversationId,
      items: page.items
    };
    await setRouteCacheEntry(cacheKey, response, 5_000, [
      `route:chats.thread:${input.viewerId}:${input.conversationId}`,
      `route:chats.thread:${input.viewerId}`
    ]);
    return response;
  }
}
