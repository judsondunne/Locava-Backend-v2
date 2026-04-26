import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export class PostSaveOrchestrator {
  constructor(private readonly service: PostMutationService) {}

  async run(input: { viewerId: string; postId: string }) {
    const { viewerId, postId } = input;
    const mutation = await this.service.savePost(viewerId, postId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    const invalidation =
      mutation.changed
        ? {
            mutationType: "post.save" as const,
            invalidationTypes: [
              "post.social",
              "post.card",
              "post.detail",
              "post.viewer_state",
              "route.detail",
              "route.collections_saved"
            ],
            invalidatedKeys: []
          }
        : {
            mutationType: "post.save" as const,
            invalidationTypes: ["no_op_idempotent"],
            invalidatedKeys: []
          };
    if (mutation.changed) {
      void invalidateEntitiesForMutation({
        mutationType: "post.save",
        postId,
        viewerId
      }).catch(() => undefined);
    }
    return {
      routeName: "posts.save.post" as const,
      postId: mutation.postId,
      saved: mutation.saved,
      viewerState: {
        saved: mutation.saved
      },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
