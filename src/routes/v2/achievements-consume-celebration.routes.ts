import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsConsumeCelebrationParamsSchema,
  achievementsConsumeCelebrationContract
} from "../../contracts/surfaces/achievements-consume-celebration.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsConsumeCelebrationRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);

  app.post(achievementsConsumeCelebrationContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const params = AchievementsConsumeCelebrationParamsSchema.parse(request.params ?? {});
    setRouteName(achievementsConsumeCelebrationContract.routeName);
    const celebration = await service.consumeCelebration(viewer.viewerId, params.celebrationId);
    return success({
      routeName: achievementsConsumeCelebrationContract.routeName,
      consumed: celebration !== null,
      celebration,
      degraded: false,
      fallbacks: []
    });
  });
}
