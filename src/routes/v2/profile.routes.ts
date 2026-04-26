import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ProfileBootstrapParamsSchema,
  ProfileBootstrapQuerySchema,
  profileBootstrapContract
} from "../../contracts/surfaces/profile-bootstrap.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ProfileBootstrapOrchestrator } from "../../orchestration/surfaces/profile-bootstrap.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { ProfileService } from "../../services/surfaces/profile.service.js";

export async function registerV2ProfileRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ProfileRepository();
  const service = new ProfileService(repository);
  const orchestrator = new ProfileBootstrapOrchestrator(service);

  app.get(profileBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }

    const params = ProfileBootstrapParamsSchema.parse(request.params);
    const query = ProfileBootstrapQuerySchema.parse(request.query);

    setRouteName(profileBootstrapContract.routeName);

    const payload = await orchestrator.run({
      viewer,
      userId: params.userId,
      gridLimit: query.gridLimit,
      debugSlowDeferredMs: query.debugSlowDeferredMs
    });

    return success(payload);
  });
}
