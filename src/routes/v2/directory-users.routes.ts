import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  directoryUsersContract,
  DirectoryUsersQuerySchema
} from "../../contracts/surfaces/directory-users.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { parseExcludeUserIds } from "../../lib/user-discovery-exclude.js";
import { DirectoryUsersOrchestrator } from "../../orchestration/surfaces/directory-users.orchestrator.js";
import { DirectoryUsersRepository } from "../../repositories/surfaces/directory-users.repository.js";
import { DirectoryUsersService } from "../../services/surfaces/directory-users.service.js";

export async function registerV2DirectoryUsersRoutes(app: FastifyInstance): Promise<void> {
  const repository = new DirectoryUsersRepository();
  const service = new DirectoryUsersService(repository);
  const orchestrator = new DirectoryUsersOrchestrator(service);

  app.get(directoryUsersContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("directory", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Directory v2 surface is not enabled for this viewer"));
    }

    const query = DirectoryUsersQuerySchema.parse(request.query);
    setRouteName(directoryUsersContract.routeName);
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
        return reply.status(400).send(failure("invalid_cursor", "Directory users cursor is invalid"));
      }
      throw error;
    }
  });
}
