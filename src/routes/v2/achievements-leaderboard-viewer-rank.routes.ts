import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsLeaderboardViewerRankParamsSchema,
  achievementsLeaderboardViewerRankContract
} from "../../contracts/surfaces/achievements-leaderboard-viewer-rank.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsLeaderboardViewerRankOrchestrator } from "../../orchestration/surfaces/achievements-leaderboard-viewer-rank.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsLeaderboardViewerRankRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsLeaderboardViewerRankOrchestrator(service);

  app.get(achievementsLeaderboardViewerRankContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const params = AchievementsLeaderboardViewerRankParamsSchema.parse(request.params ?? {});
    const query = achievementsLeaderboardViewerRankContract.query.parse(request.query ?? {});
    setRouteName(achievementsLeaderboardViewerRankContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      leaderboardKey: params.leaderboardKey,
      leagueId: query.leagueId
    });
    return success(payload);
  });
}
