import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsLeaderboardAckBodySchema,
  achievementsLeaderboardAckContract
} from "../../contracts/surfaces/achievements-leaderboard-ack.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsLeaderboardAckOrchestrator } from "../../orchestration/surfaces/achievements-leaderboard-ack.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsLeaderboardAckRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsLeaderboardAckOrchestrator(service);

  app.post(achievementsLeaderboardAckContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const body = AchievementsLeaderboardAckBodySchema.parse(request.body ?? {});
    setRouteName(achievementsLeaderboardAckContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId, eventId: body.eventId });
    return success(payload);
  });
}
