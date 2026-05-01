import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  SearchHomeBootstrapV1QuerySchema,
  SearchHomeBootstrapV1ResponseSchema,
  SearchMixActivityPageQuerySchema,
  SearchMixActivityPageResponseSchema,
} from "../../contracts/surfaces/search-home-bootstrap-v1.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SearchHomeV1Orchestrator } from "../../orchestration/surfaces/search-home-v1.orchestrator.js";

export async function registerV2SearchHomeV1Routes(app: FastifyInstance): Promise<void> {
  const orchestrator = new SearchHomeV1Orchestrator();

  app.get("/v2/search/home-bootstrap", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.home_bootstrap.v1");
    const query = SearchHomeBootstrapV1QuerySchema.parse(request.query);
    try {
      const raw = await orchestrator.homeBootstrap({
        viewerId: viewer.viewerId,
        includeDebug: Boolean(query.includeDebug),
        bypassCache: Boolean(query.bypassCache),
      });
      const data = SearchHomeBootstrapV1ResponseSchema.parse(raw);
      return success(data);
    } catch (error) {
      request.log.warn(
        {
          routeName: "search.home_bootstrap.v1",
          viewerId: viewer.viewerId,
          error: error instanceof Error ? error.message : String(error),
        },
        "search home bootstrap fallback to empty/partial payload"
      );
      return success({
        version: 1 as const,
        viewerId: viewer.viewerId,
        generatedAt: new Date().toISOString(),
        suggestedUsers: [],
        activityMixes: [],
        ...(query.includeDebug
          ? {
              debug: {
                routeName: "search.home_bootstrap.v1" as const,
                cacheStatus: "bypass" as const,
                latencyMs: 0,
                readCount: 0,
                payloadBytes: 0,
                suggestedUserCount: 0,
                suggestedUsersWithFirstPostCount: 0,
                activityMixCount: 0,
                postsPerMix: [],
              },
            }
          : {}),
      });
    }
  });

  app.get<{ Params: { activityKey: string } }>("/v2/search/mixes/:activityKey/page", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.mixes.activity.page.get");
    try {
      const params = request.params;
      const query = SearchMixActivityPageQuerySchema.parse(request.query);
      const raw = await orchestrator.activityMixPage({
        viewerId: viewer.viewerId,
        activityKeyRaw: String(params.activityKey ?? ""),
        cursor: query.cursor ?? null,
        limit: query.limit ?? 18,
        includeDebug: Boolean(query.includeDebug),
      });
      const data = SearchMixActivityPageResponseSchema.parse(raw);
      return success(data);
    } catch {
      return reply.status(503).send(failure("upstream_unavailable", "Mix page is temporarily unavailable"));
    }
  });
}
