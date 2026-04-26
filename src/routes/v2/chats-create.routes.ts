import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ChatsCreateGroupBodySchema,
  chatsCreateGroupContract
} from "../../contracts/surfaces/chats-create-group.contract.js";
import {
  ChatsCreateOrGetBodySchema,
  chatsCreateOrGetContract
} from "../../contracts/surfaces/chats-create-or-get.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";

export async function registerV2ChatsCreateRoutes(app: FastifyInstance): Promise<void> {
  const service = new ChatsService(chatsRepository);

  app.post(chatsCreateOrGetContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const body = ChatsCreateOrGetBodySchema.parse(request.body);
    setRouteName(chatsCreateOrGetContract.routeName);
    const payload = await service.createOrGetDirectConversation({
      viewerId: viewer.viewerId,
      otherUserId: body.otherUserId
    });
    return success({
      routeName: chatsCreateOrGetContract.routeName,
      conversationId: payload.conversationId,
      created: payload.created
    });
  });

  app.post(chatsCreateGroupContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const body = ChatsCreateGroupBodySchema.parse(request.body);
    setRouteName(chatsCreateGroupContract.routeName);
    const payload = await service.createGroupConversation({
      viewerId: viewer.viewerId,
      participantIds: body.participants,
      groupName: body.groupName,
      displayPhotoUrl: body.displayPhotoURL ?? null
    });
    return success({
      routeName: chatsCreateGroupContract.routeName,
      conversationId: payload.conversationId
    });
  });
}
