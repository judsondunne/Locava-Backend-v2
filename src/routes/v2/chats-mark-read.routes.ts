import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsMarkReadOrchestrator } from "../../orchestration/mutations/chats-mark-read.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";
import { ChatsMarkReadParamsSchema, chatsMarkReadContract } from "../../contracts/surfaces/chats-mark-read.contract.js";

export async function registerV2ChatsMarkReadRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsMarkReadOrchestrator(service);

  app.post(chatsMarkReadContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsMarkReadParamsSchema.parse(request.params);
    setRouteName(chatsMarkReadContract.routeName);
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
