import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { NotificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { legacyNotificationPushPublisher } from "../notifications/legacy-notification-push.publisher.js";

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async loadNotificationsPage(input: { viewerId: string; cursor: string | null; limit: number }) {
    const cursorPart = input.cursor ?? "start";
    return dedupeInFlight(`notifications:list:${input.viewerId}:${cursorPart}:${input.limit}`, () =>
      withConcurrencyLimit("notifications-list-repo", 10, async () => {
        // Repository serves denormalized actor/target fields from the notification row itself.
        return this.repository.listNotifications(input);
      })
    );
  }

  async markRead(input: { viewerId: string; notificationIds: readonly string[] }) {
    const sortedIds = [...input.notificationIds].sort().join(",");
    return dedupeInFlight(`notifications:mark-read:${input.viewerId}:${sortedIds}`, () =>
      withConcurrencyLimit("notifications-mark-read", 8, () =>
        withMutationLock(`notifications-mark-read:${input.viewerId}`, () => this.repository.markRead(input))
      )
    );
  }

  async markAllRead(input: { viewerId: string }) {
    return dedupeInFlight(`notifications:mark-all-read:${input.viewerId}`, () =>
      withConcurrencyLimit("notifications-mark-all-read", 8, () =>
        withMutationLock(`notifications-mark-read:${input.viewerId}`, () => this.repository.markAllRead(input))
      )
    );
  }

  async createFromMutation(input: {
    type: "like" | "comment" | "follow" | "mention" | "chat" | "invite" | "collection_shared" | "group_invite" | "group_joined" | "group_faceoff" | "contact_joined" | "place_follow" | "audio_like" | "system" | "achievement_leaderboard" | "leaderboard_rank_up" | "leaderboard_rank_down" | "leaderboard_passed" | "post" | "post_discovery";
    actorId: string;
    targetId: string;
    recipientUserId?: string | null;
    message?: string | null;
    commentId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const run = async (): Promise<void> => {
      await withConcurrencyLimit("notifications-create-hook", 12, async () => {
        const result = await this.repository.createFromMutation(input);
        if (result.created && result.viewerId) {
          if (result.notificationId && result.notificationData) {
            const pushResult = await legacyNotificationPushPublisher.sendToRecipient({
              notificationId: result.notificationId,
              recipientUserId: result.viewerId,
              notificationData: result.notificationData as never,
              senderData: (result.senderData as never) ?? null,
            });
            if (!pushResult.success && !pushResult.skippedNoExpoToken) {
              console.warn("[notifications] push delivery failed", {
                notificationId: result.notificationId,
                recipientUserId: result.viewerId,
                error: pushResult.error ?? "unknown_push_error",
              });
            }
          }
          await invalidateEntitiesForMutation({
            mutationType: "notification.create",
            viewerId: result.viewerId
          });
        }
      });
    };

    if (process.env.VITEST === "true") {
      await run().catch((error) => {
        console.warn("[notifications] synchronous notification creation failed", {
          error: error instanceof Error ? error.message : String(error),
          type: input.type,
          actorId: input.actorId,
          targetId: input.targetId,
        });
      });
      return;
    }

    scheduleBackgroundWork(async () => {
      await run().catch((error) => {
        console.warn("[notifications] background notification creation failed", {
          error: error instanceof Error ? error.message : String(error),
          type: input.type,
          actorId: input.actorId,
          targetId: input.targetId,
        });
      });
    });
  }

  previewPush(input: {
    senderUserId: string;
    type: string;
    message: string;
    postId?: string | null;
    commentId?: string | null;
    chatId?: string | null;
    collectionId?: string | null;
    placeId?: string | null;
    audioId?: string | null;
    targetUserId?: string | null;
    profileUserId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return legacyNotificationPushPublisher.preview(input, {
      senderName: typeof input.metadata?.senderName === "string" ? input.metadata.senderName : undefined,
      senderProfilePic: typeof input.metadata?.senderProfilePic === "string" ? input.metadata.senderProfilePic : null,
      senderUsername: typeof input.metadata?.senderUsername === "string" ? input.metadata.senderUsername : undefined,
    });
  }
}
