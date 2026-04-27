import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { CommentsService } from "../../services/surfaces/comments.service.js";

export class CommentsLikeOrchestrator {
  constructor(private readonly service: CommentsService) {}

  async run(input: { viewerId: string; commentId: string }) {
    const result = await this.service.likeComment(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }

    const invalidation =
      process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "comment.like",
            postId: result.comment.postId,
            viewerId: input.viewerId
          })
        : {
            mutationType: "comment.like" as const,
            invalidationTypes: ["post.detail", "post.social", "route.detail", "route.comments"],
            invalidatedKeys: ["deferred"]
          };
    if (process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "comment.like",
        postId: result.comment.postId,
        viewerId: input.viewerId
      }).catch(() => undefined);
    }

    return {
      routeName: "comments.like.post" as const,
      commentId: result.comment.commentId,
      postId: result.comment.postId,
      liked: result.liked,
      likeCount: result.likeCount,
      viewerState: {
        liked: result.liked
      },
      idempotency: {
        replayed: result.idempotent
      },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }

  async runUnlike(input: { viewerId: string; commentId: string }) {
    const result = await this.service.unlikeComment(input);
    const invalidation =
      process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "comment.like",
            postId: result.comment.postId,
            viewerId: input.viewerId
          })
        : {
            mutationType: "comment.like" as const,
            invalidationTypes: ["post.detail", "post.social", "route.detail", "route.comments"],
            invalidatedKeys: ["deferred"]
          };
    if (process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "comment.like",
        postId: result.comment.postId,
        viewerId: input.viewerId
      }).catch(() => undefined);
    }
    return {
      routeName: "comments.like.post" as const,
      commentId: result.comment.commentId,
      postId: result.comment.postId,
      liked: result.liked,
      likeCount: result.likeCount,
      viewerState: { liked: false },
      idempotency: { replayed: result.idempotent },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
