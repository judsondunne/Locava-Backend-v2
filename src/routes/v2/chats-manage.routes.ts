import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { chatsDeleteContract } from "../../contracts/surfaces/chats-delete.contract.js";
import {
  ChatsUpdateGroupBodySchema,
  ChatsUpdateGroupParamsSchema,
  chatsUpdateGroupContract
} from "../../contracts/surfaces/chats-update-group.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

const ConversationParamsSchema = z.object({
  conversationId: z.string().min(1)
});
const DeleteMessageParamsSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1)
});

const TypingBodySchema = z.object({
  isTyping: z.boolean()
});

export async function registerV2ChatsManageRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);

  app.post(chatsUpdateGroupContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ChatsUpdateGroupParamsSchema.parse(request.params);
    const body = ChatsUpdateGroupBodySchema.parse(request.body ?? {});
    setRouteName(chatsUpdateGroupContract.routeName);
    try {
      const result = await service.updateGroupMetadata({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        ...(typeof body.groupName === "string" ? { groupName: body.groupName } : {}),
        ...(body.displayPhotoURL !== undefined ? { displayPhotoURL: body.displayPhotoURL } : {})
      });
      return success({
        routeName: "chats.updategroup.post" as const,
        conversationId: result.conversationId,
        groupName: result.groupName,
        displayPhotoURL: result.displayPhotoURL
      });
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send(failure("conversation_not_found", error.message));
      }
      if (error instanceof ChatsRepositoryError && error.code === "not_group_chat") {
        return reply.status(400).send(failure("not_group_chat", error.message));
      }
      throw error;
    }
  });

  app.delete(chatsDeleteContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ConversationParamsSchema.parse(request.params);
    setRouteName(chatsDeleteContract.routeName);
    try {
      // invalidation: deleting a conversation invalidates inbox ordering and thread detail caches.
      const result = await service.deleteConversation({ viewerId: viewer.viewerId, conversationId: params.conversationId });
      return success({ routeName: chatsDeleteContract.routeName, ...result });
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send(failure("conversation_not_found", error.message));
      }
      throw error;
    }
  });

  app.put("/v2/chats/:conversationId/typing-status", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ConversationParamsSchema.parse(request.params);
    const body = TypingBodySchema.parse(request.body);
    setRouteName("chats.typing.put");
    // invalidation: typing updates are ephemeral thread state updates, not durable inbox mutations.
    return success({
      routeName: "chats.typing.put",
      conversationId: params.conversationId,
      isTyping: body.isTyping
    });
  });

  app.delete("/v2/chats/:conversationId/messages/:messageId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = DeleteMessageParamsSchema.parse(request.params);
    setRouteName("chats.message.delete");
    try {
      // invalidation: deleting a message invalidates thread message pages and inbox last-message projections.
      const result = await service.deleteMessage({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        messageId: params.messageId
      });
      const invalidation = await invalidateEntitiesForMutation({
        mutationType: "chat.message.delete",
        viewerId: viewer.viewerId,
        conversationId: params.conversationId
      });
      return success({
        routeName: "chats.message.delete",
        ...result,
        invalidation: {
          invalidatedKeysCount: invalidation.invalidatedKeys.length,
          invalidationTypes: invalidation.invalidationTypes
        }
      });
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send(failure("conversation_not_found", error.message));
      }
      throw error;
    }
  });
}
