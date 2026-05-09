import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { verifyViewerAuthHeader } from "../../auth/admin-access.js";
import {
  adminStagedReelsFinalizeContract,
  adminStagedReelsInitUploadContract,
  adminStagedReelsListContract,
  adminStagedReelsPatchContract,
  AdminStagedReelsFinalizeBodySchema,
  AdminStagedReelsInitUploadBodySchema,
  AdminStagedReelsPatchBodySchema,
  AdminStagedReelsPatchParamsSchema,
  REEL_STAGER_ADMIN_UID
} from "../../contracts/surfaces/admin-staged-reels.contract.js";
import { encodeGeohash } from "../../lib/latlng-geohash.js";
import { getFirebaseAdminFirestore } from "../../lib/firebase-admin.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { readWasabiConfigFromEnv, wasabiPublicUrlForKey } from "../../services/storage/wasabi-config.js";
import { presignWasabiPutObject } from "../../services/storage/wasabi-presign.service.js";

function normalizeExt(filename: string, mimeType: string): string {
  const fromName = path.extname(filename || "").replace(".", "").toLowerCase();
  if (fromName) return fromName;
  const suffix = mimeType.split("/")[1]?.toLowerCase() ?? "mp4";
  if (suffix.includes("quicktime")) return "mov";
  if (suffix.includes("x-m4v")) return "m4v";
  return suffix || "mp4";
}

function toEpochMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "object" && value !== null) {
    const candidate = value as { toMillis?: () => number };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
  }
  return null;
}

function buildObjectKey(adminUid: string, uploadId: string, filename: string, mimeType: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = normalizeExt(filename, mimeType);
  return `staged-reels/${adminUid}/${yyyy}/${mm}/${uploadId}/original.${ext}`;
}

async function requireReelStagerAdmin(request: FastifyRequest): Promise<
  | { ok: true; uid: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const authHeader = request.headers.authorization?.toString();
  try {
    const verified = await verifyViewerAuthHeader(authHeader);
    if (!verified?.uid) {
      return {
        ok: false,
        status: 401,
        code: "unauthorized",
        message: "Firebase bearer token is required"
      };
    }
    if (verified.uid !== REEL_STAGER_ADMIN_UID) {
      return {
        ok: false,
        status: 403,
        code: "forbidden",
        message: "Admin access required"
      };
    }
    return { ok: true, uid: verified.uid };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: error instanceof Error ? error.message : "Invalid auth token"
    };
  }
}

export async function registerV2AdminStagedReelsRoutes(app: FastifyInstance): Promise<void> {
  app.post(adminStagedReelsInitUploadContract.path, async (request, reply) => {
    setRouteName(adminStagedReelsInitUploadContract.routeName);
    const auth = await requireReelStagerAdmin(request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }

    const body = AdminStagedReelsInitUploadBodySchema.parse(request.body);
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply
        .status(503)
        .send(failure("object_storage_unavailable", "Wasabi configuration unavailable"));
    }
    const uploadId = randomUUID();
    const objectKey = buildObjectKey(auth.uid, uploadId, body.filename, body.mimeType);
    const presigned = await presignWasabiPutObject({
      key: objectKey,
      contentType: body.mimeType
    });
    if (!presigned.ok) {
      return reply.status(503).send(failure("object_storage_unavailable", presigned.message));
    }
    const canonicalUrl = wasabiPublicUrlForKey(cfg, objectKey);
    console.info("REEL_STAGER_BACKEND init-upload", {
      uid: auth.uid,
      uploadId,
      objectKey,
      sizeBytes: body.sizeBytes
    });
    return success({
      routeName: "admin.stagedreels.initupload.post" as const,
      uploadId,
      uploadUrl: presigned.uploadUrl,
      method: "PUT" as const,
      headers: {
        "Content-Type": body.mimeType
      },
      objectKey,
      bucket: presigned.bucket,
      canonicalUrl
    });
  });

  app.post(adminStagedReelsFinalizeContract.path, async (request, reply) => {
    setRouteName(adminStagedReelsFinalizeContract.routeName);
    const auth = await requireReelStagerAdmin(request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }
    const body = AdminStagedReelsFinalizeBodySchema.parse(request.body);

    const docId = body.uploadId;
    const db = getFirebaseAdminFirestore();
    const ref = db.collection("stagedReels").doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      return success({
        routeName: "admin.stagedreels.finalize.post" as const,
        stagedReel: existing.data()
      });
    }

    const geohash = encodeGeohash(body.location.lat, body.location.lng, 9);
    const now = FieldValue.serverTimestamp();
    const stagedReel = {
      id: docId,
      type: "stagedReel" as const,
      status: "staged" as const,
      createdAt: now,
      updatedAt: now,
      createdByUid: auth.uid,
      media: {
        kind: "video" as const,
        bucket: body.bucket,
        objectKey: body.objectKey,
        originalUrl: body.url,
        mimeType: body.media.mimeType,
        filename: body.media.filename,
        sizeBytes: body.media.sizeBytes,
        ...(typeof body.media.durationMs === "number" ? { durationMs: body.media.durationMs } : {}),
        ...(typeof body.media.width === "number" ? { width: body.media.width } : {}),
        ...(typeof body.media.height === "number" ? { height: body.media.height } : {}),
        source: "native-admin-reel-stager" as const,
        uploadId: body.uploadId
      },
      location: {
        lat: body.location.lat,
        lng: body.location.lng,
        ...(geohash ? { geohash } : {}),
        ...(body.location.address ? { address: body.location.address } : {}),
        ...(body.location.city ? { city: body.location.city } : {}),
        ...(body.location.region ? { region: body.location.region } : {}),
        ...(body.location.country ? { country: body.location.country } : {}),
        ...(body.location.placeName ? { placeName: body.location.placeName } : {}),
        source: body.location.source,
        ...(body.location.sourceAssetLocalId
          ? { sourceAssetLocalId: body.location.sourceAssetLocalId }
          : {}),
        ...(body.location.extractedAt ? { extractedAt: body.location.extractedAt } : {})
      },
      postDraft: {
        title: "",
        description: "",
        activities: [],
        visibility: "public" as const,
        postAsUserId: null,
        notes: ""
      },
      audit: {
        schemaVersion: 1 as const,
        createdFrom: "native-admin-reel-stager" as const,
        ...(process.env.npm_package_version
          ? { backendVersion: process.env.npm_package_version }
          : {}),
        clientPlatform: body.client.platform,
        finalizedAt: now
      }
    };
    await ref.set(stagedReel);
    console.info("REEL_STAGER_BACKEND finalize", {
      uid: auth.uid,
      stagedReelId: docId,
      objectKey: body.objectKey
    });
    const saved = await ref.get();
    return success({
      routeName: "admin.stagedreels.finalize.post" as const,
      stagedReel: saved.data()
    });
  });

  app.get(adminStagedReelsListContract.path, async (request, reply) => {
    setRouteName(adminStagedReelsListContract.routeName);
    const auth = await requireReelStagerAdmin(request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }
    const db = getFirebaseAdminFirestore();
    const snapshot = await db.collection("stagedReels").get();
    const stagedReels = snapshot.docs
      .map((doc) => doc.data())
      .sort((a, b) => (toEpochMs(b.createdAt) ?? 0) - (toEpochMs(a.createdAt) ?? 0));
    return success({
      routeName: "admin.stagedreels.list.get" as const,
      stagedReels
    });
  });

  app.patch(adminStagedReelsPatchContract.path, async (request, reply) => {
    setRouteName(adminStagedReelsPatchContract.routeName);
    const auth = await requireReelStagerAdmin(request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }
    const params = AdminStagedReelsPatchParamsSchema.parse(request.params);
    const body = AdminStagedReelsPatchBodySchema.parse(request.body);

    const db = getFirebaseAdminFirestore();
    const ref = db.collection("stagedReels").doc(params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return reply.status(404).send(failure("not_found", "staged reel not found"));
    }
    const current = snapshot.data() as {
      status?: string;
      postDraft?: Record<string, unknown>;
    };
    const updatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp()
    };
    if (body.status) updatePayload.status = body.status;
    if (body.postDraft) {
      updatePayload.postDraft = {
        ...(current?.postDraft ?? {}),
        ...body.postDraft
      };
    }
    await ref.set(updatePayload, { merge: true });
    const saved = await ref.get();
    console.info("REEL_STAGER_BACKEND patch", {
      uid: auth.uid,
      stagedReelId: params.id,
      fields: Object.keys(body)
    });
    return success({
      routeName: "admin.stagedreels.patch.patch" as const,
      stagedReel: saved.data()
    });
  });
}
