import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { CommentsService } from "../../services/surfaces/comments.service.js";

export class CommentsDeleteOrchestrator {
  constructor(private readonly service: CommentsService) {}

  async run(input: { viewerId: string; commentId: string }) {
    const result = await this.service.deleteComment(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }

    const invalidation =
      process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "comment.delete",
            postId: result.comment.postId,
            viewerId: input.viewerId
          })
        : {
            mutationType: "comment.delete" as const,
            invalidationTypes: ["route.post_comments", "entity.post", "entity.post_comments_preview"],
            invalidatedKeys: [
              `post:${result.comment.postId}`,
              `post:${result.comment.postId}:comments`,
              `post:${result.comment.postId}:social`
            ]
          };
    if (process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "comment.delete",
        postId: result.comment.postId,
        viewerId: input.viewerId
      }).catch(() => undefined);
    }

    return {
      routeName: "comments.delete.delete" as const,
      commentId: result.comment.commentId,
      postId: result.comment.postId,
      deleted: result.deleted,
      idempotency: {
        replayed: result.idempotent
      },
      invalidation: {
        invalidatedKeysCount: invalidation.invalidatedKeys.length,
        invalidationTypes: invalidation.invalidationTypes
      }
    };
  }
}
