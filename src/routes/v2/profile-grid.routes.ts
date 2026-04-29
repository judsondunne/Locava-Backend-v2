import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { profileGridContract, ProfileGridParamsSchema, ProfileGridQuerySchema } from "../../contracts/surfaces/profile-grid.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ProfileGridOrchestrator } from "../../orchestration/surfaces/profile-grid.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { ProfileService } from "../../services/surfaces/profile.service.js";

export async function registerV2ProfileGridRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ProfileRepository();
  const service = new ProfileService(repository);
  const orchestrator = new ProfileGridOrchestrator(service);

  app.get(profileGridContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }

    const params = ProfileGridParamsSchema.parse(request.params);
    const query = ProfileGridQuerySchema.parse(request.query);
    setRouteName(profileGridContract.routeName);

    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId,
      cursor: query.cursor ?? null,
      limit: query.limit
    });

    return success(payload);
  });
}
