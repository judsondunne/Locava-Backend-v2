import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { UserMutationService } from "../../services/mutations/user-mutation.service.js";

export class UserUnfollowOrchestrator {
  constructor(private readonly service: UserMutationService) {}

  async run(input: { viewerId: string; userId: string }) {
    const { viewerId, userId } = input;
    const mutation = await this.service.unfollowUser(viewerId, userId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    const invalidation = mutation.changed
      ? await invalidateEntitiesForMutation({
          mutationType: "user.unfollow",
          userId,
          viewerId
        })
      : {
          mutationType: "user.unfollow" as const,
          invalidationTypes: ["no_op_idempotent"],
          invalidatedKeys: []
        };
    return {
      routeName: "users.unfollow.post" as const,
      userId: mutation.userId,
      following: mutation.following,
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
