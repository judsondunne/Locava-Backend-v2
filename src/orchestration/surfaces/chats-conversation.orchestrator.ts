import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ChatsConversationResponse } from "../../contracts/surfaces/chats-conversation.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsConversationOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: { viewerId: string; conversationId: string }): Promise<ChatsConversationResponse> {
    const cacheKey = buildCacheKey("entity", ["chats-conversation-v1", input.viewerId, input.conversationId]);
    const cached = await globalCache.get<ChatsConversationResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const conversation = await this.service.loadConversation(input);
    const response: ChatsConversationResponse = {
      routeName: "chats.conversation.get",
      requestKey: `${input.viewerId}:${input.conversationId}`,
      conversation
    };
    await setRouteCacheEntry(cacheKey, response, 5_000, [
      `route:chats.conversation:${input.viewerId}:${input.conversationId}`,
      `route:chats.conversation:${input.viewerId}`
    ]);
    return response;
  }
}
