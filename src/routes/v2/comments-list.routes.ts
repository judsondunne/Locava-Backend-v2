import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  commentsListContract,
  COMMENTS_LIST_LIMIT_MAX,
  CommentsListParamsSchema,
  CommentsListQuerySchema
} from "../../contracts/surfaces/comments-list.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CommentsListOrchestrator } from "../../orchestration/surfaces/comments-list.orchestrator.js";
import { CommentRepositoryError, commentsRepository } from "../../repositories/surfaces/comments.repository.js";
import { CommentsService } from "../../services/surfaces/comments.service.js";

export async function registerV2CommentsListRoutes(app: FastifyInstance): Promise<void> {
  const service = new CommentsService(commentsRepository);
  const orchestrator = new CommentsListOrchestrator(service);

  const handler = async (request: any, reply: any) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }

    const params = CommentsListParamsSchema.parse(request.params);
    const query = CommentsListQuerySchema.parse(request.query);
    const limit = Math.max(1, Math.min(COMMENTS_LIST_LIMIT_MAX, query.limit));
    setRouteName(commentsListContract.routeName);
    try {
      request.log.info({ event: "comments_bootstrap_start", postId: params.postId, viewerId: viewer.viewerId }, "comments bootstrap start");
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        postId: params.postId,
        cursor: query.cursor ?? null,
        limit
      });
      request.log.info(
        { event: query.cursor ? "comments_page_success" : "comments_bootstrap_success", postId: params.postId, count: payload.page.count },
        "comments list success"
      );
      return success(payload);
    } catch (error) {
      if (error instanceof CommentRepositoryError && error.code === "invalid_cursor") {
        request.log.error({ event: "comments_page_error", postId: params.postId, error: error.message }, "comments list invalid cursor");
        return reply.status(400).send(failure("invalid_cursor", error.message));
      }
      request.log.error({ event: query.cursor ? "comments_page_error" : "comments_bootstrap_error", postId: params.postId }, "comments list failed");
      throw error;
    }
  };
  app.get(commentsListContract.path, handler);
  app.get("/v2/posts/:postId/comments/bootstrap", handler);
  app.get("/v2/posts/:postId/comments/page", handler);
}
