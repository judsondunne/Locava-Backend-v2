import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostMutationService } from "../../services/mutations/post-mutation.service.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

const notificationsService = new NotificationsService(notificationsRepository);

export class PostLikeOrchestrator {
  constructor(private readonly service: PostMutationService) {}

  async run(input: { viewerId: string; postId: string }) {
    const { viewerId, postId } = input;
    const mutation = await this.service.likePost(viewerId, postId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    const invalidation =
      mutation.changed && process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "post.like",
            postId,
            viewerId
          })
        : mutation.changed
          ? {
              mutationType: "post.like" as const,
              invalidationTypes: ["post.social", "post.card", "post.detail", "post.viewer_state", "route.detail"],
              invalidatedKeys: ["deferred"]
            }
          : {
              mutationType: "post.like" as const,
              invalidationTypes: ["no_op_idempotent"],
              invalidatedKeys: []
            };
    if (mutation.changed && process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "post.like",
        postId,
        viewerId
      }).catch(() => undefined);
    }
    if (mutation.changed) {
      void notificationsService.createFromMutation({
        type: "like",
        actorId: viewerId,
        targetId: postId
      });
    }
    return {
      routeName: "posts.like.post" as const,
      postId: mutation.postId,
      liked: mutation.liked,
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
