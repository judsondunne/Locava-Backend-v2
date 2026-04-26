import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { formatServerTimingHeader, getRequestContext, setRouteName } from "../../observability/request-context.js";
import { ChatsInboxOrchestrator } from "../../orchestration/surfaces/chats-inbox.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsInboxQuerySchema, chatsInboxContract } from "../../contracts/surfaces/chats-inbox.contract.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

export async function registerV2ChatsInboxRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsInboxOrchestrator(service);

  app.get(chatsInboxContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const query = ChatsInboxQuerySchema.parse(request.query);
    setRouteName(chatsInboxContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        cursor: query.cursor ?? null,
        limit: query.limit
      });
      const ctx = getRequestContext();
      const st = ctx?.surfaceTimings;
      if (st && Object.keys(st).length > 0) {
        reply.header("Server-Timing", formatServerTimingHeader(st));
      }
      return success(payload);
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "invalid_cursor") {
        return reply.status(400).send(failure("invalid_cursor", error.message));
      }
      throw error;
    }
  });
}
