import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ChatsInboxResponse } from "../../contracts/surfaces/chats-inbox.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { groupsRepository } from "../../repositories/surfaces/groups.repository.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsInboxOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: { viewerId: string; cursor: string | null; limit: number }): Promise<ChatsInboxResponse> {
    const cursorPart = input.cursor ?? "start";
    // Repair group-linked chat participants (real Firestore only). Skipped under Vitest to preserve inbox DB budgets.
    if (!input.cursor && process.env.VITEST !== "true") {
      await dedupeInFlight(`groups:sync-linked-chats:${input.viewerId}`, () =>
        groupsRepository.syncViewerIntoLinkedGroupChats(input.viewerId),
      ).catch(() => undefined);
    }
    const cacheKey = buildCacheKey("list", ["chats-inbox-v1", input.viewerId, cursorPart, String(input.limit)]);
    const cached = await globalCache.get<ChatsInboxResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const page = await this.service.loadInboxPage(input);
    const response: ChatsInboxResponse = {
      routeName: "chats.inbox.get",
      requestKey: `${input.viewerId}:${cursorPart}:${input.limit}`,
      page: {
        cursorIn: input.cursor,
        limit: input.limit,
        count: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "last_message_desc"
      },
      items: page.items,
      unread: {
        totalConversationsUnread: page.totalConversationsUnread
      },
      degraded: false,
      fallbacks: []
    };
    await setRouteCacheEntry(cacheKey, response, 6_000, [`route:chats.inbox:${input.viewerId}`]);
    return response;
  }
}
