import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { NotificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { legacyNotificationPushPublisher } from "../notifications/legacy-notification-push.publisher.js";

/** Expo push + ticket handling; keeps route contracts unchanged (internal to NotificationsService). */
async function dispatchLegacyExpoPushAfterNotificationCreate(result: {
  notificationId: string | null;
  viewerId: string | null;
  notificationData: Record<string, unknown> | null | undefined;
  senderData: unknown;
}): Promise<void> {
  if (!result.notificationId || !result.viewerId || !result.notificationData) return;
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

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async loadNotificationsPage(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
    boundedList?: {
      maxNotificationDocs?: number;
      skipActorHydration?: boolean;
      syncUnreadFromViewerDoc?: boolean;
      strictPageHasMore?: boolean;
    };
  }) {
    const cursorPart = input.cursor ?? "start";
    const b = input.boundedList;
    const boundedKey = b
      ? `${b.maxNotificationDocs ?? ""}:${b.skipActorHydration ? "1" : "0"}:${b.syncUnreadFromViewerDoc ? "1" : "0"}:${b.strictPageHasMore ? "1" : "0"}`
      : "default";
    return dedupeInFlight(
      `notifications:list:${input.viewerId}:${cursorPart}:${input.limit}:${boundedKey}`,
      () =>
        withConcurrencyLimit("notifications-list-repo", 10, async () => {
          return this.repository.listNotifications(input);
        }),
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
            await dispatchLegacyExpoPushAfterNotificationCreate({
              notificationId: result.notificationId,
              viewerId: result.viewerId,
              notificationData: result.notificationData,
              senderData: result.senderData,
            });
          }
          const inv = invalidateEntitiesForMutation({
            mutationType: "notification.create",
            viewerId: result.viewerId,
          });
          if (process.env.VITEST === "true") {
            await inv;
          } else {
            void inv.catch(() => undefined);
          }
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

    void run().catch((error) => {
      console.warn("[notifications] notification mutation pipeline failed", {
        error: error instanceof Error ? error.message : String(error),
        type: input.type,
        actorId: input.actorId,
        targetId: input.targetId,
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
