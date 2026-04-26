import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { commentsLikeContract, CommentsLikeParamsSchema } from "../../contracts/surfaces/comments-like.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CommentsLikeOrchestrator } from "../../orchestration/mutations/comments-like.orchestrator.js";
import { CommentRepositoryError, commentsRepository } from "../../repositories/surfaces/comments.repository.js";
import { CommentsService } from "../../services/surfaces/comments.service.js";

export async function registerV2CommentsLikeRoutes(app: FastifyInstance): Promise<void> {
  const service = new CommentsService(commentsRepository);
  const orchestrator = new CommentsLikeOrchestrator(service);

  app.post(commentsLikeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }

    const params = CommentsLikeParamsSchema.parse(request.params);
    setRouteName(commentsLikeContract.routeName);
    try {
      // invalidation: comment like updates comment state and parent post social projections consumed by detail/comment surfaces.
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        commentId: params.commentId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError && error.code === "comment_not_found") {
        return reply.status(404).send(failure("comment_not_found", error.message));
      }
      throw error;
    }
  });
  app.post("/v2/posts/:postId/comments/:commentId/like", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }
    const params = CommentsLikeParamsSchema.parse(request.params);
    setRouteName(commentsLikeContract.routeName);
    try {
      // invalidation: comment like updates comment state and parent post social projections consumed by detail/comment surfaces.
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        commentId: params.commentId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError && error.code === "comment_not_found") {
        return reply.status(404).send(failure("comment_not_found", error.message));
      }
      throw error;
    }
  });

  app.post("/v2/posts/:postId/comments/:commentId/unlike", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }
    const params = CommentsLikeParamsSchema.parse(request.params);
    setRouteName(commentsLikeContract.routeName);
    try {
      // invalidation: comment unlike updates comment state and parent post social projections consumed by detail/comment surfaces.
      const payload = await orchestrator.runUnlike({
        viewerId: viewer.viewerId,
        commentId: params.commentId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError && error.code === "comment_not_found") {
        return reply.status(404).send(failure("comment_not_found", error.message));
      }
      throw error;
    }
  });
}
