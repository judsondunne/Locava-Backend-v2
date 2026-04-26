import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { buildFinalizedSessionAssetPlan } from "../../services/storage/wasabi-presign.service.js";
import {
  getWasabiConfigOrNull,
  postSessionStagingObjectKeyForAsset,
  purgePostSessionStaging,
  unlinkQuiet,
  uploadPostSessionPosterFromBuffer,
  uploadPostSessionStagingFromDisk,
  uploadPostSessionStagingFromStream,
  waitForObjectKeys
} from "../../services/storage/wasabi-staging.service.js";
import {
  enrichPresignSlotsForLegacyCompat,
  presignPostSessionStagingBatch,
  type StagingPresignItem
} from "../../services/storage/wasabi-presign.service.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";

const MAX_STAGING_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const MONOLITH_CREATE_PATHS = [
  "/api/v1/product/upload/create-from-staged",
  "/api/v1/product/upload/create-from-metadata",
  "/api/v1/product/upload/create-with-files",
  "/api/v1/product/upload/create-with-files-async",
  "/api/v1/product/upload/create-from-commons-candidate",
  "/api/v1/product/upload/create-from-commons-review-queue-item",
  "/api/v1/product/upload/create-from-commons-review-group"
] as const;

function monolithUploadDisabledMessage(): {
  success: false;
  error: string;
} {
  return {
    success: false,
    error:
      "Post creation is served by the classic Locava API. Set LEGACY_MONOLITH_PROXY_BASE_URL to your v1 backend origin (same value as native monolith base URL) so create-from-staged / create-with-files forward there. Staging routes (presign, stage-asset) stay on Backendv2."
  };
}

/**
 * Native `/api/v1/product/upload/*` parity with Locava Backend v1: Wasabi staging, confirm, purge,
 * idempotency lookup. Post-creation is proxied separately when `LEGACY_MONOLITH_PROXY_BASE_URL` is set.
 */
export async function registerLegacyProductUploadRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  const monolithProxyEnabled = Boolean(env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim());

  if (!monolithProxyEnabled) {
    for (const p of MONOLITH_CREATE_PATHS) {
      app.post(p, async (_request, reply) => reply.status(503).send(monolithUploadDisabledMessage()));
    }
  }

  app.post("/api/v1/product/upload/stage-presign", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? "").trim();
    const rawItems = body.items ?? body.assets;
    if (!sessionId) {
      return reply.status(400).send({ success: false, error: "sessionId required" });
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return reply.status(400).send({
        success: false,
        error: "items[] required (send at least one { index, assetType })"
      });
    }
    if (rawItems.length > 40) {
      return reply.status(400).send({ success: false, error: "Too many assets" });
    }
    const normalized: Array<{ index: number; assetType: "photo" | "video" }> = [];
    for (const it of rawItems as Array<Record<string, unknown>>) {
      const idx = Number(it?.index ?? it?.assetIndex ?? 0);
      const atRaw = String(it?.assetType ?? it?.type ?? "").toLowerCase();
      const at = atRaw === "video" ? "video" : "photo";
      if (!Number.isFinite(idx) || idx < 0 || idx > 79) {
        return reply.status(400).send({ success: false, error: "Invalid index" });
      }
      normalized.push({ index: idx, assetType: at });
    }

    const itemsPayload: StagingPresignItem[] = [];
    for (let i = 0; i < normalized.length; i += 1) {
      const n = normalized[i]!;
      const raw = (rawItems as Array<Record<string, unknown>>)[i];
      const dk = typeof raw?.destinationKey === "string" ? raw.destinationKey.trim() : "";
      itemsPayload.push({
        index: n.index,
        assetType: n.assetType,
        ...(dk ? { destinationKey: dk } : {})
      });
    }

    const signed = await presignPostSessionStagingBatch(itemsPayload, sessionId);
    if (!signed.ok) {
      const status = signed.code === "not_configured" ? 503 : 500;
      return reply.status(status).send({ success: false, error: signed.message });
    }
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }
    const urls = enrichPresignSlotsForLegacyCompat(cfg, sessionId, signed.urls, normalized);
    return reply.send({ success: true, urls });
  });

  app.post<{ Body?: Record<string, unknown> }>("/api/v1/product/upload/staging/confirm", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    const body = request.body ?? {};
    const sessionId = String(body.sessionId ?? "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const useLegacyStagingKeys = Boolean(body.useLegacyStagingKeys);
    if (!sessionId) {
      return reply.status(400).send({ success: false, error: "sessionId required" });
    }
    if (items.length === 0) {
      return reply.status(400).send({ success: false, error: "items[] required" });
    }

    const cfg = getWasabiConfigOrNull();
    if (!cfg) {
      return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
    }

    const manifestKeys: string[] = [];
    for (const item of items as Array<Record<string, unknown>>) {
      const index = Number(item?.index);
      const assetTypeRaw = item?.assetType === "video" ? "video" : item?.assetType === "photo" ? "photo" : null;
      if (!Number.isFinite(index) || index < 0 || index > 79 || !assetTypeRaw) {
        return reply.status(400).send({ success: false, error: "Invalid staged items" });
      }
      if (useLegacyStagingKeys) {
        manifestKeys.push(postSessionStagingObjectKeyForAsset(viewerId, sessionId, index, assetTypeRaw));
      } else {
        const finalized = buildFinalizedSessionAssetPlan(cfg, sessionId, index, assetTypeRaw);
        manifestKeys.push(finalized.originalKey);
      }
    }

    const readyCheck = await waitForObjectKeys(cfg, manifestKeys);
    if (!readyCheck.success) {
      return reply.status(500).send({
        success: false,
        error: readyCheck.error || "Failed to confirm staged session"
      });
    }
    const readyKeys = new Set(readyCheck.presentKeys);
    const missingKeys = manifestKeys.filter((key) => !readyKeys.has(key));
    const ready = missingKeys.length === 0;
    return reply.send({
      success: true,
      ready,
      readyCount: readyKeys.size,
      expectedCount: manifestKeys.length,
      ...(ready ? {} : { missingKeys })
    });
  });

  app.delete<{ Params: { sessionId: string } }>(
    "/api/v1/product/upload/staging/:sessionId",
    async (request, reply) => {
      const sessionId = String(request.params.sessionId ?? "").trim();
      if (!sessionId) {
        return reply.status(400).send({ success: false, error: "sessionId required" });
      }
      const viewerId = resolveCompatViewerId(request);

      const cfg = getWasabiConfigOrNull();
      if (cfg && viewerId && viewerId !== "anonymous") {
        await purgePostSessionStaging(cfg, viewerId, sessionId);
      }

      const dir = path.join(os.tmpdir(), "locava-staging", sessionId);
      try {
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            fs.unlinkSync(path.join(dir, f));
          }
          fs.rmdirSync(dir);
        }
      } catch {
        /* best-effort — v1 also swallows */
      }

      return reply.send({ success: true });
    }
  );

  app.get("/api/v1/product/upload/post-by-idempotency", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const idempotencyKey = String((request.query as Record<string, unknown>)?.idempotencyKey ?? "").trim();
    if (!viewerId || viewerId === "anonymous" || !idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: "userId (from token) and idempotencyKey query param required"
      });
    }
    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send({ success: false, error: "Firestore unavailable" });
    }
    try {
      const idempotencyDocId = createHash("sha256")
        .update(`${viewerId}:${idempotencyKey}`)
        .digest("hex")
        .slice(0, 32);
      const snap = await db.collection("postIdempotency").doc(idempotencyDocId).get();
      if (!snap.exists) {
        return reply.status(404).send({ success: false, error: "Not found" });
      }
      const postId = (snap.data() as Record<string, unknown> | undefined)?.postId;
      if (typeof postId !== "string" || !postId) {
        return reply.status(404).send({ success: false, error: "Not found" });
      }
      return reply.send({ success: true, postId });
    } catch {
      return reply.status(500).send({ success: false, error: "Internal error" });
    }
  });

  await app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: {
        fileSize: MAX_STAGING_UPLOAD_BYTES,
        files: 2
      }
    });

    scoped.post("/api/v1/product/upload/stage-asset", async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      if (!viewerId || viewerId === "anonymous") {
        return reply.status(401).send({ success: false, error: "Unauthorized" });
      }
      const sessionId = String(request.headers["x-posting-session-id"] ?? "").trim();
      const assetIndexRaw = String(request.headers["x-asset-index"] ?? "").trim();
      if (!sessionId) {
        return reply.status(400).send({ success: false, error: "X-Posting-Session-Id required" });
      }
      const idx = parseInt(assetIndexRaw !== "" ? assetIndexRaw : "0", 10);
      if (!Number.isFinite(idx) || idx < 0 || idx > 79) {
        return reply.status(400).send({ success: false, error: "Invalid X-Asset-Index" });
      }
      const assetTypeHeader = String(request.headers["x-asset-type"] ?? "photo").toLowerCase();
      const assetTypeNorm: "photo" | "video" = assetTypeHeader === "video" ? "video" : "photo";
      const finalObjectKey = String(request.headers["x-final-object-key"] ?? "").trim();
      const finalContentType = String(request.headers["x-final-content-type"] ?? "").trim();

      const cfg = getWasabiConfigOrNull();
      if (!cfg) {
        return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
      }

      const files = await request.saveRequestFiles();
      try {
        const file = files.find((f) => f.fieldname === "file");
        if (!file?.filepath) {
          return reply.status(400).send({ success: false, error: "No file in request" });
        }
        const up = await uploadPostSessionStagingFromDisk(
          cfg,
          viewerId,
          sessionId,
          idx,
          assetTypeNorm,
          file.filepath,
          {
            destinationKey: finalObjectKey || undefined,
            contentType: finalContentType || undefined
          }
        );
        if (!up.success) {
          return reply.status(500).send({ success: false, error: up.error || "Wasabi staging upload failed" });
        }
        return reply.send({
          success: true,
          sessionId,
          assetIndex: String(idx),
          storage: "wasabi"
        });
      } finally {
        await request.cleanRequestFiles();
        for (const f of files) {
          if (f.filepath) await unlinkQuiet(f.filepath);
        }
      }
    });

    scoped.post("/api/v1/product/upload/stage-poster", async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      if (!viewerId || viewerId === "anonymous") {
        return reply.status(401).send({ success: false, error: "Unauthorized" });
      }
      const sessionId = String(request.headers["x-posting-session-id"] ?? "").trim();
      const assetIndexRaw = String(request.headers["x-asset-index"] ?? "").trim();
      if (!sessionId) {
        return reply.status(400).send({ success: false, error: "X-Posting-Session-Id required" });
      }
      const idx = parseInt(assetIndexRaw !== "" ? assetIndexRaw : "0", 10);
      if (!Number.isFinite(idx) || idx < 0 || idx > 79) {
        return reply.status(400).send({ success: false, error: "Invalid X-Asset-Index" });
      }
      const finalPosterKey = String(request.headers["x-final-poster-key"] ?? "").trim();

      const part = await request.file();
      if (!part) {
        return reply.status(400).send({ success: false, error: "No poster file in request" });
      }
      const buf = await part.toBuffer();
      if (!buf.length) {
        return reply.status(400).send({ success: false, error: "No poster file in request" });
      }

      const cfg = getWasabiConfigOrNull();
      if (!cfg) {
        return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
      }

      const up = await uploadPostSessionPosterFromBuffer(cfg, viewerId, sessionId, idx, buf, {
        destinationKey: finalPosterKey || undefined
      });
      if (!up.success) {
        return reply.status(500).send({
          success: false,
          error: up.error || "Wasabi staging poster upload failed"
        });
      }
      return reply.send({
        success: true,
        sessionId,
        assetIndex: String(idx),
        storage: "wasabi",
        kind: "poster"
      });
    });
  });

  await app.register(async (bin) => {
    bin.addContentTypeParser(
      /^video\/.+|application\/octet-stream/,
      { bodyLimit: MAX_STAGING_UPLOAD_BYTES },
      async (_req: FastifyRequest, payload: Readable) => payload
    );

    bin.post("/api/v1/product/upload/stage-asset-binary", async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      if (!viewerId || viewerId === "anonymous") {
        return reply.status(401).send({ success: false, error: "Unauthorized" });
      }
      const sessionId = String(request.headers["x-posting-session-id"] ?? "").trim();
      const assetIndexRaw = String(request.headers["x-asset-index"] ?? "").trim();
      const assetTypeHeader = String(request.headers["x-asset-type"] ?? "photo").toLowerCase();
      if (!sessionId) {
        return reply.status(400).send({ success: false, error: "X-Posting-Session-Id required" });
      }
      const idx = parseInt(assetIndexRaw || "0", 10);
      if (!Number.isFinite(idx) || idx < 0 || idx > 79) {
        return reply.status(400).send({ success: false, error: "Invalid X-Asset-Index" });
      }
      const assetTypeNorm: "photo" | "video" = assetTypeHeader === "video" ? "video" : "photo";
      const finalObjectKey = String(request.headers["x-final-object-key"] ?? "").trim();
      const finalContentType = String(request.headers["x-final-content-type"] ?? "").trim();
      const contentLengthRaw = request.headers["content-length"];
      const contentLength =
        typeof contentLengthRaw === "string" ? parseInt(contentLengthRaw, 10) : Number.NaN;

      const cfg = getWasabiConfigOrNull();
      if (!cfg) {
        return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
      }

      const bodyStream = request.body as NodeJS.ReadableStream | undefined;
      if (!bodyStream) {
        return reply.status(400).send({ success: false, error: "Empty body" });
      }

      const up = await uploadPostSessionStagingFromStream(
        cfg,
        viewerId,
        sessionId,
        idx,
        assetTypeNorm,
        bodyStream as import("node:stream").Readable,
        {
          contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
          contentType:
            finalContentType ||
            (typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : undefined),
          destinationKey: finalObjectKey || undefined
        }
      );
      if (!up.success) {
        return reply.status(500).send({ success: false, error: up.error || "Wasabi staging upload failed" });
      }
      return reply.send({
        success: true,
        sessionId,
        assetIndex: String(idx),
        storage: "wasabi"
      });
    });
  });
}
