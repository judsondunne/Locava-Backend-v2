import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsScreenOpenedBodySchema,
  achievementsScreenOpenedContract
} from "../../contracts/surfaces/achievements-screen-opened.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsScreenOpenedOrchestrator } from "../../orchestration/surfaces/achievements-screen-opened.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsScreenOpenedRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsScreenOpenedOrchestrator(service);

  app.post(achievementsScreenOpenedContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    AchievementsScreenOpenedBodySchema.parse(request.body ?? {});
    setRouteName(achievementsScreenOpenedContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId });
    return success(payload);
  });
}
