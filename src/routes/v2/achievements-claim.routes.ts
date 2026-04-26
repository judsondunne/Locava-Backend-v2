import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { AchievementsClaimBodySchema, achievementsClaimContract } from "../../contracts/surfaces/achievements-claim.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsClaimOrchestrator } from "../../orchestration/surfaces/achievements-claim.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsClaimRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsClaimOrchestrator(service);

  app.post(achievementsClaimContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const body = AchievementsClaimBodySchema.parse(request.body ?? {});
    setRouteName(achievementsClaimContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      kind: body.kind,
      id: body.id,
      source: body.source
    });
    return success(payload);
  });
}
