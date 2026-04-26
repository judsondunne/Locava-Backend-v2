import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { CollectionsCreateBodySchema, collectionsCreateContract } from "../../contracts/surfaces/collections-create.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsCreateOrchestrator } from "../../orchestration/mutations/collections-create.orchestrator.js";
import { CollectionMutationRepository } from "../../repositories/mutations/collection-mutation.repository.js";
import { CollectionMutationService } from "../../services/mutations/collection-mutation.service.js";

export async function registerV2CollectionsCreateRoutes(app: FastifyInstance): Promise<void> {
  const repository = new CollectionMutationRepository();
  const service = new CollectionMutationService(repository);
  const orchestrator = new CollectionsCreateOrchestrator(service);

  app.post(collectionsCreateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const body = CollectionsCreateBodySchema.parse(request.body);
    setRouteName(collectionsCreateContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      name: body.name,
      description: body.description,
      privacy: body.privacy,
      collaborators: body.collaborators ?? [],
      items: body.items ?? [],
      coverUri: body.coverUri
    });
    return success(payload);
  });
}
