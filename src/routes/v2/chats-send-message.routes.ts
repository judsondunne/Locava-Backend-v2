import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ChatsSendMessageBodySchema,
  ChatsSendMessageParamsSchema,
  chatsSendMessageContract
} from "../../contracts/surfaces/chats-send-message.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsSendMessageOrchestrator } from "../../orchestration/mutations/chats-send-message.orchestrator.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

export async function registerV2ChatsSendMessageRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);
  const orchestrator = new ChatsSendMessageOrchestrator(service);

  app.post(chatsSendMessageContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsSendMessageParamsSchema.parse(request.params);
    const body = ChatsSendMessageBodySchema.parse(request.body);
    setRouteName(chatsSendMessageContract.routeName);
    try {
      const messageType = body.messageType ?? "text";
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (messageType === "text" && text.length === 0) {
        return reply.status(400).send(failure("invalid_payload", "text is required for text messages"));
      }
      if (messageType === "photo" && !body.photoUrl) {
        return reply.status(400).send(failure("invalid_payload", "photoUrl is required for photo messages"));
      }
      if (messageType === "gif" && !body.gifUrl) {
        return reply.status(400).send(failure("invalid_payload", "gifUrl is required for gif messages"));
      }
      if (messageType === "post" && (!body.postId || body.postId.trim().length < 4)) {
        return reply.status(400).send(failure("invalid_payload", "postId is required for post messages"));
      }
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        messageType,
        text: text.length ? text : null,
        photoUrl: body.photoUrl ?? null,
        gifUrl: body.gifUrl ?? null,
        gif: body.gif ?? null,
        postId: body.postId?.trim() ?? null,
        replyingToMessageId: body.replyingToMessageId ?? null,
        clientMessageId: body.clientMessageId ?? null
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
