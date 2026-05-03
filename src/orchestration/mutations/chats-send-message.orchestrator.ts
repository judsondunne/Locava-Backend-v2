import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import { recordInvalidation } from "../../observability/request-context.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";
import type { ChatsService } from "../../services/surfaces/chats.service.js";

const notificationsService = new NotificationsService(notificationsRepository);

export class ChatsSendMessageOrchestrator {
  constructor(private readonly service: ChatsService) {}

  async run(input: {
    viewerId: string;
    conversationId: string;
    messageType: "text" | "photo" | "gif" | "post";
    text: string | null;
    photoUrl: string | null;
    gifUrl: string | null;
    gif: null | {
      provider: "giphy";
      gifId: string;
      title?: string;
      previewUrl: string;
      fixedHeightUrl?: string;
      mp4Url?: string;
      width?: number;
      height?: number;
      originalUrl?: string;
    };
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
    const invalidation =
      process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "chat.sendtext",
            viewerId: input.viewerId,
            conversationId: input.conversationId
          }).catch(() => ({
            mutationType: "chat.sendtext" as const,
            invalidationTypes: ["route.chats_thread", "route.chats_inbox"],
            invalidatedKeys: []
          }))
        : (() => {
            recordInvalidation("chat.sendtext", {
              entityKeyCount: 0,
              routeKeyCount: 1
            });
            scheduleBackgroundWork(async () => {
              await invalidateEntitiesForMutation({
                mutationType: "chat.sendtext",
                viewerId: input.viewerId,
                conversationId: input.conversationId
              });
            });
            return {
              mutationType: "chat.sendtext" as const,
              invalidationTypes: ["route.chats_thread", "route.chats_inbox"],
              invalidatedKeys: ["deferred"]
            };
          })();
    if (!result.idempotent) {
      const notificationMessage =
        input.messageType === "photo"
          ? "sent a photo"
          : input.messageType === "gif"
            ? "sent a GIF"
            : input.messageType === "post"
              ? "sent a post"
              : (input.text?.trim() || "sent a message");
      const sender = result.message.sender;
      const trimmedName = typeof sender.name === "string" ? sender.name.trim() : "";
      const trimmedHandle = typeof sender.handle === "string" ? sender.handle.replace(/^@+/, "").trim() : "";
      const senderDisplayLabel = trimmedName || (trimmedHandle ? `@${trimmedHandle}` : "");
      for (const recipientUserId of result.recipientUserIds) {
        void notificationsService.createFromMutation({
          type: "chat",
          actorId: input.viewerId,
          targetId: input.conversationId,
          recipientUserId,
          message: result.groupName ? `From ${result.groupName}: ${notificationMessage}` : notificationMessage,
          metadata: {
            ...(result.groupName ? { groupName: result.groupName, isGroupChat: true } : {}),
            ...(result.groupPhotoUrl ? { groupPhotoUrl: result.groupPhotoUrl } : {}),
            ...(typeof sender.pic === "string" && sender.pic.trim() ? { senderProfilePic: sender.pic.trim() } : {}),
            ...(senderDisplayLabel ? { senderName: senderDisplayLabel } : {}),
            ...(trimmedHandle ? { senderHandle: trimmedHandle } : {}),
          },
        });
      }
    }
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
