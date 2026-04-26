import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  collectionsListContract,
  CollectionsListQuerySchema,
} from "../../contracts/surfaces/collections-list.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsListOrchestrator } from "../../orchestration/surfaces/collections-list.orchestrator.js";
import { CollectionsListRepository } from "../../repositories/surfaces/collections-list.repository.js";
import { CollectionsListService } from "../../services/surfaces/collections-list.service.js";

export async function registerV2CollectionsListRoutes(app: FastifyInstance): Promise<void> {
  const repository = new CollectionsListRepository();
  const service = new CollectionsListService(repository);
  const orchestrator = new CollectionsListOrchestrator(service);

  app.get(collectionsListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const query = CollectionsListQuerySchema.parse(request.query);
    setRouteName(collectionsListContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      limit: query.limit,
    });
    return success(payload);
  });
}
