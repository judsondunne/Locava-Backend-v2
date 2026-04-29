import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
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
    // Always evict the viewer<->profile relationship + bootstrap caches immediately.
    // Otherwise the app can re-fetch cached `profile.bootstrap` right after a successful follow/unfollow
    // and show stale relationship state until the user navigates away/back.
    const relationshipKey = buildCacheKey("entity", ["profile-relationship-v1", viewerId, userId]);
    const bootstrapKeys = [6, 12, 18].map((previewLimit) =>
      buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewerId, userId, String(previewLimit)])
    );
    await Promise.all([globalCache.del(relationshipKey), ...bootstrapKeys.map((key) => globalCache.del(key))]);

    const invalidation = await (async () => {
      if (mutation.changed && process.env.VITEST === "true") {
        return invalidateEntitiesForMutation({
          mutationType: "user.follow",
          userId,
          viewerId
        });
      }
      if (mutation.changed) {
        return {
          mutationType: "user.follow" as const,
          invalidationTypes: [
            "user.summary",
            "user.firestore_doc",
            "author_post.viewer_state",
            "profile.relationship",
            "route.profile_bootstrap"
          ],
          invalidatedKeys: [relationshipKey, ...bootstrapKeys]
        };
      }

      // Even if the follow is idempotent (already exists), UI may have cached
      // a stale relationship/bootstrap snapshot. Clear the targeted keys so
      // follow state reflects source-of-truth immediately.
      return {
        mutationType: "user.follow" as const,
        invalidationTypes: ["no_op_idempotent", "profile.relationship", "route.profile_bootstrap"],
        invalidatedKeys: [relationshipKey, ...bootstrapKeys]
      };
    })();
    if (mutation.changed && process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "user.follow",
        userId,
        viewerId
      }).catch(() => undefined);
    }
    if (mutation.changed) {
      void notificationsService.createFromMutation({
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
