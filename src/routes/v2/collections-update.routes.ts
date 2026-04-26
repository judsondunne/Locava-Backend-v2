import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  CollectionsUpdateBodySchema,
  collectionsUpdateContract
} from "../../contracts/surfaces/collections-update.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsUpdateOrchestrator } from "../../orchestration/mutations/collections-update.orchestrator.js";
import { CollectionMutationRepository } from "../../repositories/mutations/collection-mutation.repository.js";
import { CollectionMutationService } from "../../services/mutations/collection-mutation.service.js";

export async function registerV2CollectionsUpdateRoutes(app: FastifyInstance): Promise<void> {
  const repository = new CollectionMutationRepository();
  const service = new CollectionMutationService(repository);
  const orchestrator = new CollectionsUpdateOrchestrator(service);

  app.post(collectionsUpdateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const body = CollectionsUpdateBodySchema.parse(request.body);
    setRouteName(collectionsUpdateContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      collectionId: body.collectionId,
      updates: body.updates
    });
    return success(payload);
  });
}
