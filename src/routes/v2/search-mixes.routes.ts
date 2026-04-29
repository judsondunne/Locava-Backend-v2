import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  SearchMixesBootstrapQuerySchema,
  SearchMixesFeedBodySchema,
  SearchMixesFeedQuerySchema,
} from "../../contracts/searchMixes.contract.js";
import { SearchMixesOrchestrator } from "../../orchestration/searchMixes.orchestrator.js";

export async function registerV2SearchMixesRoutes(app: FastifyInstance): Promise<void> {
  const orchestrator = new SearchMixesOrchestrator();

  app.get("/v2/search/mixes/bootstrap", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.mixes.bootstrap.get");

    try {
      const query = SearchMixesBootstrapQuerySchema.parse(request.query);
      const payload = await orchestrator.bootstrap({
        viewerId: viewer.viewerId,
        lat: typeof query.lat === "number" && Number.isFinite(query.lat) ? query.lat : null,
        lng: typeof query.lng === "number" && Number.isFinite(query.lng) ? query.lng : null,
        limit: query.limit,
        includeDebug: Boolean(query.includeDebug),
      });
      return success(payload);
    } catch (error) {
      return reply.status(503).send(failure("upstream_unavailable", "Mix discovery is temporarily unavailable"));
    }
  });

  app.post("/v2/search/mixes/feed", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.mixes.feed.post");

    try {
      const body = SearchMixesFeedBodySchema.parse(request.body);
      const payload = await orchestrator.feedPage({
        viewerId: viewer.viewerId,
        mixId: body.mixId,
        lat: typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null,
        lng: typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null,
        limit: body.limit,
        cursor: body.cursor ?? null,
        includeDebug: Boolean(body.includeDebug),
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_mix_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Invalid cursor"));
      }
      return reply.status(503).send(failure("upstream_unavailable", "Mix discovery is temporarily unavailable"));
    }
  });

  app.get("/v2/search/mixes/feed", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.mixes.feed.get");

    try {
      const query = SearchMixesFeedQuerySchema.parse(request.query);
      const payload = await orchestrator.feedPage({
        viewerId: viewer.viewerId,
        mixId: query.mixId,
        lat: typeof query.lat === "number" && Number.isFinite(query.lat) ? query.lat : null,
        lng: typeof query.lng === "number" && Number.isFinite(query.lng) ? query.lng : null,
        limit: query.limit,
        cursor: (query.cursor ?? null) as string | null,
        includeDebug: Boolean(query.includeDebug),
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_mix_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Invalid cursor"));
      }
      const includeDebug = String((request.query as any)?.includeDebug ?? "") === "1";
      return reply
        .status(503)
        .send(
          failure(
            "upstream_unavailable",
            "Mix discovery is temporarily unavailable",
            includeDebug && error instanceof Error
              ? { message: error.message, stack: error.stack?.split("\n").slice(0, 6).join("\n") }
              : undefined
          )
        );
    }
  });
}

