import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { PostSaveParamsSchema, postSaveContract } from "../../contracts/surfaces/post-save.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostSaveOrchestrator } from "../../orchestration/mutations/post-save.orchestrator.js";
import { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";
import { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export async function registerV2PostSaveRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostMutationRepository();
  const service = new PostMutationService(repository);
  const orchestrator = new PostSaveOrchestrator(service);

  app.post(postSaveContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = PostSaveParamsSchema.parse(request.params);
    setRouteName(postSaveContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      postId: params.postId
    });
    return success(payload);
  });
}
