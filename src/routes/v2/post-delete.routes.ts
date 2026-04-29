import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { postDeleteContract, PostDeleteParamsSchema } from "../../contracts/surfaces/post-delete.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostDeleteOrchestrator } from "../../orchestration/mutations/post-delete.orchestrator.js";
import { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";
import { PostMutationService } from "../../services/mutations/post-mutation.service.js";

export async function registerV2PostDeleteRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostMutationRepository();
  const service = new PostMutationService(repository);
  const orchestrator = new PostDeleteOrchestrator(service);

  app.delete(postDeleteContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post mutation v2 surface is not enabled for this viewer"));
    }
    const params = PostDeleteParamsSchema.parse(request.params);
    setRouteName(postDeleteContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        postId: params.postId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "post_not_found") {
        return reply.status(404).send(failure("post_not_found", "Post was not found"));
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.status(403).send(failure("forbidden", "You do not have permission to delete this post"));
      }
      throw error;
    }
  });
}

