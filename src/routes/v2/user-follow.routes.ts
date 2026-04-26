import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { UserFollowParamsSchema, userFollowContract } from "../../contracts/surfaces/user-follow.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { UserFollowOrchestrator } from "../../orchestration/mutations/user-follow.orchestrator.js";
import { UserMutationRepository } from "../../repositories/mutations/user-mutation.repository.js";
import { UserMutationService } from "../../services/mutations/user-mutation.service.js";

export async function registerV2UserFollowRoutes(app: FastifyInstance): Promise<void> {
  const repository = new UserMutationRepository();
  const service = new UserMutationService(repository);
  const orchestrator = new UserFollowOrchestrator(service);

  app.post(userFollowContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "User mutation v2 surface is not enabled for this viewer"));
    }
    const params = UserFollowParamsSchema.parse(request.params);
    setRouteName(userFollowContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId
    });
    return success(payload);
  });
}
