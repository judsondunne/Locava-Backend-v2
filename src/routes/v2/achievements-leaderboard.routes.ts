import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { AchievementLeaderboardScopeSchema } from "../../contracts/entities/achievement-entities.contract.js";
import { achievementsLeaderboardContract } from "../../contracts/surfaces/achievements-leaderboard.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsLeaderboardOrchestrator } from "../../orchestration/surfaces/achievements-leaderboard.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

const LeaderboardParamsSchema = z.object({
  scope: AchievementLeaderboardScopeSchema
});

export async function registerV2AchievementsLeaderboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsLeaderboardOrchestrator(service);

  app.get(achievementsLeaderboardContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const params = LeaderboardParamsSchema.parse(request.params);
    const query = achievementsLeaderboardContract.query.parse(request.query ?? {});
    setRouteName(achievementsLeaderboardContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      scope: params.scope,
      leagueId: query.leagueId
    });
    return success(payload);
  });
}
