import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { commentsDeleteContract, CommentsDeleteParamsSchema } from "../../contracts/surfaces/comments-delete.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CommentsDeleteOrchestrator } from "../../orchestration/mutations/comments-delete.orchestrator.js";
import { CommentRepositoryError, commentsRepository } from "../../repositories/surfaces/comments.repository.js";
import { CommentsService } from "../../services/surfaces/comments.service.js";

export async function registerV2CommentsDeleteRoutes(app: FastifyInstance): Promise<void> {
  const service = new CommentsService(commentsRepository);
  const orchestrator = new CommentsDeleteOrchestrator(service);

  app.delete(commentsDeleteContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }

    const params = CommentsDeleteParamsSchema.parse(request.params);
    setRouteName(commentsDeleteContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        commentId: params.commentId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError) {
        if (error.code === "comment_not_found") {
          return reply.status(404).send(failure("comment_not_found", error.message));
        }
        if (error.code === "comment_not_owned") {
          return reply.status(403).send(failure("comment_not_owned", error.message));
        }
      }
      throw error;
    }
  });
  app.delete("/v2/posts/:postId/comments/:commentId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }
    const params = CommentsDeleteParamsSchema.parse(request.params);
    setRouteName(commentsDeleteContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        commentId: params.commentId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError) {
        if (error.code === "comment_not_found") {
          return reply.status(404).send(failure("comment_not_found", error.message));
        }
        if (error.code === "comment_not_owned") {
          return reply.status(403).send(failure("comment_not_owned", error.message));
        }
      }
      throw error;
    }
  });
}
