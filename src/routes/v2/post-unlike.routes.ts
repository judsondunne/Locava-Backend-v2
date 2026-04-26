import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { PostUnlikeParamsSchema, postUnlikeContract } from "../../contracts/surfaces/post-unlike.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostUnlikeOrchestrator } from "../../orchestration/mutations/post-unlike.orchestrator.js";
import { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";
import { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export async function registerV2PostUnlikeRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostMutationRepository();
  const service = new PostMutationService(repository);
  const orchestrator = new PostUnlikeOrchestrator(service);

  app.post(postUnlikeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post mutation v2 surface is not enabled for this viewer"));
    }
    const params = PostUnlikeParamsSchema.parse(request.params);
    setRouteName(postUnlikeContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      postId: params.postId
    });
    return success(payload);
  });
}
