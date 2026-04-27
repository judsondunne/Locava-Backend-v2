import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { NotificationsRepository } from "../../repositories/surfaces/notifications.repository.js";

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

  createFromMutation(input: {
    type: "like" | "comment" | "follow" | "mention" | "chat" | "invite" | "collection_shared" | "group_invite" | "group_joined" | "contact_joined" | "place_follow" | "audio_like" | "system" | "achievement_leaderboard" | "leaderboard_rank_up" | "leaderboard_rank_down" | "leaderboard_passed" | "post_discovery";
    actorId: string;
    targetId: string;
    recipientUserId?: string | null;
    message?: string | null;
    commentId?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    // Keep mutation request paths non-blocking; creation runs asynchronously outside request context.
    scheduleBackgroundWork(async () => {
      void withConcurrencyLimit("notifications-create-hook", 12, async () => {
        const result = await this.repository.createFromMutation(input);
        if (result.created && result.viewerId) {
          await invalidateEntitiesForMutation({
            mutationType: "notification.create",
            viewerId: result.viewerId
          });
        }
      }).catch(() => undefined);
    });
  }
}
