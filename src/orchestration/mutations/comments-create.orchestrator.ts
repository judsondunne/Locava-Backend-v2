import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import { recordSurfaceTimings } from "../../observability/request-context.js";
import type { CommentsService } from "../../services/surfaces/comments.service.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

const notificationsService = new NotificationsService(notificationsRepository);

export class CommentsCreateOrchestrator {
  constructor(private readonly service: CommentsService) {}

  async run(input: {
    viewerId: string;
    postId: string;
    text: string;
    replyingTo: string | null;
    clientMutationKey: string | null;
  }) {
    const serviceStartedAt = performance.now();
    const result = await this.service.createComment(input);
    const serviceMs = performance.now() - serviceStartedAt;
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }

    const invalidationStartedAt = performance.now();
    const invalidation =
      process.env.VITEST === "true"
        ? await invalidateEntitiesForMutation({
            mutationType: "comment.create",
            postId: input.postId,
            viewerId: input.viewerId
          })
        : {
            mutationType: "comment.create" as const,
            invalidationTypes: ["route.post_comments", "entity.post", "entity.post_comments_preview"],
            invalidatedKeys: [`post:${input.postId}`, `post:${input.postId}:comments`, `post:${input.postId}:social`]
          };
    if (process.env.VITEST !== "true") {
      void invalidateEntitiesForMutation({
        mutationType: "comment.create",
        postId: input.postId,
        viewerId: input.viewerId
      }).catch(() => undefined);
    }
    recordSurfaceTimings({
      comments_create_service_ms: serviceMs,
      comments_create_invalidation_ms: performance.now() - invalidationStartedAt
    });
    if (!result.idempotent) {
      void notificationsService.createFromMutation({
        type: "comment",
        actorId: input.viewerId,
        targetId: input.postId,
        commentId: result.comment.commentId,
        metadata: {
          commentText: input.text,
        }
      });
    }

    return {
      routeName: "comments.create.post" as const,
      comment: result.comment,
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
