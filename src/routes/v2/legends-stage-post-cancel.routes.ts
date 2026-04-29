import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  LegendsStagePostCancelParamsSchema,
  legendsStagePostCancelContract
} from "../../contracts/surfaces/legends-stage-post-cancel.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";

export async function registerV2LegendsStagePostCancelRoutes(app: FastifyInstance): Promise<void> {
  app.delete(legendsStagePostCancelContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsStagePostCancelContract.routeName);
    const params = LegendsStagePostCancelParamsSchema.parse(request.params);
    const result = await legendRepository.cancelStage(params.stageId);
    return success({
      routeName: legendsStagePostCancelContract.routeName,
      stageId: params.stageId,
      cancelled: result.cancelled
    });
  });
}

