import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { setRouteName } from "../../observability/request-context.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";
import { getWasabiConfigOrNull, uploadPostSessionStagingFromBuffer } from "../../services/storage/wasabi-staging.service.js";
import { wasabiPublicUrlForKey } from "../../services/storage/wasabi-config.js";

/**
 * Native chat: multipart `file` → public Wasabi URL.
 * Lives **outside** `ENABLE_LEGACY_COMPAT_ROUTES` (same idea as `profile-picture-upload.routes.ts`)
 * so production apps using only `/v2/*` still get chat attachments.
 *
 * Relies on the single app-level `@fastify/multipart` registration in `createApp.ts`.
 */
export async function registerNativeChatMediaUploadRoutes(app: FastifyInstance, _env: AppEnv): Promise<void> {
  app.post("/api/media/upload-photo", async (request, reply) => {
    setRouteName("compat.upload.chat-media.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    const part = await request.file();
    if (!part) {
      return reply.status(400).send({ success: false, error: "file required" });
    }
    const cfg = getWasabiConfigOrNull();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }
    const fileBuffer = await part.toBuffer();
    if (!fileBuffer.length) {
      return reply.status(400).send({ success: false, error: "empty file" });
    }
    const mimeRaw = typeof part.mimetype === "string" ? part.mimetype.toLowerCase() : "";
    const isPng = mimeRaw.includes("png");
    const isWebp = mimeRaw.includes("webp");
    const isVideo = mimeRaw.startsWith("video/");
    const ext: "jpg" | "png" | "webp" | "mp4" = isVideo ? "mp4" : isPng ? "png" : isWebp ? "webp" : "jpg";
    const destinationKey = `chatPhotos/${viewerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const contentType =
      part.mimetype?.trim() ||
      (isVideo ? "video/mp4" : isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg");
    const assetKind = isVideo ? "video" : "photo";
    const upload = await uploadPostSessionStagingFromBuffer(
      cfg,
      viewerId,
      `chat-media-${viewerId}`,
      0,
      assetKind,
      fileBuffer,
      { destinationKey, contentType }
    );
    if (!upload.success) {
      return reply.status(500).send({ success: false, error: upload.error ?? "chat_media_upload_failed" });
    }
    const url = wasabiPublicUrlForKey(cfg, destinationKey);
    return reply.send({ success: true, url });
  });
}
