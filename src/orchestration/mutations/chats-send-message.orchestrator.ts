import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

export class ChatsSendMessageOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: {
    viewerId: string;
    conversationId: string;
    messageType: "text" | "photo" | "gif" | "post";
    text: string | null;
    photoUrl: string | null;
    gifUrl: string | null;
    postId: string | null;
    replyingToMessageId: string | null;
    clientMessageId: string | null;
  }) {
    const result = await this.service.sendMessage(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    const invalidation = {
      mutationType: "chat.sendtext" as const,
      invalidationTypes: ["route.chats_thread", "route.chats_inbox"],
      invalidatedKeys: []
    };
    void invalidateEntitiesForMutation({
      mutationType: "chat.sendtext",
      viewerId: input.viewerId,
      conversationId: input.conversationId
    }).catch(() => undefined);
    return {
      routeName: "chats.sendtext.post" as const,
      message: {
        ...result.message,
        ownedByViewer: result.message.senderId === input.viewerId,
        seenByViewer: result.message.seenBy.includes(input.viewerId)
      },
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
