import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsClaimBadgeBodySchema,
  achievementsClaimBadgeContract
} from "../../contracts/surfaces/achievements-claim-badge.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsClaimBadgeOrchestrator } from "../../orchestration/surfaces/achievements-claim-badge.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsClaimBadgeRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsClaimBadgeOrchestrator(service);

  app.post(achievementsClaimBadgeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const body = AchievementsClaimBadgeBodySchema.parse(request.body ?? {});
    setRouteName(achievementsClaimBadgeContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId, badgeId: body.badgeId });
    return success(payload);
  });
}
