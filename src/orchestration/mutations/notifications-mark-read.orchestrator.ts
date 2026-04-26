import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { NotificationsService } from "../../services/surfaces/notifications.service.js";

export class NotificationsMarkReadOrchestrator {
  constructor(private readonly service: NotificationsService) {}

  async run(input: { viewerId: string; notificationIds: readonly string[] }) {
    const result = await this.service.markRead(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    const invalidation = {
      mutationType: "notification.markread" as const,
      invalidationTypes: ["route.notifications", "notifications.unread_count"],
      invalidatedKeys: []
    };
    void invalidateEntitiesForMutation({
      mutationType: "notification.markread",
      viewerId: input.viewerId
    }).catch(() => undefined);
    return {
      routeName: "notifications.markread.post" as const,
      updated: {
        requestedCount: result.requestedCount,
        markedCount: result.markedCount,
        unreadCount: result.unreadCount
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
