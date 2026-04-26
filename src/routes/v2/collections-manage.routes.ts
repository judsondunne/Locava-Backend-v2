import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionMutationRepository } from "../../repositories/mutations/collection-mutation.repository.js";
import { CollectionMutationService } from "../../services/mutations/collection-mutation.service.js";

const ParamsSchema = z.object({
  collectionId: z.string().trim().min(1)
});

export async function registerV2CollectionsManageRoutes(app: FastifyInstance): Promise<void> {
  const repository = new CollectionMutationRepository();
  const service = new CollectionMutationService(repository);

  app.post("/v2/collections/:collectionId/leave", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = ParamsSchema.parse(request.params);
    setRouteName("collections.leave.post");
    const result = await service.leaveCollection({ viewerId: viewer.viewerId, collectionId: params.collectionId });
    return success({
      routeName: "collections.leave.post" as const,
      collectionId: result.collectionId,
      removed: result.changed
    });
  });

  app.post("/v2/collections/:collectionId/delete", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = ParamsSchema.parse(request.params);
    setRouteName("collections.delete.post");
    const result = await service.deleteCollection({ viewerId: viewer.viewerId, collectionId: params.collectionId });
    return success({
      routeName: "collections.delete.post" as const,
      collectionId: result.collectionId,
      removed: result.changed
    });
  });
}
