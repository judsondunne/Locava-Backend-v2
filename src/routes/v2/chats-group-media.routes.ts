import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import type { AppEnv } from "../../config/env.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ChatsRepositoryError, chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { uploadGroupChatAvatar, uploadGroupChatPhoto } from "../../services/storage/wasabi-chat-photos.service.js";

const ConversationParamsSchema = z.object({
  conversationId: z.string().min(1)
});

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

async function readImageUploadPart(request: FastifyRequest & { file: () => Promise<any> }) {
  const part = await request.file();
  if (!part) return { ok: false as const, statusCode: 400, message: "No file provided" };
  const contentType = String(part.mimetype ?? "").trim().toLowerCase() || "image/jpeg";
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return { ok: false as const, statusCode: 400, message: `Invalid file type (${contentType})` };
  }
  const bytes = await part.toBuffer();
  if (!bytes.length) return { ok: false as const, statusCode: 400, message: "Empty file" };
  return { ok: true as const, bytes, contentType };
}

export async function registerV2ChatsGroupMediaRoutes(app: FastifyInstance, _env: AppEnv): Promise<void> {
  const service = new ChatsService(chatsRepository);

  app.post("/v2/chats/group-avatar-upload", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    setRouteName("chats.group_avatar_upload.post");
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }
    const part = await readImageUploadPart(request);
    if (!part.ok) {
      return reply.status(part.statusCode).send({ success: false, error: part.message });
    }
    const uploaded = await uploadGroupChatAvatar({
      cfg,
      viewerId: viewer.viewerId,
      bytes: part.bytes,
      contentType: part.contentType
    });
    if (!uploaded.ok) {
      return reply.status(500).send({ success: false, error: uploaded.message });
    }
    return reply.send({
      success: true,
      displayPhotoUrl: uploaded.url,
      storagePath: uploaded.key
    });
  });

  app.post("/v2/chats/:conversationId/group-photo", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Chats v2 surface is not enabled for this viewer"));
    }
    const params = ConversationParamsSchema.parse(request.params);
    setRouteName("chats.group_photo_upload.post");
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }
    const part = await readImageUploadPart(request);
    if (!part.ok) {
      return reply.status(part.statusCode).send({ success: false, error: part.message });
    }
    const uploaded = await uploadGroupChatPhoto({
      cfg,
      viewerId: viewer.viewerId,
      conversationId: params.conversationId,
      bytes: part.bytes,
      contentType: part.contentType
    });
    if (!uploaded.ok) {
      return reply.status(500).send({ success: false, error: uploaded.message });
    }
    try {
      const result = await service.updateGroupMetadata({
        viewerId: viewer.viewerId,
        conversationId: params.conversationId,
        displayPhotoURL: uploaded.url
      });
      const invalidation = await invalidateEntitiesForMutation({
        mutationType: "chat.sendtext",
        viewerId: viewer.viewerId,
        conversationId: params.conversationId
      });
      return reply.send({
        success: true,
        conversationId: result.conversationId,
        displayPhotoUrl: uploaded.url,
        storagePath: uploaded.key,
        invalidation: {
          invalidatedKeysCount: invalidation.invalidatedKeys.length,
          invalidationTypes: invalidation.invalidationTypes
        }
      });
    } catch (error) {
      if (error instanceof ChatsRepositoryError && error.code === "conversation_not_found") {
        return reply.status(404).send({ success: false, error: error.message });
      }
      if (error instanceof ChatsRepositoryError && error.code === "not_group_chat") {
        return reply.status(400).send({ success: false, error: error.message });
      }
      throw error;
    }
  });
}
