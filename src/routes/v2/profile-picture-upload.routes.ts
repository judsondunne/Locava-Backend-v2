import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { AppEnv } from "../../config/env.js";
import { setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { mergeUserDocumentWritePayload } from "../../repositories/source-of-truth/user-document-firestore.adapter.js";
import { resolveCompatViewerId } from "../compat/resolve-compat-viewer-id.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { uploadUserProfilePicture } from "../../services/storage/wasabi-userpics.service.js";

/**
 * Native + web edit-profile: `POST /api/upload/profile-picture` (multipart field `file`).
 * Legacy monolith parity — implemented directly on Backendv2 so it works even when
 * `ENABLE_LEGACY_COMPAT_ROUTES` is false (that flag only gates the large compat stub bundle).
 *
 * Response: `{ success, url, profilePicUrl, storagePath, profilePicPath }` on success.
 */
export async function registerProfilePictureUploadRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 }
  });

  const db = env.FIRESTORE_SOURCE_ENABLED ? getFirestoreSourceClient() : null;

  app.post("/api/upload/profile-picture", async (request, reply) => {
    setRouteName("compat.upload.profile-picture.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }

    const part = await request.file();
    if (!part) {
      return reply.status(400).send({ success: false, error: "No file provided" });
    }

    const contentType = String(part.mimetype ?? "").trim() || "image/jpeg";
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(contentType.toLowerCase())) {
      return reply.status(400).send({ success: false, error: `Invalid file type (${contentType})` });
    }

    const bytes = await part.toBuffer();
    if (!bytes.length) {
      return reply.status(400).send({ success: false, error: "Empty file" });
    }

    const up = await uploadUserProfilePicture({ cfg, userId: viewerId, bytes, contentType });
    if (!up.ok) {
      return reply.status(500).send({ success: false, error: up.message });
    }

    if (db) {
      try {
        const payload = mergeUserDocumentWritePayload({
          profilePic: up.url,
          photoURL: up.url,
          avatarUrl: up.url,
          profilePicPath: up.key
        });
        await db.collection("users").doc(viewerId).set(payload, { merge: true });
      } catch {
        // Best-effort, matches v1 semantics when user doc doesn't exist yet.
      }
    }

    return reply.send({
      success: true,
      url: up.url,
      profilePicUrl: up.url,
      storagePath: up.key,
      profilePicPath: up.key
    });
  });
}
