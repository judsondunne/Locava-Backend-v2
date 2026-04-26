import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  profilePostDetailContract,
  ProfilePostDetailParamsSchema,
  ProfilePostDetailQuerySchema
} from "../../contracts/surfaces/profile-post-detail.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ProfilePostDetailOrchestrator } from "../../orchestration/surfaces/profile-post-detail.orchestrator.js";
import { ProfilePostDetailRepository } from "../../repositories/surfaces/profile-post-detail.repository.js";
import { ProfilePostDetailService } from "../../services/surfaces/profile-post-detail.service.js";

export async function registerV2ProfilePostDetailRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ProfilePostDetailRepository();
  const service = new ProfilePostDetailService(repository);
  const orchestrator = new ProfilePostDetailOrchestrator(service);

  app.get(profilePostDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }

    const params = ProfilePostDetailParamsSchema.parse(request.params);
    const query = ProfilePostDetailQuerySchema.parse(request.query);
    setRouteName(profilePostDetailContract.routeName);

    try {
      const payload = await orchestrator.run({
        userId: params.userId,
        postId: params.postId,
        viewerId: viewer.viewerId,
        debugSlowDeferredMs: query.debugSlowDeferredMs
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "post_not_found_for_profile") {
        return reply.status(404).send(failure("post_not_found", "Post does not belong to this profile"));
      }
      throw error;
    }
  });
}
