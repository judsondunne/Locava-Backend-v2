import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export class PostUnlikeOrchestrator {
  constructor(private readonly service: PostMutationService) {}

  async run(input: { viewerId: string; postId: string }) {
    const { viewerId, postId } = input;
    const mutation = await this.service.unlikePost(viewerId, postId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    const invalidation = mutation.changed
      ? await invalidateEntitiesForMutation({
          mutationType: "post.unlike",
          postId,
          viewerId
        })
      : {
          mutationType: "post.unlike" as const,
          invalidationTypes: ["no_op_idempotent"],
          invalidatedKeys: []
        };
    return {
      routeName: "posts.unlike.post" as const,
      postId: mutation.postId,
      liked: mutation.liked,
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
