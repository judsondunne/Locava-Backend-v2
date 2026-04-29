import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { legendsStagePostContract, LegendsStagePostBodySchema } from "../../contracts/surfaces/legends-stage-post.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { legendService } from "../../domains/legends/legend.service.js";

export async function registerV2LegendsStagePostRoutes(app: FastifyInstance): Promise<void> {
  app.post(legendsStagePostContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsStagePostContract.routeName);
    const body = LegendsStagePostBodySchema.parse(request.body);
    const payload = await legendService.stagePost({
      userId: body.userId?.trim() || viewer.viewerId,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      geohash: body.geohash ?? null,
      activityIds: body.activityIds ?? [],
      city: body.city ?? null,
      state: body.state ?? null,
      region: body.region ?? null
    });
    return success({
      routeName: legendsStagePostContract.routeName,
      stageId: payload.stageId,
      derivedScopes: payload.derivedScopes,
      previewCards: payload.previewCards
    });
  });
}

