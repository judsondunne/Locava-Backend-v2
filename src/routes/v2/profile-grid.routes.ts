import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { profileGridContract, ProfileGridParamsSchema, ProfileGridQuerySchema } from "../../contracts/surfaces/profile-grid.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setRouteName } from "../../observability/request-context.js";
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
    const ctx = getRequestContext();
    request.log.info(
      {
        routeName: profileGridContract.routeName,
        profileUserId: params.userId,
        viewerId: viewer.viewerId,
        latencyMs: ctx ? Number((Number(process.hrtime.bigint() - ctx.startNs) / 1_000_000).toFixed(2)) : undefined,
        readCount: ctx?.dbOps.reads ?? 0,
        payloadSize: ctx?.payloadBytes ?? 0,
        cacheHits: ctx?.cache.hits ?? 0,
        cacheMisses: ctx?.cache.misses ?? 0,
        counts: { grid: payload.items.length },
        fallbacks: ctx?.fallbacks ?? [],
      },
      "profile route completed"
    );

    return success(payload);
  });
}
