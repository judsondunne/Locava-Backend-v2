import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsMarkUnreadOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: { viewerId: string; conversationId: string }) {
    const result = await this.service.markConversationUnread(input);
    if (result.idempotent) recordIdempotencyHit();
    else recordIdempotencyMiss();
    const invalidation = await invalidateEntitiesForMutation({
      mutationType: "chat.markunread",
      viewerId: input.viewerId
    });
    return {
      routeName: "chats.markunread.post" as const,
      conversationId: result.conversationId,
      unreadCount: result.unreadCount,
      idempotency: {
        replayed: result.idempotent
      },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
