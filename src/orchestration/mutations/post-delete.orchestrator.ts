import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostMutationService } from "../../services/mutations/post-mutation.service.js";
import { MapMarkersFirestoreAdapter } from "../../repositories/source-of-truth/map-markers-firestore.adapter.js";

export class PostDeleteOrchestrator {
  constructor(private readonly service: PostMutationService) {}

  async run(input: { viewerId: string; postId: string }) {
    const { viewerId, postId } = input;
    const mutation = await this.service.deletePost(viewerId, postId);
    if (mutation.changed) {
      recordIdempotencyMiss();
    } else {
      recordIdempotencyHit();
    }
    MapMarkersFirestoreAdapter.invalidateSharedCache();
    // Post delete must be strongly coherent for the acting viewer; otherwise the profile grid
    // can re-render from cache and the post appears "not deleted" until navigation.
    const baseInvalidation = await invalidateEntitiesForMutation({
      mutationType: "post.delete",
      postId,
      viewerId
    });
    const invalidation = mutation.changed
      ? baseInvalidation
      : {
          ...baseInvalidation,
          invalidationTypes: ["no_op_idempotent", ...baseInvalidation.invalidationTypes]
        };
    return {
      routeName: "posts.delete" as const,
      postId: mutation.postId,
      deleted: mutation.deleted,
      idempotency: { replayed: !mutation.changed },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}

