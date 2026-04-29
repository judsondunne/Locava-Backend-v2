import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { UserUnfollowParamsSchema, userUnfollowContract } from "../../contracts/surfaces/user-unfollow.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { UserUnfollowOrchestrator } from "../../orchestration/mutations/user-unfollow.orchestrator.js";
import { UserMutationRepository } from "../../repositories/mutations/user-mutation.repository.js";
import { UserMutationService } from "../../services/mutations/user-mutation.service.js";

export async function registerV2UserUnfollowRoutes(app: FastifyInstance): Promise<void> {
  const repository = new UserMutationRepository();
  const service = new UserMutationService(repository);
  const orchestrator = new UserUnfollowOrchestrator(service);

  const handler: RouteHandlerMethod = async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "User mutation v2 surface is not enabled for this viewer"));
    }
    const params = UserUnfollowParamsSchema.parse(request.params);
    setRouteName(userUnfollowContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId
    });
    return success(payload);
  };

  // Native/client variants sometimes send DELETE for "unfollow". Support both.
  app.post(userUnfollowContract.path, handler);
  app.delete(userUnfollowContract.path, handler);
}
