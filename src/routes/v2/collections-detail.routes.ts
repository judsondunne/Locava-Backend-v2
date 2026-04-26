import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  collectionsDetailContract,
  CollectionsDetailParamsSchema,
} from "../../contracts/surfaces/collections-detail.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsDetailOrchestrator } from "../../orchestration/surfaces/collections-detail.orchestrator.js";
import { CollectionsDetailRepository } from "../../repositories/surfaces/collections-detail.repository.js";
import { CollectionsDetailService } from "../../services/surfaces/collections-detail.service.js";

export async function registerV2CollectionsDetailRoutes(app: FastifyInstance): Promise<void> {
  const repository = new CollectionsDetailRepository();
  const service = new CollectionsDetailService(repository);
  const orchestrator = new CollectionsDetailOrchestrator(service);

  app.get(collectionsDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionsDetailParamsSchema.parse(request.params);
    setRouteName(collectionsDetailContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      collectionId: params.id,
    });
    if (!payload) {
      return reply.status(404).send(failure("collection_not_found", "Collection not found"));
    }
    return success(payload);
  });
}
