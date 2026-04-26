import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ChatsMessageReactionBodySchema,
  ChatsMessageReactionParamsSchema,
  chatsMessageReactionContract
} from "../../contracts/surfaces/chats-message-reaction.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsMessageReactionOrchestrator } from "../../orchestration/mutations/chats-message-reaction.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

export async function registerV2ChatsMessageReactionRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsMessageReactionOrchestrator(service);

  app.post(chatsMessageReactionContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsMessageReactionParamsSchema.parse(request.params);
    const body = ChatsMessageReactionBodySchema.parse(request.body ?? {});
    setRouteName(chatsMessageReactionContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        emoji: body.emoji
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
