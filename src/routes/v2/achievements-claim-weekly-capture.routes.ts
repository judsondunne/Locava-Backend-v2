import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AchievementsClaimWeeklyCaptureBodySchema,
  achievementsClaimWeeklyCaptureContract
} from "../../contracts/surfaces/achievements-claim-weekly-capture.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AchievementsClaimWeeklyCaptureOrchestrator } from "../../orchestration/surfaces/achievements-claim-weekly-capture.orchestrator.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AchievementsService } from "../../services/surfaces/achievements.service.js";

export async function registerV2AchievementsClaimWeeklyCaptureRoutes(app: FastifyInstance): Promise<void> {
  const service = new AchievementsService(achievementsRepository);
  const orchestrator = new AchievementsClaimWeeklyCaptureOrchestrator(service);

  app.post(achievementsClaimWeeklyCaptureContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Achievements v2 surface is not enabled for this viewer"));
    }
    const body = AchievementsClaimWeeklyCaptureBodySchema.parse(request.body ?? {});
    setRouteName(achievementsClaimWeeklyCaptureContract.routeName);
    const payload = await orchestrator.run({ viewerId: viewer.viewerId, captureId: body.captureId });
    return success(payload);
  });
}
