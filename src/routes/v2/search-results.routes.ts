import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { searchResultsContract, SearchResultsQuerySchema } from "../../contracts/surfaces/search-results.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SearchResultsOrchestrator } from "../../orchestration/surfaces/search-results.orchestrator.js";
import { SearchRepository } from "../../repositories/surfaces/search.repository.js";
import { SearchService } from "../../services/surfaces/search.service.js";

export async function registerV2SearchResultsRoutes(app: FastifyInstance): Promise<void> {
  const searchRepository = new SearchRepository();
  const searchService = new SearchService(searchRepository);
  const orchestrator = new SearchResultsOrchestrator(searchService);

  app.get(searchResultsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }

    const query = SearchResultsQuerySchema.parse(request.query);
    const typesRaw = query.types != null ? String(query.types).trim() : "";
    const wantedTypes = new Set(
      (typesRaw.length > 0 ? typesRaw : "posts,collections,users,mixes")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    setRouteName(searchResultsContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        query: query.q,
        cursor: query.cursor ?? null,
        limit: query.limit,
        lat: query.lat ?? null,
        lng: query.lng ?? null,
        wantedTypes
      });
      request.log.info(
        {
          event: "SEARCH_V2_RESULTS",
          query: query.q,
          types: [...wantedTypes].sort().join(","),
          postsCount: payload.sections.posts.items.length,
          collectionsCount: payload.sections.collections.items.length,
          usersCount: payload.sections.users.items.length,
          mixesCount: payload.sections.mixes.items.length
        },
        "search v2 sections ready"
      );
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_search_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Search cursor is invalid"));
      }
      throw error;
    }
  });
}
