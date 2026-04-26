import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { NotificationsService } from "../../services/surfaces/notifications.service.js";

export class NotificationsMarkAllReadOrchestrator {
  constructor(private readonly service: NotificationsService) {}

  async run(input: { viewerId: string }) {
    const result = await this.service.markAllRead(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    const invalidation = await invalidateEntitiesForMutation({
      mutationType: "notification.markallread",
      viewerId: input.viewerId
    });
    return {
      routeName: "notifications.markallread.post" as const,
      updated: {
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
