import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsMarkUnreadOrchestrator } from "../../orchestration/mutations/chats-mark-unread.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";
import { ChatsMarkUnreadParamsSchema, chatsMarkUnreadContract } from "../../contracts/surfaces/chats-mark-unread.contract.js";

export async function registerV2ChatsMarkUnreadRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsMarkUnreadOrchestrator(service);

  app.post(chatsMarkUnreadContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsMarkUnreadParamsSchema.parse(request.params);
    setRouteName(chatsMarkUnreadContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send(failure("conversation_not_found", error.message));
      }
      throw error;
    }
  });
}
