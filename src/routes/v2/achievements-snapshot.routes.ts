import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { achievementsSnapshotContract } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsSnapshotOrchestrator } from "../../orchestration/surfaces/achievements-snapshot.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";
import type { AchievementsSnapshotResponse } from "../../contracts/surfaces/achievements-snapshot.contract.js";

function buildSnapshotFailSoft(fallbackReason: string): AchievementsSnapshotResponse {
  return {
    routeName: "achievements.snapshot.get",
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
    degraded: true,
    fallbacks: [fallbackReason]
  };
}

export async function registerV2AchievementsSnapshotRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsSnapshotOrchestrator(service);

  app.get(achievementsSnapshotContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    setRouteName(achievementsSnapshotContract.routeName);
    try {
      const payload = await orchestrator.run({ viewerId: viewer.viewerId });
      return success(payload);
    } catch (error) {
      request.log.warn(
        {
          routeName: achievementsSnapshotContract.routeName,
          viewerId: viewer.viewerId,
          error: error instanceof Error ? error.message : String(error)
        },
        "achievements snapshot fail-soft"
      );
      return success(buildSnapshotFailSoft("snapshot_fail_soft"));
    }
  });
}
