import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { mapBootstrapContract, MapBootstrapQuerySchema } from "../../contracts/surfaces/map-bootstrap.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { MapBootstrapOrchestrator } from "../../orchestration/surfaces/map-bootstrap.orchestrator.js";
import { MapRepositoryError, mapRepository } from "../../repositories/surfaces/map.repository.js";
import { MapService } from "../../services/surfaces/map.service.js";

export async function registerV2MapBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const service = new MapService(mapRepository);
  const orchestrator = new MapBootstrapOrchestrator(service);

  app.get(mapBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("map", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Map v2 surface is not enabled for this viewer"));
    }
    const query = MapBootstrapQuerySchema.parse(request.query);
    setRouteName(mapBootstrapContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        bbox: query.bbox,
        limit: query.limit
      });
      return success(payload);
    } catch (error) {
      if (error instanceof MapRepositoryError && error.code === "invalid_bbox") {
        return reply.status(400).send(failure("invalid_bbox", error.message));
      }
      throw error;
    }
  });
}
