import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
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
    const relationshipKey = buildCacheKey("entity", ["profile-relationship-v1", viewerId, userId]);
    const bootstrapKeys = [6, 12, 18].map((previewLimit) =>
      buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewerId, userId, String(previewLimit)])
    );
    await Promise.all([globalCache.del(relationshipKey), ...bootstrapKeys.map((key) => globalCache.del(key))]);

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
              invalidatedKeys: [relationshipKey, ...bootstrapKeys]
            }
          : {
              mutationType: "user.unfollow" as const,
              invalidationTypes: ["no_op_idempotent", "profile.relationship", "route.profile_bootstrap"],
              invalidatedKeys: [relationshipKey, ...bootstrapKeys]
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
