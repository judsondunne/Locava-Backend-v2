import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  MixPageQuerySchema,
  MixPathParamsSchema,
  MixPreviewQuerySchema,
  mixesPageContract,
  mixesPreviewContract,
} from "../../contracts/v2/mixes.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { MixesOrchestrator } from "../../orchestration/mixes/mixes.orchestrator.js";
import { mixesRepository } from "../../repositories/mixes/mixes.repository.js";

export async function registerV2MixesRoutes(app: FastifyInstance): Promise<void> {
  const orchestrator = new MixesOrchestrator();

  app.addHook("onReady", async () => {
    mixesRepository.startBackgroundRefresh(app.log);
  });
  app.addHook("onClose", async () => {
    mixesRepository.stopBackgroundRefresh();
  });

  app.get(mixesPreviewContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Mixes v2 surface is not enabled for this viewer"));
    }
    setRouteName(mixesPreviewContract.routeName);
    try {
      const params = MixPathParamsSchema.parse(request.params);
      const query = MixPreviewQuerySchema.parse(request.query);
      const payload = await orchestrator.preview({
        mixKey: params.mixKey,
        filter: {
          activity: query.activity,
          state: query.state,
          place: query.place,
          lat: query.lat,
          lng: query.lng,
          radiusKm: query.radiusKm,
        },
        limit: query.limit,
        viewerId: query.viewerId ?? viewer.viewerId ?? null,
      });
      return success(payload);
    } catch (error) {
      request.log.error(
        { event: "mixes_preview_failed", error: error instanceof Error ? error.message : String(error) },
        "mixes preview failed"
      );
      return reply.status(503).send(failure("mixes_preview_failed", "Mix preview is temporarily unavailable"));
    }
  });

  app.get(mixesPageContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Mixes v2 surface is not enabled for this viewer"));
    }
    setRouteName(mixesPageContract.routeName);
    try {
      const params = MixPathParamsSchema.parse(request.params);
      const query = MixPageQuerySchema.parse(request.query);
      const payload = await orchestrator.page({
        mixKey: params.mixKey,
        filter: {
          activity: query.activity,
          state: query.state,
          place: query.place,
          lat: query.lat,
          lng: query.lng,
          radiusKm: query.radiusKm,
        },
        limit: query.limit,
        cursor: query.cursor ?? null,
        viewerId: query.viewerId ?? viewer.viewerId ?? null,
      });
      return success(payload);
    } catch (error) {
      request.log.error(
        { event: "mixes_page_failed", error: error instanceof Error ? error.message : String(error) },
        "mixes page failed"
      );
      return reply.status(503).send(failure("mixes_page_failed", "Mix page is temporarily unavailable"));
    }
  });
}
