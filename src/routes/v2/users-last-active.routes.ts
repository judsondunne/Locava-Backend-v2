import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { UsersLastActiveParamsSchema, usersLastActiveContract } from "../../contracts/surfaces/users-last-active.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { UsersLastActiveOrchestrator } from "../../orchestration/surfaces/users-last-active.orchestrator.js";
import { userActivityRepository } from "../../repositories/surfaces/user-activity.repository.js";
import { UserActivityService } from "../../services/surfaces/user-activity.service.js";

export async function registerV2UsersLastActiveRoutes(app: FastifyInstance): Promise<void> {
  const service = new UserActivityService(userActivityRepository);
  const orchestrator = new UsersLastActiveOrchestrator(service);

  app.get(usersLastActiveContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "V2 surface is not enabled for this viewer"));
    }
    const params = UsersLastActiveParamsSchema.parse(request.params);
    setRouteName(usersLastActiveContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId, userId: params.userId });
    return success(payload);
  });
}

