import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsClaimIntroBonusBodySchema,
  achievementsClaimIntroBonusContract
} from "../../contracts/surfaces/achievements-claim-intro-bonus.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsClaimIntroBonusOrchestrator } from "../../orchestration/surfaces/achievements-claim-intro-bonus.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsClaimIntroBonusRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsClaimIntroBonusOrchestrator(service);

  app.post(achievementsClaimIntroBonusContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    AchievementsClaimIntroBonusBodySchema.parse(request.body ?? {});
    setRouteName(achievementsClaimIntroBonusContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId });
    return success(payload);
  });
}
