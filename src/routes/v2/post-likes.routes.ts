import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  PostLikesListParamsSchema,
  PostLikesListQuerySchema,
  postLikesListContract
} from "../../contracts/surfaces/post-likes-list.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostLikesOrchestrator } from "../../orchestration/surfaces/post-likes.orchestrator.js";
import { PostLikesRepository } from "../../repositories/surfaces/post-likes.repository.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import { PostLikesService } from "../../services/surfaces/post-likes.service.js";

export async function registerV2PostLikesRoutes(app: FastifyInstance): Promise<void> {
  const repository = new PostLikesRepository();
  const service = new PostLikesService(repository);
  const orchestrator = new PostLikesOrchestrator(service);

  app.get(postLikesListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Post viewer v2 surface is not enabled for this viewer"));
    }
    const params = PostLikesListParamsSchema.parse(request.params);
    const query = PostLikesListQuerySchema.parse(request.query);
    setRouteName(postLikesListContract.routeName);
    try {
      const payload = await orchestrator.run({ postId: params.postId, limit: query.limit });
      return success(payload);
    } catch (error) {
      if (error instanceof SourceOfTruthRequiredError) {
        return reply.status(503).send(failure("source_of_truth_required", "Source-of-truth is required for likes list"));
      }
      throw error;
    }
  });
}

