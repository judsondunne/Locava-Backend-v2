import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postsDetailsBatchContract,
  postsDetailContract,
  PostsDetailsBatchBodySchema,
  PostsDetailParamsSchema
} from "../../contracts/surfaces/posts-detail.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostsDetailOrchestrator } from "../../orchestration/surfaces/posts-detail.orchestrator.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

export async function registerV2PostsDetailRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedRepository();
  const service = new FeedService(repository);
  const orchestrator = new PostsDetailOrchestrator(service);

  app.get(postsDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post viewer v2 surface is not enabled for this viewer"));
    }
    const params = PostsDetailParamsSchema.parse(request.params);
    setRouteName(postsDetailContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        postId: params.postId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "feed_post_not_found") {
        return reply.status(404).send(failure("post_not_found", "Post was not found"));
      }
      throw error;
    }
  });

  app.post(postsDetailsBatchContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post viewer v2 surface is not enabled for this viewer"));
    }
    const body = PostsDetailsBatchBodySchema.parse(request.body);
    setRouteName(postsDetailsBatchContract.routeName);
    const payload = await orchestrator.runBatch({
      viewerId: viewer.viewerId,
      postIds: body.postIds,
      reason: body.reason
    });
    return success(payload);
  });
}
