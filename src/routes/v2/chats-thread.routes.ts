import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { chatsThreadContract, ChatsThreadParamsSchema, ChatsThreadQuerySchema } from "../../contracts/surfaces/chats-thread.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsThreadOrchestrator } from "../../orchestration/surfaces/chats-thread.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

export async function registerV2ChatsThreadRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsThreadOrchestrator(service);

  app.get(chatsThreadContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsThreadParamsSchema.parse(request.params);
    const query = ChatsThreadQuerySchema.parse(request.query);
    setRouteName(chatsThreadContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        cursor: query.cursor ?? null,
        limit: query.limit
      });
      return success(payload);
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "invalid_cursor") {
        return reply.status(400).send(failure("invalid_cursor", error.message));
      }
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send(failure("conversation_not_found", error.message));
      }
      throw error;
    }
  });
}
