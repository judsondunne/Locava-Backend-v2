import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { achievementsSnapshotContract } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsSnapshotOrchestrator } from "../../orchestration/surfaces/achievements-snapshot.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsSnapshotRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsSnapshotOrchestrator(service);

  app.get(achievementsSnapshotContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    setRouteName(achievementsSnapshotContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId });
    return success(payload);
  });
}
