import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { evictCachesAfterFollowGraphMutation } from "../../cache/profile-follow-graph-cache.js";
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

    // Evict relationship/bootstrap caches immediately to avoid stale UI state after unfollow.
    await evictCachesAfterFollowGraphMutation(viewerId, userId);

    const invalidation =
      mutation.changed && process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "user.unfollow",
            userId,
            viewerId
          })
        : mutation.changed
          ? {
              mutationType: "user.unfollow" as const,
              invalidationTypes: [
                "user.summary",
                "user.firestore_doc",
                "author_post.viewer_state",
                "profile.relationship",
                "route.profile_bootstrap"
              ],
              invalidatedKeys: []
            }
          : {
              mutationType: "user.unfollow" as const,
              invalidationTypes: ["no_op_idempotent", "profile.relationship", "route.profile_bootstrap"],
              invalidatedKeys: []
            };
    if (mutation.changed && process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "user.unfollow",
        userId,
        viewerId
      }).catch(() => undefined);
    }
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
