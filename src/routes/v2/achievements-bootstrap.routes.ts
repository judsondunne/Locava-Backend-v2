import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { achievementsBootstrapContract } from "../../contracts/surfaces/achievements-bootstrap.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsBootstrapOrchestrator } from "../../orchestration/surfaces/achievements-bootstrap.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";
import type { AchievementsBootstrapResponse } from "../../contracts/surfaces/achievements-bootstrap.contract.js";

function buildBootstrapFailSoft(fallbackReason: string): AchievementsBootstrapResponse {
  return {
    routeName: "achievements.bootstrap.get",
    hero: {
      xp: { current: 0, level: 1, levelProgress: 0, tier: "Starter" },
      streak: { current: 0, longest: 0, lastQualifiedAt: null },
      totalPosts: 0,
      globalRank: null
    },
    snapshot: {
      xp: { current: 0, level: 1, levelProgress: 0, tier: "Starter" },
      streak: { current: 0, longest: 0, lastQualifiedAt: null },
      totalPosts: 0,
      globalRank: null,
      challenges: [],
      weeklyCapturesWeekOf: null,
      weeklyCaptures: [],
      badges: [],
      pendingLeaderboardEvent: null
    },
    leagues: [],
    claimables: {
      totalCount: 0,
      weeklyCaptures: [],
      badges: [],
      challenges: []
    },
    degraded: true,
    fallbacks: [fallbackReason]
  };
}

export async function registerV2AchievementsBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsBootstrapOrchestrator(service);

  app.get(achievementsBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    setRouteName(achievementsBootstrapContract.routeName);
    try {
      const payload = await orchestrator.run({ viewerId: viewer.viewerId });
      return success(payload);
    } catch (error) {
      request.log.warn(
        {
          routeName: achievementsBootstrapContract.routeName,
          viewerId: viewer.viewerId,
          error: error instanceof Error ? error.message : String(error)
        },
        "achievements bootstrap fail-soft"
      );
      return success(buildBootstrapFailSoft("bootstrap_fail_soft"));
    }
  });
}
