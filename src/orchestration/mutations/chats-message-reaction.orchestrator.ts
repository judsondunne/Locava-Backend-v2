import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyMiss } from "../../observability/request-context.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsMessageReactionOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: { viewerId: string; conversationId: string; messageId: string; emoji: string }) {
    recordIdempotencyMiss();
    const result = await this.service.setMessageReaction(input);
    const invalidation = await invalidateEntitiesForMutation({
      mutationType: "chat.reaction",
      viewerId: input.viewerId,
      conversationId: input.conversationId
    });
    return {
      routeName: "chats.messagereaction.post" as const,
      conversationId: input.conversationId,
      messageId: result.messageId,
      reactions: result.reactions,
      viewerReaction: result.viewerReaction,
      idempotency: { replayed: false },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
