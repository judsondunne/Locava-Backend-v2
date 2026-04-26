import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { postLikeContract, PostLikeParamsSchema } from "../../contracts/surfaces/post-like.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostLikeOrchestrator } from "../../orchestration/mutations/post-like.orchestrator.js";
import { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";
import { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export async function registerV2PostLikeRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostMutationRepository();
  const service = new PostMutationService(repository);
  const orchestrator = new PostLikeOrchestrator(service);

  app.post(postLikeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post mutation v2 surface is not enabled for this viewer"));
    }
    const params = PostLikeParamsSchema.parse(request.params);
    setRouteName(postLikeContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      postId: params.postId
    });
    return success(payload);
  });
}
