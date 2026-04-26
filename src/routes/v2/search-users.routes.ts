import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { searchUsersContract, SearchUsersQuerySchema } from "../../contracts/surfaces/search-users.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { parseExcludeUserIds } from "../../lib/user-discovery-exclude.js";
import { SearchUsersOrchestrator } from "../../orchestration/surfaces/search-users.orchestrator.js";
import { SearchUsersRepository } from "../../repositories/surfaces/search-users.repository.js";
import { SearchUsersService } from "../../services/surfaces/search-users.service.js";

export async function registerV2SearchUsersRoutes(app: FastifyInstance): Promise<void> {
  const usersRepository = new SearchUsersRepository();
  const usersService = new SearchUsersService(usersRepository);
  const orchestrator = new SearchUsersOrchestrator(usersService);

  app.get(searchUsersContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }

    const query = SearchUsersQuerySchema.parse(request.query);
    setRouteName(searchUsersContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        query: query.q,
        cursor: query.cursor ?? null,
        limit: query.limit,
        excludeUserIds: parseExcludeUserIds(query.exclude)
      });
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_search_users_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Search users cursor is invalid"));
      }
      throw error;
    }
  });
}
