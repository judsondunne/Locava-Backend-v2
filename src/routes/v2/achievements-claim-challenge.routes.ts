import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsClaimChallengeBodySchema,
  achievementsClaimChallengeContract
} from "../../contracts/surfaces/achievements-claim-challenge.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsClaimChallengeOrchestrator } from "../../orchestration/surfaces/achievements-claim-challenge.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsClaimChallengeRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsClaimChallengeOrchestrator(service);

  app.post(achievementsClaimChallengeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const body = AchievementsClaimChallengeBodySchema.parse(request.body ?? {});
    setRouteName(achievementsClaimChallengeContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId, challengeId: body.challengeId });
    return success(payload);
  });
}
