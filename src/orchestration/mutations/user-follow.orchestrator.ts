import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { UserMutationService } from "../../services/mutations/user-mutation.service.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

const notificationsService = new NotificationsService(notificationsRepository);

export class UserFollowOrchestrator {
  constructor(private readonly service: UserMutationService) {}

  async run(input: { viewerId: string; userId: string }) {
    const { viewerId, userId } = input;
    const mutation = await this.service.followUser(viewerId, userId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    const invalidation = mutation.changed
      ? await invalidateEntitiesForMutation({
          mutationType: "user.follow",
          userId,
          viewerId
        })
      : {
          mutationType: "user.follow" as const,
          invalidationTypes: ["no_op_idempotent"],
          invalidatedKeys: []
        };
    if (mutation.changed) {
      notificationsService.createFromMutation({
        type: "follow",
        actorId: viewerId,
        targetId: userId
      });
    }
    return {
      routeName: "users.follow.post" as const,
      userId: mutation.userId,
      following: mutation.following,
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
