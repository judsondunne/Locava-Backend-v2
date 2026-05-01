import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { achievementsPendingCelebrationsContract } from "../../contracts/surfaces/achievements-pending-celebrations.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsPendingCelebrationsRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);

  app.get(achievementsPendingCelebrationsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    setRouteName(achievementsPendingCelebrationsContract.routeName);
    const celebrations = await service.loadPendingCelebrations(viewer.viewerId);
    return success({
      routeName: achievementsPendingCelebrationsContract.routeName,
      celebrations,
      degraded: false,
      fallbacks: []
    });
  });
}
