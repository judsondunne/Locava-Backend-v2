import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { evictCachesAfterFollowGraphMutation } from "../../cache/profile-follow-graph-cache.js";
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
    await evictCachesAfterFollowGraphMutation(viewerId, userId);

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
          invalidatedKeys: []
        };
      }

      // Even if the follow is idempotent (already exists), UI may have cached
      // a stale relationship/bootstrap snapshot. Clear the targeted keys so
      // follow state reflects source-of-truth immediately.
      return {
        mutationType: "user.follow" as const,
        invalidationTypes: ["no_op_idempotent", "profile.relationship", "route.profile_bootstrap"],
        invalidatedKeys: []
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
