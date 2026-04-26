import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { PostUnsaveParamsSchema, postUnsaveContract } from "../../contracts/surfaces/post-unsave.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostUnsaveOrchestrator } from "../../orchestration/mutations/post-unsave.orchestrator.js";
import { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";
import { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export async function registerV2PostUnsaveRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostMutationRepository();
  const service = new PostMutationService(repository);
  const orchestrator = new PostUnsaveOrchestrator(service);

  app.post(postUnsaveContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = PostUnsaveParamsSchema.parse(request.params);
    setRouteName(postUnsaveContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      postId: params.postId
    });
    return success(payload);
  });
}
