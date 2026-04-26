import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  feedItemDetailContract,
  FeedItemDetailParamsSchema,
  FeedItemDetailQuerySchema
} from "../../contracts/surfaces/feed-item-detail.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { FeedItemDetailOrchestrator } from "../../orchestration/surfaces/feed-item-detail.orchestrator.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

export async function registerV2FeedItemDetailRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedRepository();
  const service = new FeedService(repository);
  const orchestrator = new FeedItemDetailOrchestrator(service);

  app.get(feedItemDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("homeFeed", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Home feed v2 surface is not enabled for this viewer"));
    }

    const params = FeedItemDetailParamsSchema.parse(request.params);
    const query = FeedItemDetailQuerySchema.parse(request.query);
    setRouteName(feedItemDetailContract.routeName);

    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        postId: params.postId,
        debugSlowDeferredMs: query.debugSlowDeferredMs
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "feed_post_not_found") {
        return reply.status(404).send(failure("post_not_found", "Feed post was not found"));
      }
      throw error;
    }
  });
}
