import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { incrementDbOps, recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import type { PostMutationService } from "../../services/mutations/post-mutation.service.js";
import { readPostLikeCountFromFirestoreData } from "./post-document-like-count.js";

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
    const invalidation =
      mutation.changed && process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "post.unlike",
            postId,
            viewerId
          })
        : mutation.changed
          ? {
              mutationType: "post.unlike" as const,
              invalidationTypes: ["post.social", "post.card", "post.detail", "post.viewer_state", "route.detail"],
              invalidatedKeys: ["deferred"]
            }
          : {
              mutationType: "post.unlike" as const,
              invalidationTypes: ["no_op_idempotent"],
              invalidatedKeys: []
            };
    if (mutation.changed && process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "post.unlike",
        postId,
        viewerId
      }).catch(() => undefined);
    }
    let likeCount = 0;
    const db = getFirestoreSourceClient();
    if (db) {
      const snap = await db.collection("posts").doc(postId).get();
      incrementDbOps("reads", snap.exists ? 1 : 0);
      const d = (snap.data() ?? {}) as Record<string, unknown>;
      likeCount = readPostLikeCountFromFirestoreData(d);
    }
    return {
      routeName: "posts.unlike.post" as const,
      postId: mutation.postId,
      liked: mutation.liked,
      likeCount,
      viewerState: { liked: mutation.liked },
      idempotency: { replayed: !mutation.changed },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
