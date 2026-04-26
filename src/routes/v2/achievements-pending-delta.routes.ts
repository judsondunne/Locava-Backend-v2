import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { achievementsPendingDeltaContract } from "../../contracts/surfaces/achievements-pending-delta.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsPendingDeltaOrchestrator } from "../../orchestration/surfaces/achievements-pending-delta.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsPendingDeltaRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsPendingDeltaOrchestrator(service);

  app.get(achievementsPendingDeltaContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    setRouteName(achievementsPendingDeltaContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId });
    return success(payload);
  });
}
