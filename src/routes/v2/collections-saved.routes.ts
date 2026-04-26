import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { collectionsSavedContract, CollectionsSavedQuerySchema } from "../../contracts/surfaces/collections-saved.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsSavedOrchestrator } from "../../orchestration/surfaces/collections-saved.orchestrator.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { CollectionsRepository, CollectionsRepositoryError } from "../../repositories/surfaces/collections.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";
import { CollectionsService } from "../../services/surfaces/collections.service.js";

export async function registerV2CollectionsSavedRoutes(app: FastifyInstance): Promise<void> {
  const feedRepository = new FeedRepository();
  const collectionsRepository = new CollectionsRepository();
  const feedService = new FeedService(feedRepository);
  const collectionsService = new CollectionsService(collectionsRepository, feedService);
  const orchestrator = new CollectionsSavedOrchestrator(collectionsService);

  app.get(collectionsSavedContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const query = CollectionsSavedQuerySchema.parse(request.query);
    setRouteName(collectionsSavedContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        cursor: query.cursor ?? null,
        limit: query.limit
      });
      return success(payload);
    } catch (error) {
      if (error instanceof CollectionsRepositoryError && error.code === "invalid_cursor") {
        return reply.status(400).send(failure("invalid_cursor", error.message));
      }
      throw error;
    }
  });
}
