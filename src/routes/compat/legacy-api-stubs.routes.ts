import type { FastifyInstance, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import type { AppEnv } from "../../config/env.js";
import type { ProductCompatViewer } from "./compat-viewer-payload.js";
import { buildProductCompatViewer } from "./compat-viewer-payload.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";
import { collectionTelemetryRepository } from "../../repositories/surfaces/collection-telemetry.repository.js";
import { feedSeenRepository } from "../../repositories/surfaces/feed-seen.repository.js";
import { mutationStateRepository } from "../../repositories/mutations/mutation-state.repository.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { mergeUserDocumentWritePayload } from "../../repositories/source-of-truth/user-document-firestore.adapter.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { readMaybeMillis } from "../../repositories/source-of-truth/post-firestore-projection.js";
import { getWasabiConfigOrNull, uploadPostSessionStagingFromBuffer } from "../../services/storage/wasabi-staging.service.js";
import { readWasabiConfigFromEnv, wasabiPublicUrlForKey } from "../../services/storage/wasabi-config.js";
import { mapV2NotificationListToLegacyItems } from "./map-v2-notification-to-legacy-product.js";
import { postingMutationRepository } from "../../repositories/mutations/posting-mutation.repository.js";
import { CompatPostsBatchOrchestrator } from "../../orchestration/compat/posts-batch.orchestrator.js";
import { CompatUserFullOrchestrator } from "../../orchestration/compat/user-full.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";
import { userActivityRepository } from "../../repositories/surfaces/user-activity.repository.js";
import { UserActivityService } from "../../services/surfaces/user-activity.service.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { uploadGroupChatAvatar, uploadGroupChatPhoto } from "../../services/storage/wasabi-chat-photos.service.js";

function applyViewerPatch(base: ProductCompatViewer, patch: Record<string, unknown>): ProductCompatViewer {
  const next: ProductCompatViewer = { ...base };
  if (typeof patch.name === "string") next.name = patch.name;
  if (typeof patch.handle === "string") next.handle = patch.handle;
  if (typeof patch.profilePic === "string") next.profilePic = patch.profilePic;
  if (typeof patch.bio === "string") next.bio = patch.bio;
  if (patch.permissions && typeof patch.permissions === "object" && patch.permissions !== null) {
    next.permissions = {
      ...(base.permissions ?? {}),
      ...(patch.permissions as Record<string, boolean>)
    };
  }
  if (patch.settings && typeof patch.settings === "object" && patch.settings !== null) {
    next.settings = {
      ...(base.settings ?? {}),
      ...(patch.settings as Record<string, unknown>)
    };
  }
  return next;
}

function normalizeCompatPostRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  for (const key of ["time", "time-created", "createdAt", "lastUpdated", "updatedAt", "updatedAtMs", "createdAtMs"]) {
    const millis = readMaybeMillis(next[key]);
    if (millis != null) {
      next[key] = millis;
    }
  }
  return next;
}

/**
 * Legacy-shaped HTTP endpoints used when `EXPO_PUBLIC_BACKEND_URL` points at Backendv2.
 * Several paths forward to canonical `/v2/*` routes or Firestore. Product upload staging lives in
 * `legacy-product-upload.routes.ts` (+ optional monolith proxy for create-from-staged).
 */
export async function registerLegacyApiStubRoutes(app: FastifyInstance, _env: AppEnv): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 }
  });
  const db = _env.FIRESTORE_SOURCE_ENABLED ? getFirestoreSourceClient() : null;
  const userActivityService = new UserActivityService(userActivityRepository);
  const chatsService = new ChatsService(chatsRepository);
  const collectionsAdapter = new CollectionsFirestoreAdapter();
  const postsBatchOrchestrator = new CompatPostsBatchOrchestrator();
  const userFullOrchestrator = new CompatUserFullOrchestrator();
  const profileRepository = new ProfileRepository();
  const userFullCache = new Map<string, { expiresAtMs: number; payload: { success: true; userData: Record<string, unknown> } }>();
  const STORY_USERS_CACHE_TTL_MS = 60_000;
  const storyFollowingCache = new Map<string, { expiresAtMs: number; ids: string[] }>();
  const storyRecentPostsCache = new Map<
    string,
    {
      expiresAtMs: number;
      rows: Array<{ userId: string; postId: string; thumbUrl: string }>;
    }
  >();

  /** `POST /api/upload/profile-picture` is registered globally in `profile-picture-upload.routes.ts` (always on). */

  async function loadFollowingIdsCached(viewerId: string): Promise<string[]> {
    const cached = storyFollowingCache.get(viewerId);
    if (cached && cached.expiresAtMs > Date.now()) return cached.ids;
    const ids = await loadFollowingIds(viewerId);
    storyFollowingCache.set(viewerId, { expiresAtMs: Date.now() + STORY_USERS_CACHE_TTL_MS, ids });
    return ids;
  }

  async function loadRecentPostsForStoryUsers(): Promise<Array<{ userId: string; postId: string; thumbUrl: string }>> {
    if (!db) return [];
    const cacheKey = "global";
    const cached = storyRecentPostsCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) return cached.rows;
    const snap = await db.collection("posts").orderBy("time", "desc").limit(600).get();
    const rows: Array<{ userId: string; postId: string; thumbUrl: string }> = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const userId = String(data.userId ?? "").trim();
      if (!userId) continue;
      const postId = String(data.postId ?? doc.id).trim();
      if (!postId) continue;
      const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();
      rows.push({ userId, postId, thumbUrl });
    }
    storyRecentPostsCache.set(cacheKey, { expiresAtMs: Date.now() + STORY_USERS_CACHE_TTL_MS, rows });
    return rows;
  }
  type MixSpec = {
    kind: "mix_spec_v1";
    id: string;
    type: "activity_mix";
    specVersion: 1;
    seeds: { primaryActivityId: string; secondaryActivityIds?: string[] };
    title: string;
    subtitle: string;
    coverSpec: { kind: "thumb_collage"; maxTiles: number };
    geoMode: "none" | "viewer";
    personalizationMode: "taste_blended_v1";
    rankingMode: "mix_v1";
    geoBucketKey: string;
    heroQuery?: string;
    cacheKeyVersion: number;
  };
  const MIX_BOOTSTRAP_CACHE_TTL_MS = 60_000;
  const mixBootstrapCache = new Map<string, { expiresAt: number; payload: { success: true; collections: Array<Record<string, unknown>> } }>();
  const mixBootstrapInFlight = new Map<string, Promise<{ success: true; collections: Array<Record<string, unknown>> }>>();
  const ACTIVITY_POSTS_CACHE_TTL_MS = 45_000;
  const activityPostsCache = new Map<
    string,
    { expiresAt: number; payload: { success: true; posts: Array<Record<string, unknown>>; nextCursor: string | null; hasMore: boolean } }
  >();
  const viewerCoordsCache = new Map<string, { expiresAtMs: number; lat: number; lng: number }>();
  const VIEWER_COORDS_TTL_MS = 2 * 60_000;

  function noteViewerCoords(viewerId: string, lat?: number, lng?: number): void {
    if (!viewerId) return;
    if (!(typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng))) return;
    viewerCoordsCache.set(viewerId, { expiresAtMs: Date.now() + VIEWER_COORDS_TTL_MS, lat, lng });
  }

  function getViewerCoordsFallback(viewerId: string): { lat: number; lng: number } | null {
    const cached = viewerCoordsCache.get(viewerId);
    if (!cached) return null;
    if (cached.expiresAtMs <= Date.now()) {
      viewerCoordsCache.delete(viewerId);
      return null;
    }
    return { lat: cached.lat, lng: cached.lng };
  }

  async function loadUsersByIds(userIds: string[]): Promise<Array<Record<string, unknown>>> {
    const uniqueIds = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (uniqueIds.length === 0) return [];
    if (!db) return [];

    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < uniqueIds.length; i += 10) {
      const chunk = uniqueIds.slice(i, i + 10);
      const snap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
      const byId = new Map<string, Record<string, unknown>>();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const handleRaw = String(data.handle ?? "").replace(/^@+/, "").trim();
        const nameRaw = String(data.name ?? data.displayName ?? "").trim();
        const profilePicRaw = String(data.profilePic ?? data.profilePicture ?? data.photo ?? "").trim();
        byId.set(doc.id, {
          id: doc.id,
          userId: doc.id,
          name: nameRaw || `User ${doc.id.slice(0, 8)}`,
          handle: handleRaw || `user_${doc.id.slice(0, 8)}`,
          profilePic: profilePicRaw
        });
      }
      for (const id of chunk) {
        const row = byId.get(id);
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  async function loadFollowingIds(userId: string): Promise<string[]> {
    if (!db) return [];
    const snap = await db.collection("users").doc(userId).collection("following").limit(400).get();
    return snap.docs.map((doc) => doc.id);
  }

  async function loadConnectionList(
    userId: string,
    kind: "followers" | "following",
    page: number,
    limit: number
  ): Promise<{ users: Array<Record<string, unknown>>; total: number }> {
    if (!db) return { users: [], total: 0 };
    const coll = kind === "followers" ? "followers" : "following";
    const snap = await db.collection("users").doc(userId).collection(coll).limit(500).get();
    const ids = snap.docs.map((doc) => doc.id);
    const start = Math.max(0, (page - 1) * limit);
    const pageIds = ids.slice(start, start + limit);
    const users = await loadUsersByIds(pageIds);
    return { users, total: ids.length };
  }

  async function loadRecentPosts(limit: number): Promise<Array<Record<string, unknown>>> {
    if (!db) return [];
    const snap = await db
      .collection("posts")
      .orderBy("time", "desc")
      .limit(Math.max(1, Math.min(80, limit)))
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        postId: doc.id,
        userId: String(data.userId ?? ""),
        title: String(data.title ?? ""),
        activities: Array.isArray(data.activities) ? data.activities : [],
        thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),
        displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")
      };
    });
  }

  async function loadTopActivities(limit = 8): Promise<string[]> {
    if (!db) return [];
    const snap = await db.collection("posts").orderBy("time", "desc").limit(400).get();
    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const row = doc.data() as Record<string, unknown>;
      const activities = Array.isArray(row.activities) ? row.activities : [];
      for (const raw of activities) {
        const activity = String(raw ?? "").trim().toLowerCase();
        if (!activity) continue;
        counts.set(activity, (counts.get(activity) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([activity]) => activity);
  }

  app.get<{ Params: { postId: string } }>("/api/posts/:postId", async (request, reply) => {
    const postId = String(request.params.postId ?? "").trim();
    if (!postId) {
      return reply.status(400).send({ success: false, error: "postId required" });
    }
    const viewerId = resolveCompatViewerId(request);
    const classifyFirestoreError = (error: unknown): {
      code: string;
      isFailedPrecondition: boolean;
      message: string;
    } => {
      const fallback = {
        code: "unknown",
        isFailedPrecondition: false,
        message: error instanceof Error ? error.message : String(error),
      };
      if (!error || typeof error !== "object") return fallback;
      const candidate = error as { code?: unknown; message?: unknown };
      const rawCode = String(candidate.code ?? "").trim();
      const message = String(candidate.message ?? fallback.message);
      const isFailedPrecondition =
        rawCode === "9" ||
        rawCode.toLowerCase() === "failed-precondition" ||
        message.toLowerCase().includes("failed_precondition");
      return {
        code: rawCode || "unknown",
        isFailedPrecondition,
        message,
      };
    };

    let row: Record<string, unknown> | null = null;
    let source:
      | "posts_collection"
      | "posting_operation_state_fallback"
      | "not_found" = "not_found";
    let topLevelPostExists = false;
    let operationFallbackAttempted = false;
    let operationFallbackHit = false;

    if (db) {
      try {
        const topLevelSnap = await db.collection("posts").doc(postId).get();
        topLevelPostExists = topLevelSnap.exists;
        if (topLevelSnap.exists) {
          row = normalizeCompatPostRow(topLevelSnap.data() as Record<string, unknown>);
          source = "posts_collection";
        }
      } catch (error) {
        const classified = classifyFirestoreError(error);
        request.log.error(
          {
            routeName: "compat.api.posts.detail",
            postId,
            viewerId,
            step: "posts_collection_doc_lookup",
            collection: "posts",
            lookupType: "doc",
            firestoreErrorCode: classified.code,
            firestoreErrorMessage: classified.message,
            isFailedPrecondition: classified.isFailedPrecondition,
          },
          "compat post lookup failed",
        );
        return reply.status(500).send({
          success: false,
          error: "post_lookup_failed",
          diagnostics: {
            routeName: "compat.api.posts.detail",
            postId,
            viewerId,
            step: "posts_collection_doc_lookup",
            firestoreErrorCode: classified.code,
            isFailedPrecondition: classified.isFailedPrecondition,
          },
        });
      }
    }

    // Deterministic fallback aligned with finalize source-of-truth operation state.
    if (!row) {
      operationFallbackAttempted = true;
      try {
        const operation = await postingMutationRepository.getPostingOperationByPostId({
          viewerId,
          postId
        });
        if (operation) {
          operationFallbackHit = true;
          row = {
            postId,
            userId: operation.viewerId,
            content: "",
            title: "",
            activities: [],
            lat: 0,
            long: 0,
            address: "",
            privacy: "Public Spot",
            assetsReady: false,
            sessionId: operation.sessionId,
            operationId: operation.operationId,
            operationState: operation.state,
            operationTerminalReason: operation.terminalReason,
            time: operation.updatedAtMs || operation.createdAtMs,
            createdAt: operation.createdAtMs,
            likesCount: 0,
            commentsCount: 0
          };
          source = "posting_operation_state_fallback";
        }
      } catch (error) {
        request.log.warn(
          {
            routeName: "compat.api.posts.detail",
            postId,
            viewerId,
            step: "posting_operation_state_lookup",
            error: error instanceof Error ? error.message : String(error),
            fallbackNonFatal: true,
          },
          "compat operation fallback lookup failed",
        );
      }
    }
    if (!row) {
      if (!db) {
        return reply.status(503).send({
          success: false,
          error: "Firestore unavailable",
          diagnostics: {
            routeName: "compat.api.posts.detail",
            postId,
            viewerId,
            source,
            topLevelPostExists,
            operationFallbackAttempted,
            operationFallbackHit,
            reason: "firestore_unavailable"
          },
        });
      }
      request.log.warn(
        {
          routeName: "compat.api.posts.detail",
          postId,
          viewerId,
          topLevelPostExists,
          operationFallbackAttempted,
          operationFallbackHit,
        },
        "compat post lookup not found",
      );
      return reply.status(404).send({
        success: false,
        error: "post_not_found",
        diagnostics: {
          routeName: "compat.api.posts.detail",
          postId,
          viewerId,
          firestore: "ok",
          source,
          topLevelPostExists,
          operationFallbackAttempted,
          operationFallbackHit,
          reason: "canonical_post_missing",
        },
      });
    }
    return reply.send({
      success: true,
      post: {
        id: postId,
        postId,
        ...row,
      },
      postData: {
        id: postId,
        postId,
        ...row,
      },
      diagnostics: {
        routeName: "compat.api.posts.detail",
        source,
        topLevelPostExists,
        operationFallbackAttempted,
        operationFallbackHit,
      },
    });
  });

  // Native legacy profile likes tab expects this legacy endpoint even when pointed at Backendv2.
  app.get("/api/profile/me/liked-posts", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    const rawLimit = Number((request.query as { limit?: unknown }).limit ?? 24);
    const limit = Number.isFinite(rawLimit) ? Math.min(48, Math.max(1, Math.floor(rawLimit))) : 24;
    const cursorRaw = (request.query as { cursor?: unknown }).cursor;
    const cursor = typeof cursorRaw === "string" && cursorRaw.trim().length > 0 ? cursorRaw.trim() : null;
    try {
      const page = await profileRepository.getMyLikedPosts({ viewerId, cursor, limit });
      return reply.send({
        success: true,
        posts: page.posts,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        serverTsMs: page.serverTsMs
      });
    } catch (error) {
      request.log.error(
        {
          routeName: "compat.api.profile.me.liked-posts",
          viewerId,
          error: error instanceof Error ? error.message : String(error)
        },
        "compat liked posts failed"
      );
      return reply.status(503).send({ success: false, error: "upstream_unavailable" });
    }
  });

  app.post<{ Body: { postIds?: unknown } }>("/api/posts/batch", async (request, reply) => {
    const raw = (request.body as Record<string, unknown> | undefined)?.postIds;
    const postIds = Array.isArray(raw) ? raw.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
    if (postIds.length === 0) {
      return reply.status(400).send({ success: false, error: "postIds required" });
    }
    try {
      const payload = await postsBatchOrchestrator.run({ postIds });
      return reply.send(payload);
    } catch {
      return reply.status(503).send({ success: false, error: "upstream_unavailable" });
    }
  });

  /**
   * Native report sheet expects the classic monolith endpoint even when pointed at Backendv2:
   * `POST /api/reports/post` → { success: true, reportId }
   *
   * Persist to Firestore collection `reportedPosts` with the same fields as Backend v1.
   */
  app.post<{
    Body: {
      postId?: unknown;
      reason?: unknown;
      category?: unknown;
      severity?: unknown;
      additionalDetails?: unknown;
    };
  }>("/api/reports/post", async (request, reply) => {
    setRouteName("compat.reports.post.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "User not authenticated" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const postId = typeof body.postId === "string" ? body.postId.trim() : String(body.postId ?? "").trim();
    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!postId || !reason) {
      return reply.status(400).send({ success: false, error: "Post ID and reason are required" });
    }

    const allowedCategories = ["spam", "inappropriate", "harassment", "violence", "copyright", "other"] as const;
    const allowedSeverities = ["low", "medium", "high", "critical"] as const;
    const categoryRaw = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
    const severityRaw = typeof body.severity === "string" ? body.severity.trim().toLowerCase() : "";
    const category = (allowedCategories as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
    const severity = (allowedSeverities as readonly string[]).includes(severityRaw) ? severityRaw : "medium";
    const additionalDetails = typeof body.additionalDetails === "string" ? body.additionalDetails : "";

    if (!db) {
      return reply.status(201).send({ success: true, reportId: `mock-report-${Date.now()}` });
    }

    try {
      const docRef = await db.collection("reportedPosts").add({
        postId,
        reason,
        reporterId: viewerId,
        reportedAt: FieldValue.serverTimestamp(),
        status: "pending",
        severity,
        category,
        additionalDetails
      });
      incrementDbOps("writes", 1);
      return reply.status(201).send({ success: true, reportId: docRef.id });
    } catch (error) {
      request.log.error(
        { routeName: "compat.reports.post.post", viewerId, postId, error: error instanceof Error ? error.message : String(error) },
        "compat report post failed"
      );
      return reply.status(500).send({ success: false, error: "Failed to report post" });
    }
  });

  /**
   * Legacy route parity for place reporting:
   * `POST /api/reports/place` → { success: true, reportId }
   */
  app.post<{
    Body: {
      placeId?: unknown;
      reason?: unknown;
      category?: unknown;
      severity?: unknown;
      additionalDetails?: unknown;
    };
  }>("/api/reports/place", async (request, reply) => {
    setRouteName("compat.reports.place.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "User not authenticated" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : String(body.placeId ?? "").trim();
    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!placeId || !reason) {
      return reply.status(400).send({ success: false, error: "Place ID and reason are required" });
    }

    const allowedCategories = ["spam", "inappropriate", "harassment", "violence", "copyright", "other"] as const;
    const allowedSeverities = ["low", "medium", "high", "critical"] as const;
    const categoryRaw = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
    const severityRaw = typeof body.severity === "string" ? body.severity.trim().toLowerCase() : "";
    const category = (allowedCategories as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
    const severity = (allowedSeverities as readonly string[]).includes(severityRaw) ? severityRaw : "medium";
    const additionalDetails = typeof body.additionalDetails === "string" ? body.additionalDetails : "";

    if (!db) {
      return reply.status(201).send({ success: true, reportId: `mock-place-report-${Date.now()}` });
    }

    try {
      const docRef = await db.collection("reportedPlaces").add({
        placeId,
        reason,
        reporterId: viewerId,
        reportedAt: FieldValue.serverTimestamp(),
        status: "pending",
        severity,
        category,
        additionalDetails
      });
      incrementDbOps("writes", 1);
      return reply.status(201).send({ success: true, reportId: docRef.id });
    } catch (error) {
      request.log.error(
        {
          routeName: "compat.reports.place.post",
          viewerId,
          placeId,
          error: error instanceof Error ? error.message : String(error)
        },
        "compat report place failed"
      );
      return reply.status(500).send({ success: false, error: "Failed to report place" });
    }
  });

  app.get("/api/config/video-compression", async (request, reply) => {
    const fileSizeRaw = Number((request.query as { fileSizeBytes?: string | number }).fileSizeBytes ?? 0);
    const assetTypeRaw = String((request.query as { assetType?: string }).assetType ?? "video").toLowerCase();
    const minimumFileSizeForCompress = assetTypeRaw === "video" ? 200 * 1024 * 1024 : 0;
    return reply.send({
      maxSize: 2560,
      compressionMethod: "auto",
      minimumFileSizeForCompress:
        Number.isFinite(fileSizeRaw) && fileSizeRaw > minimumFileSizeForCompress
          ? minimumFileSizeForCompress
          : minimumFileSizeForCompress,
    });
  });

  app.get("/api/config/post-flow", async (_request, reply) => {
    return reply.send({
      success: true,
      flowVersion: "legacy_compat_v1",
      enableV2Finalize: true,
      finalizeMode: "metadata_commit",
      pollPath: "/api/posts/:postId",
      pollExpectedStatus: [200, 404],
    });
  });

  function decodeStoryCursor(raw: unknown): number {
    if (typeof raw !== "string" || !raw.trim()) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { offset?: number };
      const offset = Number(parsed.offset ?? 0);
      if (!Number.isFinite(offset) || offset < 0) return 0;
      return Math.floor(offset);
    } catch {
      return 0;
    }
  }

  function encodeStoryCursor(offset: number): string | null {
    if (!Number.isFinite(offset) || offset <= 0) return null;
    return Buffer.from(JSON.stringify({ offset: Math.floor(offset) }), "utf8").toString("base64url");
  }

  async function loadSearchStoryUsersPage(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
    seenPostIds?: string[];
    suggestedUserIds?: string[];
  }): Promise<{ storyUsers: Array<Record<string, unknown>>; nextCursor: string | null }> {
    if (!db) return { storyUsers: [], nextCursor: null };
    const safeLimit = Math.max(1, Math.min(24, Number(input.limit) || 10));
    const offset = decodeStoryCursor(input.cursor);
    const seenPostIds = new Set((input.seenPostIds ?? []).map((id) => String(id).trim()).filter(Boolean));
    const suggestedUserIds = (input.suggestedUserIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    const followingIds = await loadFollowingIdsCached(input.viewerId);
    const candidateUserIds = new Set<string>([...followingIds, ...suggestedUserIds].filter(Boolean));

    const recentPosts = await loadRecentPostsForStoryUsers();
    // Fallback candidate pool: most recent posters if social graph is sparse.
    if (candidateUserIds.size === 0) {
      for (const row of recentPosts.slice(0, 250)) {
        if (row.userId) candidateUserIds.add(row.userId);
      }
    }

    const latestByUser = new Map<string, { postId: string; thumbUrl: string }>();
    for (const row of recentPosts) {
      const userId = row.userId;
      if (!userId || !candidateUserIds.has(userId) || latestByUser.has(userId)) continue;
      if (!row.postId || seenPostIds.has(row.postId)) continue;
      latestByUser.set(userId, { postId: row.postId, thumbUrl: row.thumbUrl });
      if (latestByUser.size >= Math.max(140, offset + safeLimit + 24)) break;
    }

    const orderedUserIds = [...latestByUser.keys()];
    const pagedUserIds = orderedUserIds.slice(offset, offset + safeLimit);
    if (pagedUserIds.length === 0) return { storyUsers: [], nextCursor: null };
    const users = await loadUsersByIds(pagedUserIds);
    const userById = new Map(users.map((u) => [String(u.userId ?? u.id), u] as const));
    const storyUsers: Array<Record<string, unknown>> = [];
    for (const userId of pagedUserIds) {
      const profile = userById.get(userId);
      const post = latestByUser.get(userId);
      if (!profile || !post) continue;
      storyUsers.push({
        user: {
          id: String(profile.userId ?? profile.id ?? userId),
          handle: String(profile.handle ?? ""),
          name: String(profile.name ?? ""),
          profilePic: String(profile.profilePic ?? ""),
        },
        recentPost: {
          postId: post.postId,
          thumbUrl: post.thumbUrl,
        },
      });
    }
    const nextOffset = offset + safeLimit;
    const nextCursor = nextOffset < orderedUserIds.length ? encodeStoryCursor(nextOffset) : null;
    return { storyUsers, nextCursor };
  }

  function buildSearchMixSpecs(activities: string[]): MixSpec[] {
    const defs = activities.length > 0 ? activities : ["food", "hiking", "nightlife"];
    return defs.map((activity) => ({
      kind: "mix_spec_v1",
      id: `mix_${activity.replace(/[^a-z0-9]+/gi, "_")}`,
      type: "activity_mix",
      specVersion: 1,
      seeds: { primaryActivityId: activity },
      title: `${activity.charAt(0).toUpperCase()}${activity.slice(1)} Mix`,
      subtitle: `Top ${activity} posts`,
      coverSpec: { kind: "thumb_collage", maxTiles: 4 },
      geoMode: "viewer",
      personalizationMode: "taste_blended_v1",
      rankingMode: "mix_v1",
      geoBucketKey: "global",
      heroQuery: activity,
      cacheKeyVersion: 1
    }));
  }

  async function callV2Get(path: string, viewerId: string): Promise<Record<string, unknown> | null> {
    const res = await app.inject({
      method: "GET",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    try {
      return res.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function callV2GetOrThrow(path: string, viewerId: string, routeName: string): Promise<Record<string, unknown>> {
    const payload = await callV2Get(path, viewerId);
    if (!payload) {
      throw new Error(`${routeName}: canonical v2 request failed for ${path}`);
    }
    return payload;
  }

  async function callV2GetOrThrowWithRetry(
    path: string,
    viewerId: string,
    routeName: string,
    attempts = 2
  ): Promise<Record<string, unknown>> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await callV2GetOrThrow(path, viewerId, routeName);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${routeName}: canonical v2 request failed for ${path}`);
  }

  async function callV2PostOrThrow(
    path: string,
    viewerId: string,
    routeName: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal",
        "content-type": "application/json"
      },
      payload: JSON.stringify(body)
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${routeName}: canonical v2 request failed for ${path}`);
    }
    return res.json() as Record<string, unknown>;
  }

  async function callV2PostWithStatus(
    path: string,
    viewerId: string,
    body: Record<string, unknown>
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const res = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal",
        "content-type": "application/json"
      },
      payload: JSON.stringify(body)
    });
    let payload: Record<string, unknown> = {};
    try {
      payload = res.json() as Record<string, unknown>;
    } catch {
      /* ignore non-json */
    }
    return { statusCode: res.statusCode, payload };
  }

  async function callV2DeleteWithStatus(
    path: string,
    viewerId: string
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const res = await app.inject({
      method: "DELETE",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    let payload: Record<string, unknown> = {};
    try {
      payload = res.json() as Record<string, unknown>;
    } catch {
      /* ignore non-json */
    }
    return { statusCode: res.statusCode, payload };
  }

  async function callV2PatchWithStatus(
    path: string,
    viewerId: string,
    body: Record<string, unknown>
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const res = await app.inject({
      method: "PATCH",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal",
        "content-type": "application/json"
      },
      payload: JSON.stringify(body)
    });
    let payload: Record<string, unknown> = {};
    try {
      payload = res.json() as Record<string, unknown>;
    } catch {
      /* ignore non-json */
    }
    return { statusCode: res.statusCode, payload };
  }

  function compatErrorMessage(payload: Record<string, unknown>): string {
    const err = payload.error as Record<string, unknown> | string | undefined;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && typeof err.message === "string") return String(err.message);
    return "request_failed";
  }

  function v2Data(v2: Record<string, unknown>): Record<string, unknown> {
    return (v2.data as Record<string, unknown> | undefined) ?? {};
  }

  function mapV2CollectionToLegacy(c: Record<string, unknown>): Record<string, unknown> {
    const id = String(c.id ?? "");
    const mixCoverThumbUrls = Array.isArray(c.mixCoverThumbUrls)
      ? c.mixCoverThumbUrls
          .map((value) => String(value ?? "").trim())
          .filter((value) => /^https?:\/\//i.test(value))
          .slice(0, 4)
      : [];
    const coverUri =
      typeof c.coverUri === "string" && /^https?:\/\//i.test(c.coverUri.trim())
        ? c.coverUri.trim()
        : typeof c.displayPhotoUrl === "string" && /^https?:\/\//i.test(c.displayPhotoUrl.trim())
          ? c.displayPhotoUrl.trim()
          : mixCoverThumbUrls[0] ?? null;
    const collaboratorInfo = Array.isArray(c.collaboratorInfo)
      ? c.collaboratorInfo
          .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
          .map((row) => {
            const id = String(row.id ?? "").trim();
            if (!id) return null;
            const name = String(row.name ?? "").trim();
            const handle = String(row.handle ?? "").trim().replace(/^@+/, "");
            const profilePic = String(row.profilePic ?? "").trim();
            return {
              id,
              ...(name ? { name } : {}),
              ...(handle ? { handle } : {}),
              profilePic: profilePic || null
            };
          })
          .filter((row): row is { id: string; name?: string; handle?: string; profilePic: string | null } => Boolean(row))
      : [];
    return {
      id,
      collectionId: id,
      name: String(c.name ?? "Collection"),
      title: String(c.name ?? "Collection"),
      ownerId: String(c.ownerId ?? ""),
      privacy: c.privacy ?? "private",
      description: c.description ?? "",
      items: Array.isArray(c.items) ? c.items : [],
      collaborators: Array.isArray(c.collaborators) ? c.collaborators : [],
      collaboratorInfo,
      itemsCount: Number(c.itemsCount ?? 0),
      coverUri,
      displayPhotoUrl: coverUri,
      mixCoverThumbUrls,
      mixInitialPosts: Array.isArray(c.mixInitialPosts) ? c.mixInitialPosts : []
    };
  }

  function mapV2DirectoryUserToLegacy(row: Record<string, unknown>): Record<string, unknown> {
    const userId = String(row.userId ?? "");
    const handle = String(row.handle ?? "").replace(/^@+/, "");
    const name = row.displayName != null ? String(row.displayName) : `User ${userId.slice(0, 8)}`;
    return {
      id: userId,
      userId,
      name,
      handle: handle || `user_${userId.slice(0, 8)}`,
      profilePic: String(row.profilePic ?? "").trim()
    };
  }

  function mapV2CommentToLegacy(c: Record<string, unknown>): Record<string, unknown> {
    const author = (c.author as Record<string, unknown> | undefined) ?? {};
    return {
      commentId: c.commentId,
      id: c.commentId,
      text: c.text,
      content: c.text,
      createdAtMs: c.createdAtMs,
      userId: author.userId,
      userName: author.name,
      userPic: author.pic,
      author
    };
  }

  app.get("/api/config/version", async () => ({
    success: true,
    /** Higher than typical app semver so force-update modal stays off in dev. */
    versionNumber: "999.0.0",
    shouldUpdate: false,
    forceUpdate: false
  }));

  app.get("/api/v1/product/viewer/bootstrap", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const session = await callV2GetOrThrowWithRetry("/v2/auth/session", viewerId, "/api/v1/product/viewer/bootstrap", 3);
    const profile = await callV2GetOrThrowWithRetry(
      `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=12`,
      viewerId,
      "/api/v1/product/viewer/bootstrap",
      3
    );
    const viewer = buildProductCompatViewer(viewerId);
    const profileData = (profile?.data as Record<string, unknown> | undefined)?.firstRender as Record<string, unknown> | undefined;
    const profileObj = (profileData?.profile as Record<string, unknown> | undefined) ?? {};
    const countsObj = (profileData?.counts as Record<string, unknown> | undefined) ?? {};
    if (typeof profileObj.name === "string") viewer.name = profileObj.name;
    if (typeof profileObj.handle === "string") viewer.handle = String(profileObj.handle).replace(/^@+/, "");
    if (typeof profileObj.profilePic === "string") viewer.profilePic = profileObj.profilePic;
    if (typeof profileObj.bio === "string") viewer.bio = profileObj.bio;
    if (viewerId !== "anonymous" && (!viewer.handle || !viewer.name)) {
      throw new Error("/api/v1/product/viewer/bootstrap: missing canonical profile identity");
    }
    return reply.send({
      success: true,
      viewer,
      viewerEtag: `viewer:${viewerId}:compat:${Date.now()}`,
      counts: {
        posts: Number(countsObj.posts ?? 0) || 0,
        followers: Number(countsObj.followers ?? 0) || 0,
        following: Number(countsObj.following ?? 0) || 0
      },
      authSession: session.data ?? null,
      serverTs: Date.now()
    });
  });

  app.get<{
    Querystring: {
      limit?: string;
      tab?: string;
      radius_label?: string;
      radius_km?: string;
      radiusLabel?: string;
      radiusKm?: string;
      lat?: string;
      lng?: string;
    };
  }>("/api/v1/product/feed/bootstrap", async (request, reply) => {
    const limit = Math.max(1, Math.min(40, Number(request.query.limit ?? 12) || 12));
    const viewerId = resolveCompatViewerId(request);
    const q = request.query;
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(8, Math.max(4, limit))));
    if (q.tab) params.set("tab", q.tab);
    const radiusLabel = q.radius_label ?? q.radiusLabel;
    const radiusKm = q.radius_km ?? q.radiusKm;
    if (radiusLabel) params.set("radiusLabel", radiusLabel);
    if (radiusKm) params.set("radiusKm", radiusKm);
    if (q.lat) params.set("lat", q.lat);
    if (q.lng) params.set("lng", q.lng);
    const v2 = await callV2GetOrThrow(`/v2/feed/bootstrap?${params.toString()}`, viewerId, "/api/v1/product/feed/bootstrap");
    const firstRender = (v2.data as Record<string, unknown> | undefined)?.firstRender as Record<string, unknown> | undefined;
    const feed = firstRender?.feed as Record<string, unknown> | undefined;
    const page = feed?.page as Record<string, unknown> | undefined;
    const v2Items = (feed?.items ?? []) as Array<Record<string, unknown>>;
    const items = v2Items.map((p) => postToSearchRow(p));
    const nextCursor = (page?.nextCursor as string | null | undefined) ?? null;
    return reply.send({
      items,
      hasMore: nextCursor != null,
      nextCursor,
      cursor: nextCursor,
      allSeen: items.length === 0,
      noPosts: items.length === 0
    });
  });

  app.put<{ Params: { userId: string }; Body: Record<string, unknown> }>("/api/users/:userId", async (request, reply) => {
    const userId = request.params.userId;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profilePic = typeof body.profilePic === "string" ? body.profilePic.trim() : "";
    const expoPushToken = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";
    const pushToken =
      typeof body.pushToken === "string" && body.pushToken.trim()
        ? body.pushToken.trim()
        : expoPushToken;
    const payload = mergeUserDocumentWritePayload({
      ...(expoPushToken ? { expoPushToken } : {}),
      ...(pushToken ? { pushToken } : {}),
      ...(typeof body.fcmToken === "string" ? { fcmToken: body.fcmToken.trim() } : {}),
      ...(typeof body.apnsToken === "string" ? { apnsToken: body.apnsToken.trim() } : {}),
      ...(typeof body.updatedAt === "number" ? { updatedAt: body.updatedAt } : { updatedAt: Date.now() }),
      ...(profilePic ? { profilePic } : {})
    });

    if (db) {
      try {
        await db.collection("users").doc(userId).set(
          {
            ...payload,
            ...(expoPushToken ? { expoPushTokens: FieldValue.arrayUnion(expoPushToken) } : {}),
            ...(pushToken ? { pushTokens: FieldValue.arrayUnion(pushToken) } : {}),
            ...(typeof body.platform === "string" && body.platform.trim()
              ? { pushTokenPlatform: body.platform.trim() }
              : {}),
            pushTokenUpdatedAt: Date.now(),
          },
          { merge: true }
        );
      } catch {
        // Keep compat route non-fatal on transient Firestore write failures.
      }
    }

    return reply.status(200).send({
      success: true,
      userId,
      stub: "backendv2_user_push_token_compat"
    });
  });

  // Chat thread header presence: legacy native clients call this endpoint directly.
  app.get<{ Params: { userId: string } }>("/api/users/:userId/last-active", async (request, reply) => {
    const userId = String(request.params.userId ?? "").trim();
    if (!userId) return reply.status(400).send({ success: false, error: "userId required" });
    const lastActiveMs = await userActivityService.getLastActiveMs({ userId });
    return reply.status(200).send({ success: true, lastActiveMs });
  });

  app.get<{ Params: { userId: string }; Querystring: { compact?: string } }>(
    "/api/users/:userId/full",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const targetUserId = String(request.params.userId ?? "").trim();
      const compact = String(request.query.compact ?? "").trim() === "1";
      if (!targetUserId) return reply.status(400).send({ success: false, error: "userId required" });

      const cacheKey = `${viewerId}:${targetUserId}:compact=${compact ? "1" : "0"}`;
      const cached = userFullCache.get(cacheKey);
      if (cached && cached.expiresAtMs > Date.now()) {
        return reply.send(cached.payload);
      }

      try {
        const v2 = await callV2GetOrThrow(
          `/v2/profiles/${encodeURIComponent(targetUserId)}/bootstrap?gridLimit=6`,
          viewerId,
          "/api/users/:userId/full"
        );
        const bootstrap = (v2.data as Record<string, unknown> | undefined) ?? {};
        const payload = await userFullOrchestrator.run({
          viewerId,
          targetUserId,
          profileBootstrap: bootstrap,
        });
        userFullCache.set(cacheKey, { expiresAtMs: Date.now() + (compact ? 120_000 : 60_000), payload });
        return reply.send(payload);
      } catch {
        return reply.status(503).send({ success: false, error: "upstream_unavailable" });
      }
    }
  );

  /**
   * Monolith: PATCH whitelist fields → { viewer, etag }. Native `commitPatchToServer` expects 200 + body.
   * Identity must match the signed-in user (see `resolveCompatViewerId` + native `x-viewer-id` for `/api/v1/product/`).
   */
  app.patch("/api/v1/product/viewer", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    let base = buildProductCompatViewer(viewerId);
    if (viewerId !== "anonymous") {
      const profile = await callV2GetOrThrow(
        `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=6`,
        viewerId,
        "/api/v1/product/viewer"
      );
      const profileData = (profile.data as Record<string, unknown> | undefined)?.firstRender as Record<string, unknown> | undefined;
      const profileObj = (profileData?.profile as Record<string, unknown> | undefined) ?? {};
      if (typeof profileObj.name === "string") base.name = profileObj.name;
      if (typeof profileObj.handle === "string") base.handle = String(profileObj.handle).replace(/^@+/, "");
      if (typeof profileObj.profilePic === "string") base.profilePic = profileObj.profilePic;
      if (!base.handle || !base.name) {
        throw new Error("/api/v1/product/viewer: canonical profile identity required");
      }
    }
    const patch = (request.body ?? {}) as Record<string, unknown>;
    const viewer = applyViewerPatch(base, patch);
    const etag = `viewer:${viewer.userId}:compat:${Date.now()}`;
    return reply.status(200).send({ viewer, etag });
  });

  app.get<{ Params: { userId: string } }>("/api/v1/product/users/:userId/friends-data", async (request, reply) => {
    const userId = String(request.params.userId ?? "").trim();
    const following = userId ? await loadFollowingIds(userId) : [];
    return reply.send({
      success: true,
      following,
      friendsData: following.map((id) => ({ id }))
    });
  });

  app.post<{ Body: { userIds?: unknown } }>("/api/v1/product/users/multiple", async (request, reply) => {
    const userIds = Array.isArray(request.body?.userIds)
      ? request.body!.userIds.filter((id): id is string => typeof id === "string")
      : [];
    const users = await loadUsersByIds(userIds);
    return reply.send({ success: true, users });
  });

  app.get<{ Querystring: { userId?: string; limit?: string; excludeUserIds?: string } }>(
    "/api/v1/product/users/suggested",
    async (request, reply) => {
      const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 10) || 10));
      const exclude = new Set(
        String(request.query.excludeUserIds ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      );
      const viewerId = String(request.query.userId ?? "").trim();
      if (viewerId) exclude.add(viewerId);
      if (!db) return reply.send({ success: true, users: [] });
      const snap = await db.collection("users").orderBy("searchHandle").limit(limit * 3).get();
      const users = snap.docs
        .filter((doc) => !exclude.has(doc.id))
        .slice(0, limit)
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return {
            id: doc.id,
            userId: doc.id,
            name: String(data.name ?? data.displayName ?? "").trim() || `User ${doc.id.slice(0, 8)}`,
            handle: String(data.handle ?? "").replace(/^@+/, "").trim() || `user_${doc.id.slice(0, 8)}`,
            profilePic: String(data.profilePic ?? data.profilePicture ?? data.photo ?? "").trim()
          };
        });
      return reply.send({ success: true, users });
    }
  );

  app.get<{ Params: { userId: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/v1/product/connections/user/:userId/followers",
    async (request, reply) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const limit = Math.max(1, Math.min(200, Number(request.query.limit ?? 50) || 50));
      const { users, total } = await loadConnectionList(request.params.userId, "followers", page, limit);
      return reply.send({ success: true, followers: users, total });
    }
  );

  app.get<{ Params: { userId: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/v1/product/connections/user/:userId/following",
    async (request, reply) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const limit = Math.max(1, Math.min(200, Number(request.query.limit ?? 50) || 50));
      const { users, total } = await loadConnectionList(request.params.userId, "following", page, limit);
      return reply.send({ success: true, following: users, total });
    }
  );

  app.get<{ Params: { targetUserId: string } }>("/api/v1/product/connections/status/:targetUserId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const targetUserId = String(request.params.targetUserId ?? "");
    const following = (await loadFollowingIds(viewerId)).includes(targetUserId);
    return reply.send({ success: true, following });
  });

  app.post("/api/v1/product/mixes/catalog", async (_request, reply) => {
    const viewerId = resolveCompatViewerId(_request);
    const v2 = await callV2GetOrThrow("/v2/mixes/catalog?limit=10", viewerId, "/api/v1/product/mixes/catalog");
    return reply.send({
      success: true,
      mixSpecs: ((v2.data as Record<string, unknown> | undefined)?.mixSpecs ?? []) as Array<Record<string, unknown>>,
      rankingVersion: String((v2.data as Record<string, unknown> | undefined)?.rankingVersion ?? "mix_v1")
    });
  });

  app.post<{ Body: { mixSpecs?: Array<{ id?: string }> } }>("/api/v1/product/mixes/previews", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const mixSpecs = Array.isArray(request.body?.mixSpecs) ? request.body!.mixSpecs : [];
    const v2 = await callV2PostOrThrow("/v2/mixes/previews", viewerId, "/api/v1/product/mixes/previews", { mixSpecs });
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    return reply.send({
      success: true,
      previews: (data.previews ?? []) as Array<Record<string, unknown>>,
      rankingVersion: String(data.rankingVersion ?? "mix_v1")
    });
  });

  app.post("/api/v1/product/mixes/prewarm", async (_request, reply) => {
    const viewerId = resolveCompatViewerId(_request);
    const v2 = await callV2PostOrThrow("/v2/mixes/prewarm", viewerId, "/api/v1/product/mixes/prewarm", {});
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    return reply.send({
      success: true,
      mixSpecs: (data.mixSpecs ?? []) as Array<Record<string, unknown>>,
      previews: (data.previews ?? []) as Array<Record<string, unknown>>,
      profileVersion: String(data.profileVersion ?? "v2-search-mix-1"),
      rankingVersion: String(data.rankingVersion ?? "mix_v1")
    });
  });

  app.post<{
    Body: { query?: string; lat?: number; lng?: number; includePreviews?: boolean; previewLimit?: number };
  }>("/api/v1/product/mixes/suggest", async (request, reply) => {
    const query = String(request.body?.query ?? "").trim().toLowerCase();
    const viewerId = resolveCompatViewerId(request);
    const lat = Number.isFinite(Number(request.body?.lat)) ? Number(request.body!.lat) : undefined;
    const lng = Number.isFinite(Number(request.body?.lng)) ? Number(request.body!.lng) : undefined;
    noteViewerCoords(viewerId, lat, lng);
    const includePreviews = Boolean(request.body?.includePreviews);
    const previewLimit = Math.max(1, Math.min(8, Number(request.body?.previewLimit ?? 4) || 4));
    const v2 = await callV2PostOrThrow("/v2/mixes/suggest", viewerId, "/api/v1/product/mixes/suggest", {
      query,
      ...(lat != null ? { lat } : {}),
      ...(lng != null ? { lng } : {}),
      ...(includePreviews ? { includePreviews: true, previewLimit } : {}),
    });
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    return reply.send({
      success: true,
      candidates: (data.candidates ?? []) as Array<Record<string, unknown>>,
      previews: (data.previews ?? []) as Array<Record<string, unknown>>,
      rankingVersion: String(data.rankingVersion ?? "mix_v1")
    });
  });

  app.post<{
    Body: {
      mixSpec?: MixSpec;
      cursor?: string | null;
      limit?: number;
      lat?: number;
      lng?: number;
    };
  }>("/api/v1/product/mixes/feed", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const limit = Math.max(1, Math.min(30, Number(request.body?.limit ?? 20) || 20));
    const lat = Number.isFinite(Number(request.body?.lat)) ? Number(request.body!.lat) : undefined;
    const lng = Number.isFinite(Number(request.body?.lng)) ? Number(request.body!.lng) : undefined;
    noteViewerCoords(viewerId, lat, lng);
    const body: Record<string, unknown> = {
      limit,
      ...(request.body?.mixSpec ? { mixSpec: request.body.mixSpec } : {}),
      ...(typeof request.body?.cursor === "string" && request.body.cursor.trim()
        ? { cursor: request.body.cursor.trim() }
        : {}),
      ...(lat != null ? { lat } : {}),
      ...(lng != null ? { lng } : {}),
    };
    try {
      const v2 = await callV2PostOrThrow("/v2/mixes/feed", viewerId, "/api/v1/product/mixes/feed", body);
      const data = (v2.data as Record<string, unknown> | undefined) ?? {};
      return reply.send({
        success: true,
        posts: (data.posts ?? []) as Array<Record<string, unknown>>,
        nextCursor: (data.nextCursor as string | null | undefined) ?? null,
        hasMore: Boolean(data.hasMore ?? false),
        rankingVersion: String(data.rankingVersion ?? "mix_v1")
      });
    } catch (error) {
      request.log.warn({ routeName: "compat.api.mixes.feed", error }, "mixes feed compat stub failed");
      return reply.status(503).send({ success: false, error: "mixes_feed_unavailable" });
    }
  });

  app.post<{ Body: { limit?: number; lat?: number; lng?: number } }>("/api/v1/product/mixes/area", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const limit = Math.max(1, Math.min(30, Number(request.body?.limit ?? 20) || 20));
    const lat = Number.isFinite(Number(request.body?.lat)) ? Number(request.body!.lat) : undefined;
    const lng = Number.isFinite(Number(request.body?.lng)) ? Number(request.body!.lng) : undefined;
    noteViewerCoords(viewerId, lat, lng);
    const body: Record<string, unknown> = {
      limit,
      ...(lat != null ? { lat } : {}),
      ...(lng != null ? { lng } : {}),
    };
    try {
      const v2 = await callV2PostOrThrow("/v2/mixes/area", viewerId, "/api/v1/product/mixes/area", body);
      const data = (v2.data as Record<string, unknown> | undefined) ?? {};
      return reply.send({
        success: true,
        townDisplayName: String(data.townDisplayName ?? "Near you"),
        posts: (data.posts ?? []) as Array<Record<string, unknown>>,
        showNearYouCopy: Boolean(data.showNearYouCopy ?? true)
      });
    } catch (error) {
      request.log.warn({ routeName: "compat.api.mixes.area", error }, "mixes area compat stub failed");
      return reply.status(503).send({ success: false, error: "mixes_area_unavailable" });
    }
  });

  app.post<{
    Querystring: { limit?: string };
    Body: {
      activities?: string[];
      activityWeights?: Record<string, number>;
      cursor?: string | null;
      lat?: number;
      lng?: number;
    };
  }>("/api/posts/by-activities-smart", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const limit = Math.max(4, Math.min(40, Number(request.query.limit ?? 20) || 20));
    const activities = Array.isArray(request.body?.activities)
      ? request.body.activities.map((a) => String(a).trim()).filter(Boolean)
      : [];
    const weightedActivities = request.body?.activityWeights
      ? Object.entries(request.body.activityWeights)
          .filter(([, weight]) => Number.isFinite(Number(weight)))
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .map(([activity]) => String(activity).trim())
          .filter(Boolean)
      : [];
    const uniqueTerms = [...new Set([...weightedActivities, ...activities].map((term) => term.toLowerCase().trim()).filter(Boolean))];
    const query = uniqueTerms.slice(0, 4).join(" ").trim();
    if (!query) {
      return reply.send({ success: true, posts: [], nextCursor: null, hasMore: false });
    }
    const cacheKey = JSON.stringify({
      viewerId,
      limit,
      query,
      cursor: typeof request.body?.cursor === "string" ? request.body.cursor.trim() : "",
      activities: uniqueTerms.slice(0, 4),
      // Bucket coords so "near you" results are cacheable without exploding keys.
      latBucket: Number.isFinite(Number(request.body?.lat))
        ? Math.round(Number(request.body!.lat) * 10) / 10
        : Number.isFinite(Number(request.headers["x-viewer-lat"]))
          ? Math.round(Number(request.headers["x-viewer-lat"]) * 10) / 10
          : null,
      lngBucket: Number.isFinite(Number(request.body?.lng))
        ? Math.round(Number(request.body!.lng) * 10) / 10
        : Number.isFinite(Number(request.headers["x-viewer-lng"]))
          ? Math.round(Number(request.headers["x-viewer-lng"]) * 10) / 10
          : null,
    });
    const cached = activityPostsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.send(cached.payload);
    }
    const cursor = typeof request.body?.cursor === "string" ? request.body.cursor.trim() : "";
    const cachedCoords = getViewerCoordsFallback(viewerId);
    const lat =
      Number.isFinite(Number(request.body?.lat))
        ? Number(request.body!.lat)
        : Number.isFinite(Number(request.headers["x-viewer-lat"]))
          ? Number(request.headers["x-viewer-lat"])
          : cachedCoords?.lat;
    const lng =
      Number.isFinite(Number(request.body?.lng))
        ? Number(request.body!.lng)
        : Number.isFinite(Number(request.headers["x-viewer-lng"]))
          ? Number(request.headers["x-viewer-lng"])
          : cachedCoords?.lng;
    noteViewerCoords(viewerId, lat, lng);
    const primaryActivity = uniqueTerms[0] ?? "";
    let posts: Array<Record<string, unknown>> = [];
    let nextCursor: string | null = null;
    let hasMore = false;
    if (primaryActivity) {
      try {
        const mixSpec = {
          kind: "mix_spec_v1",
          id: `mix_${primaryActivity.replace(/[^a-z0-9]+/gi, "_")}`,
          type: "activity_mix",
          specVersion: 1,
          seeds: { primaryActivityId: primaryActivity },
          title: `${primaryActivity.charAt(0).toUpperCase()}${primaryActivity.slice(1)} Mix`,
          subtitle: `Top ${primaryActivity} posts`,
          coverSpec: { kind: "thumb_collage", maxTiles: 4 },
          geoMode: "viewer",
          personalizationMode: "taste_blended_v1",
          rankingMode: "mix_v1",
          geoBucketKey: "global",
          heroQuery: primaryActivity,
          cacheKeyVersion: 1
        };
        const mixFeed = await callV2PostOrThrow("/v2/mixes/feed", viewerId, "/api/posts/by-activities-smart", {
          mixSpec,
          limit,
          ...(cursor ? { cursor } : {}),
          ...(lat != null ? { lat } : {}),
          ...(lng != null ? { lng } : {}),
        });
        const feedData = (mixFeed.data as Record<string, unknown> | undefined) ?? {};
        posts = ((feedData.posts ?? []) as Array<Record<string, unknown>>).map((item) => postToSearchRow(item));
        nextCursor = (feedData.nextCursor as string | null | undefined) ?? null;
        hasMore = Boolean(feedData.hasMore ?? false);
      } catch {
        // Fall through to canonical search fallback below.
      }
    }
    if (posts.length === 0) {
      const path = `/v2/search/results?q=${encodeURIComponent(query)}&limit=${limit}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }${lat != null ? `&lat=${encodeURIComponent(String(lat))}` : ""}${lng != null ? `&lng=${encodeURIComponent(String(lng))}` : ""}`;
      const v2 = await callV2GetOrThrow(path, viewerId, "/api/posts/by-activities-smart");
      const data = (v2.data as Record<string, unknown> | undefined) ?? {};
      posts = ((data.items ?? []) as Array<Record<string, unknown>>).map((item) => postToSearchRow(item));
      const page = (data.page as Record<string, unknown> | undefined) ?? {};
      nextCursor = (page.nextCursor as string | null | undefined) ?? null;
      hasMore = Boolean(page.hasMore ?? false);
    }
    if (posts.length === 0) {
      const bootstrap = await callV2Get(
        `/v2/search/bootstrap?q=${encodeURIComponent(query)}&limit=${Math.max(8, limit)}${
          lat != null ? `&lat=${encodeURIComponent(String(lat))}` : ""
        }${lng != null ? `&lng=${encodeURIComponent(String(lng))}` : ""}`,
        viewerId
      );
      const bootstrapData = ((bootstrap?.data as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
      posts = ((bootstrapData.posts ?? []) as Array<Record<string, unknown>>).map((item) => postToSearchRow(item));
    }
    const payload = {
      success: true as const,
      posts,
      nextCursor,
      hasMore,
    };
    activityPostsCache.set(cacheKey, { expiresAt: Date.now() + ACTIVITY_POSTS_CACHE_TTL_MS, payload });
    return reply.send(payload);
  });

  function postToSearchRow(post: Record<string, unknown>): Record<string, unknown> {
    return {
      postId: String(post.postId ?? post.id ?? ""),
      id: String(post.id ?? post.postId ?? ""),
      userId: String(post.userId ?? ""),
      thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),
      displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),
      title: String(post.title ?? ""),
      activities: Array.isArray(post.activities) ? post.activities : []
    };
  }

  async function legacyReelItemsFromFeedBootstrap(
    viewerId: string,
    init: {
      tab: "explore" | "following";
      limit?: number;
      lat?: string;
      lng?: string;
      radiusKm?: string;
      radiusLabel?: string;
    }
  ): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(8, Math.max(4, init.limit ?? 8))));
    params.set("tab", init.tab);
    if (init.radiusLabel) params.set("radiusLabel", init.radiusLabel);
    if (init.radiusKm) params.set("radiusKm", init.radiusKm);
    if (init.lat) params.set("lat", init.lat);
    if (init.lng) params.set("lng", init.lng);
    const v2 = await callV2GetOrThrow(`/v2/feed/bootstrap?${params.toString()}`, viewerId, "reels.compat.feed_bootstrap");
    const firstRender = (v2.data as Record<string, unknown> | undefined)?.firstRender as Record<string, unknown> | undefined;
    const feed = firstRender?.feed as Record<string, unknown> | undefined;
    const page = feed?.page as Record<string, unknown> | undefined;
    const v2Items = (feed?.items ?? []) as Array<Record<string, unknown>>;
    const items = v2Items.map((p) => postToSearchRow(p));
    const nextCursor = (page?.nextCursor as string | null | undefined) ?? null;
    return { items, nextCursor };
  }

  app.post<{ Body: { query?: string; limit?: number; userContext?: { lat?: number; lng?: number } } }>("/api/v1/product/search/bootstrap", async (request, reply) => {
    const limit = Math.max(1, Math.min(80, Number(request.body?.limit ?? 24) || 24));
    const viewerId = resolveCompatViewerId(request);
    const query = String(request.body?.query ?? "").trim();
    const v2 = await callV2PostOrThrow("/v2/search/bootstrap", viewerId, "/api/v1/product/search/bootstrap", {
      query,
      limit,
      ...(request.body?.userContext ? { userContext: request.body.userContext } : {})
    });
    const posts = (((v2.data as Record<string, unknown> | undefined)?.posts ?? []) as Array<Record<string, unknown>>).map((p) => postToSearchRow(p));
    return reply.send({
      success: true,
      posts,
      parsedSummary: ((v2.data as Record<string, unknown> | undefined)?.parsedSummary ?? {
        activity: String(request.body?.query ?? "").trim() || null,
        nearMe: false,
        genericDiscovery: false
      }) as Record<string, unknown>
    });
  });

  app.post<{ Body: { query?: string; limit?: number } }>("/api/v1/product/search/live", async (request, reply) => {
    const limit = Math.max(1, Math.min(30, Number(request.body?.limit ?? 20) || 20));
    const viewerId = resolveCompatViewerId(request);
    const query = String(request.body?.query ?? "").trim();
    const v2 = await callV2PostOrThrow("/v2/search/live", viewerId, "/api/v1/product/search/live", { query, limit });
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    const posts = ((data.posts ?? []) as Array<Record<string, unknown>>).map((p) => postToSearchRow(p));
    return reply.send({
      success: true,
      posts,
      users: (data.users ?? []) as Array<Record<string, unknown>>,
      suggestions: (data.suggestions ?? []) as Array<Record<string, unknown>>,
      detectedActivity: data.detectedActivity ?? null,
      relatedActivities: (data.relatedActivities ?? []) as Array<string>,
      collections: (data.collections ?? []) as Array<Record<string, unknown>>,
      groups: (data.groups ?? []) as Array<Record<string, unknown>>
    });
  });

  app.post<{ Body: { query?: string; userContext?: Record<string, unknown> } }>("/api/v1/product/search/suggest", async (request, reply) => {
    const q = String(request.body?.query ?? "").trim().toLowerCase();
    if (!q) return reply.send({ success: true, suggestions: [] });
    const viewerId = resolveCompatViewerId(request);
    const lat = Number((request.body?.userContext as Record<string, unknown> | undefined)?.lat);
    const lng = Number((request.body?.userContext as Record<string, unknown> | undefined)?.lng);
    const v2Path = `/v2/search/suggest?q=${encodeURIComponent(q)}${
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `&lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
        : ""
    }`;
    const v2 = await callV2GetOrThrow(v2Path, viewerId, "/api/v1/product/search/suggest");
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    return reply.send({
      success: true,
      suggestions: (data.suggestions ?? []) as Array<Record<string, unknown>>,
      detectedActivity: data.detectedActivity ?? q,
      relatedActivities: (data.relatedActivities ?? []) as Array<string>
    });
  });

  /**
   * Web (Next) uses `/api/search/suggest` (not product-scoped). Keep parity by forwarding to the
   * canonical v2 suggest surface and returning the legacy-shaped payload (success + suggestions + timings).
   */
  app.post<{ Body: { query?: string; userContext?: Record<string, unknown> } }>("/api/search/suggest", async (request, reply) => {
    const startedAt = Date.now();
    const q = String(request.body?.query ?? "").trim().toLowerCase();
    if (!q) {
      return reply.send({
        success: true,
        suggestions: [],
        detectedActivity: null,
        relatedActivities: [],
        responseTime: Date.now() - startedAt,
        serverTimings: { totalMs: Date.now() - startedAt }
      });
    }
    const viewerId = resolveCompatViewerId(request);
    const lat = Number((request.body?.userContext as Record<string, unknown> | undefined)?.lat);
    const lng = Number((request.body?.userContext as Record<string, unknown> | undefined)?.lng);
    const v2Path = `/v2/search/suggest?q=${encodeURIComponent(q)}${
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `&lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
        : ""
    }`;
    const v2 = await callV2GetOrThrow(v2Path, viewerId, "/api/search/suggest");
    const data = (v2.data as Record<string, unknown> | undefined) ?? {};
    const durationMs = Date.now() - startedAt;
    return reply.send({
      success: true,
      suggestions: (data.suggestions ?? []) as Array<Record<string, unknown>>,
      detectedActivity: (data.detectedActivity as string | null | undefined) ?? null,
      relatedActivities: (data.relatedActivities ?? []) as Array<string>,
      responseTime: durationMs,
      serverTimings: { totalMs: durationMs }
    });
  });

  /**
   * Public QA fixtures used by the SearchAutofillLab quick picks.
   */
  app.get("/api/v1/product/search/test/partial-query-fixtures", async (_request, reply) =>
    reply.send({
      success: true,
      description: "Half-typed strings to verify suggest completions (towns, templates, activities).",
      queries: [
        "best hikes i",
        "best swimming ho",
        "hiking in ve",
        "swim in eas",
        "coffee near m",
        "trail ",
        "waterfall ne"
      ]
    })
  );

  /**
   * Dev benchmark adapter used by SearchAutofillLab for committed results.
   * Matches the monolith route shape but forwards to `/v2/search/bootstrap`.
   */
  app.post<{ Body: { query?: string; limit?: number; lat?: number; lng?: number; userContext?: { lat?: number; lng?: number } } }>(
    "/api/v1/product/search/test/bootstrap-cards",
    async (request, reply) => {
      const startedAt = Date.now();
      const query = String(request.body?.query ?? "").trim();
      const limit = Math.max(1, Math.min(80, Number(request.body?.limit ?? 48) || 48));
      const viewerId = resolveCompatViewerId(request);
      const uc = request.body?.userContext ?? {};
      const lat = Number(request.body?.lat ?? uc?.lat);
      const lng = Number(request.body?.lng ?? uc?.lng);
      const v2Path = `/v2/search/bootstrap?q=${encodeURIComponent(query)}&limit=${limit}${
        Number.isFinite(lat) && Number.isFinite(lng)
          ? `&lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
          : ""
      }`;
      const v2 = await callV2GetOrThrow(v2Path, viewerId, "/api/v1/product/search/test/bootstrap-cards");
      const data = (v2.data as Record<string, unknown> | undefined) ?? {};
      const durationMs = Date.now() - startedAt;
      return reply.send({
        success: true,
        posts: (data.posts ?? []) as Array<Record<string, unknown>>,
        parsedSummary: (data.parsedSummary ?? null) as Record<string, unknown> | null,
        responseTimeMs: durationMs,
        serverTimings: { totalMs: durationMs },
        parity: {
          endpoint: "/api/v1/product/search/test/bootstrap-cards",
          nativeEquivalentEndpoint: "/api/v1/product/search/bootstrap",
          coreLogic: "v2_search_bootstrap",
          fastOnly: true,
          cardSemantics: "search_bootstrap_cards",
          authMode: "dev_benchmark_adapter"
        }
      });
    }
  );

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/product/notifications", async (request, reply) => {
    const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 20) || 20));
    const viewerId = resolveCompatViewerId(request);
    const v2 = await callV2GetOrThrow(`/v2/notifications?limit=${Math.min(20, limit)}`, viewerId, "/api/v1/product/notifications");
    const data = v2Data(v2);
    const notifications = mapV2NotificationListToLegacyItems(data.items);
    return reply.send({ success: true, notifications, total: notifications.length, page: 1, limit });
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/product/notifications/bootstrap", async (request, reply) => {
    const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 20) || 20));
    const viewerId = resolveCompatViewerId(request);
    const v2 = await callV2GetOrThrow(`/v2/notifications?limit=${Math.min(20, limit)}`, viewerId, "/api/v1/product/notifications/bootstrap");
    const data = v2Data(v2);
    const notifications = mapV2NotificationListToLegacyItems(data.items);
    const unreadCount = Number((data.unread as { count?: unknown } | undefined)?.count ?? 0);
    const byType: Record<string, number> = {};
    for (const n of notifications) {
      const t = String((n as Record<string, unknown>).type ?? "post");
      byType[t] = (byType[t] ?? 0) + 1;
    }
    return reply.send({
      success: true,
      notifications,
      total: notifications.length,
      page: 1,
      limit,
      stats: {
        total: notifications.length,
        unread: unreadCount,
        read: notifications.filter((n) => Boolean((n as Record<string, unknown>).read)).length,
        byType,
        byPriority: { normal: notifications.length },
        recentActivity: notifications.length
      }
    });
  });

  app.get("/api/v1/product/notifications/stats", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    try {
      const v2 = await callV2GetOrThrow("/v2/notifications?limit=10", viewerId, "/api/v1/product/notifications/stats");
      const data = v2Data(v2);
      const items = mapV2NotificationListToLegacyItems(data.items);
      const unreadCount = Number((data.unread as { count?: unknown } | undefined)?.count ?? 0);
      const byType: Record<string, number> = {};
      for (const n of items) {
        const t = String((n as Record<string, unknown>).type ?? "post");
        byType[t] = (byType[t] ?? 0) + 1;
      }
      return reply.send({
        success: true,
        stats: {
          total: items.length,
          unread: unreadCount,
          read: items.filter((n) => Boolean((n as Record<string, unknown>).read)).length,
          byType,
          byPriority: { normal: items.length },
          recentActivity: items.length
        }
      });
    } catch {
      return reply.send({
        success: true,
        stats: {
          total: 0,
          unread: 0,
          read: 0,
          byType: {},
          byPriority: { normal: 0 },
          recentActivity: 0
        }
      });
    }
  });

  async function handleNotificationsReadAll(viewerId: string, reply: FastifyReply): Promise<void> {
    const v2 = await callV2PostWithStatus("/v2/notifications/mark-all-read", viewerId, {});
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const marked = (v2Data(v2.payload).updated as Record<string, unknown> | undefined)?.markedCount;
    return reply.send({
      success: true,
      ...(typeof marked === "number" ? { markedCount: marked } : {})
    });
  }

  app.post("/api/v1/product/notifications/read-all", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    return handleNotificationsReadAll(viewerId, reply);
  });
  app.put("/api/v1/product/notifications/read-all", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    return handleNotificationsReadAll(viewerId, reply);
  });

  app.get("/api/v1/product/chats/bootstrap", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const v2 = await callV2GetOrThrow("/v2/chats/inbox?limit=20", viewerId, "/api/v1/product/chats/bootstrap");
    const items = ((v2.data as Record<string, unknown> | undefined)?.items ?? []) as Array<Record<string, unknown>>;
    const chats = items.map((c, i) => ({
      id: String(c.conversationId ?? `chat_${i + 1}`),
      chatId: String(c.conversationId ?? `chat_${i + 1}`),
      title: String(c.title ?? "Chat"),
      displayPhotoURL: c.displayPhotoUrl ?? null,
      participants: Array.isArray(c.participantIds) ? c.participantIds : []
    }));
    return reply.send({ success: true, chats });
  });
  app.get<{ Params: { chatId: string } }>("/api/v1/product/chats/:chatId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const chatId = encodeURIComponent(String(request.params.chatId ?? ""));
    try {
      const v2 = await callV2GetOrThrow(
        `/v2/chats/${chatId}`,
        viewerId,
        "/api/v1/product/chats/:chatId"
      );
      const data = v2Data(v2);
      const conversation = (data.conversation ?? {}) as Record<string, unknown>;
      return reply.send({
        success: true,
        chat: {
          id: request.params.chatId,
          chatId: request.params.chatId,
          conversationId: request.params.chatId,
          participants: Array.isArray(conversation.participantIds) ? conversation.participantIds : [],
          isGroupChat: Boolean(conversation.isGroup),
          groupName: typeof conversation.title === "string" ? conversation.title : undefined,
          displayPhotoURL: typeof conversation.displayPhotoUrl === "string" ? conversation.displayPhotoUrl : undefined,
          createdAt: conversation.createdAtMs
        }
      });
    } catch {
      return reply.send({
        success: false,
        error: "Failed to fetch chat"
      });
    }
  });
  app.post<{ Body: { otherUserId?: string } }>("/api/v1/product/chats/create-or-get", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const otherUserId = String(request.body?.otherUserId ?? "").trim();
    if (!otherUserId) {
      return reply.status(400).send({ success: false, error: "otherUserId is required" });
    }
    const v2 = await callV2PostOrThrow("/v2/chats/create-or-get", viewerId, "/api/v1/product/chats/create-or-get", { otherUserId });
    const conversationId = String((v2.data as Record<string, unknown> | undefined)?.conversationId ?? "");
    if (!conversationId) {
      throw new Error("/api/v1/product/chats/create-or-get: missing conversationId from canonical v2 response");
    }
    return reply.send({ success: true, chatId: conversationId, conversationId });
  });

  app.post("/api/v1/product/chats/create-group", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const participants = Array.isArray(raw.participants)
      ? (raw.participants as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
      : Array.isArray(raw.participantIds)
        ? (raw.participantIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
    const groupName = String(raw.groupName ?? raw.name ?? "").trim();
    if (participants.length === 0 || !groupName) {
      return reply.status(400).send({ success: false, error: "participants[] and groupName are required" });
    }
    const displayPhotoURL =
      typeof raw.displayPhotoURL === "string"
        ? raw.displayPhotoURL
        : typeof raw.displayPhotoUrl === "string"
          ? raw.displayPhotoUrl
          : undefined;
    const v2 = await callV2PostWithStatus("/v2/chats/create-group", viewerId, {
      participants,
      groupName,
      ...(displayPhotoURL ? { displayPhotoURL } : {})
    });
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const conversationId = String((v2.payload.data as Record<string, unknown> | undefined)?.conversationId ?? "");
    if (!conversationId) {
      return reply.status(500).send({ success: false, error: "missing_conversation_id" });
    }
    return reply.send({ success: true, chatId: conversationId, conversationId });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/v1/product/chats/send-to-multiple", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const body = request.body ?? {};
    const currentUserId = String(body.currentUserId ?? "").trim();
    if (currentUserId && viewerId !== "anonymous" && currentUserId !== viewerId) {
      return reply.status(403).send({ success: false, error: "currentUserId must match viewer" });
    }
    const chatsRaw = body.chats;
    const chatIds: string[] = Array.isArray(chatsRaw)
      ? (chatsRaw as unknown[])
          .map((row) => {
            if (row && typeof row === "object" && "id" in row) {
              return String((row as { id?: unknown }).id ?? "").trim();
            }
            return "";
          })
          .filter((id) => id.length > 0)
      : [];
    const itemId = String(body.itemId ?? "").trim();
    const caption = String(body.sendMessageInput ?? "").trim();
    if (chatIds.length === 0) {
      return reply.status(400).send({ success: false, error: "chats required" });
    }
    if (!itemId && !caption) {
      return reply.status(400).send({ success: false, error: "itemId or sendMessageInput required" });
    }
    const results: Array<{ chatId: string; success: boolean }> = [];
    for (const chatId of chatIds) {
      const enc = encodeURIComponent(chatId);
      try {
        if (itemId) {
          const payload: Record<string, unknown> = {
            messageType: "post",
            postId: itemId,
            ...(caption.length > 0 ? { text: caption } : {})
          };
          await callV2PostOrThrow(`/v2/chats/${enc}/messages`, viewerId, "/api/v1/product/chats/send-to-multiple", payload);
        } else {
          await callV2PostOrThrow(`/v2/chats/${enc}/messages`, viewerId, "/api/v1/product/chats/send-to-multiple", {
            messageType: "text",
            text: caption
          });
        }
        results.push({ chatId, success: true });
      } catch {
        results.push({ chatId, success: false });
      }
    }
    const anyOk = results.some((r) => r.success);
    return reply.send({ success: anyOk, results });
  });
  app.post("/api/v1/product/chats/upload-group-avatar", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      const cfg = readWasabiConfigFromEnv();
      if (!cfg) {
        return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
      }
      const part = await request.file();
      if (!part) {
        return reply.status(400).send({ success: false, error: "Photo file is required" });
      }
      const normalizedType = String(part.mimetype ?? "").trim().toLowerCase() || "image/jpeg";
      if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(normalizedType)) {
        return reply.status(400).send({ success: false, error: `Invalid file type (${normalizedType})` });
      }
      const bytes = await part.toBuffer();
      if (!bytes.length) {
        return reply.status(400).send({ success: false, error: "Empty file" });
      }
      const uploaded = await uploadGroupChatAvatar({
        cfg,
        viewerId,
        bytes,
        contentType: normalizedType
      });
      if (!uploaded.ok) {
        return reply.status(500).send({ success: false, error: uploaded.message });
      }
      return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });
    }
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const imageUrl =
      typeof raw.imageUrl === "string"
        ? raw.imageUrl
        : typeof raw.url === "string"
          ? raw.url
          : typeof raw.photoUrl === "string"
            ? raw.photoUrl
            : "";
    return reply.send({ success: true, imageUrl });
  });
  app.post<{ Params: { chatId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/chats/:chatId/update-group",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const chatId = encodeURIComponent(String(request.params.chatId ?? ""));
      const raw = request.body ?? {};
      const groupName =
        typeof raw.groupName === "string"
          ? raw.groupName
          : typeof raw.name === "string"
            ? raw.name
            : typeof raw.title === "string"
              ? raw.title
              : undefined;
      const displayPhotoURL =
        typeof raw.displayPhotoURL === "string"
          ? raw.displayPhotoURL
          : typeof raw.photoURL === "string"
            ? raw.photoURL
            : typeof raw.imageUrl === "string"
              ? raw.imageUrl
              : undefined;
      const v2 = await callV2PostWithStatus(
        `/v2/chats/${chatId}/update-group`,
        viewerId,
        {
          ...(typeof groupName === "string" && groupName.trim() ? { groupName: groupName.trim() } : {}),
          ...(typeof displayPhotoURL === "string" ? { displayPhotoURL } : {})
        }
      );
      if (v2.statusCode >= 400) {
        return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
      }
      return reply.send({ success: true });
    }
  );
  app.post<{ Params: { chatId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/chats/:chatId/group-photo",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const rawChatId = String(request.params.chatId ?? "");
      const chatId = encodeURIComponent(rawChatId);
      const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
      if (contentType.includes("multipart/form-data")) {
        const cfg = readWasabiConfigFromEnv();
        if (!cfg) {
          return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
        }
        const part = await request.file();
        if (!part) {
          return reply.status(400).send({ success: false, error: "Photo file is required" });
        }
        const normalizedType = String(part.mimetype ?? "").trim().toLowerCase() || "image/jpeg";
        if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(normalizedType)) {
          return reply.status(400).send({ success: false, error: `Invalid file type (${normalizedType})` });
        }
        const bytes = await part.toBuffer();
        if (!bytes.length) {
          return reply.status(400).send({ success: false, error: "Empty file" });
        }
        const uploaded = await uploadGroupChatPhoto({
          cfg,
          viewerId,
          conversationId: rawChatId,
          bytes,
          contentType: normalizedType
        });
        if (!uploaded.ok) {
          return reply.status(500).send({ success: false, error: uploaded.message });
        }
        try {
          await chatsService.updateGroupMetadata({
            viewerId,
            conversationId: rawChatId,
            displayPhotoURL: uploaded.url
          });
          return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });
        } catch (error) {
          if (error instanceof Error) {
            return reply.status(400).send({ success: false, error: error.message });
          }
          throw error;
        }
      }
      const raw = request.body ?? {};
      const displayPhotoURL =
        typeof raw.displayPhotoURL === "string"
          ? raw.displayPhotoURL
          : typeof raw.photoURL === "string"
            ? raw.photoURL
            : typeof raw.imageUrl === "string"
              ? raw.imageUrl
              : typeof raw.url === "string"
                ? raw.url
                : "";
      if (!displayPhotoURL) {
        return reply.status(400).send({ success: false, error: "photo URL required" });
      }
      const v2 = await callV2PostWithStatus(`/v2/chats/${chatId}/update-group`, viewerId, { displayPhotoURL });
      if (v2.statusCode >= 400) {
        return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
      }
      return reply.send({ success: true });
    }
  );
  app.post<{ Params: { chatId: string } }>("/api/v1/product/chats/:chatId/mark-seen", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const chatId = String(request.params.chatId ?? "");
    await callV2PostOrThrow(`/v2/chats/${encodeURIComponent(chatId)}/mark-read`, viewerId, "/api/v1/product/chats/:chatId/mark-seen", {});
    return reply.send({ success: true });
  });
  app.post<{ Params: { chatId: string; messageId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/chats/:chatId/messages/:messageId/reaction",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const chatId = encodeURIComponent(String(request.params.chatId ?? ""));
      const messageId = encodeURIComponent(String(request.params.messageId ?? ""));
      const raw = request.body ?? {};
      const emoji = String(raw.emoji ?? raw.reaction ?? "❤️").trim() || "❤️";
      const v2 = await callV2PostWithStatus(
        `/v2/chats/${chatId}/messages/${messageId}/reaction`,
        viewerId,
        { emoji }
      );
      if (v2.statusCode >= 400) {
        return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
      }
      const data = v2Data(v2.payload);
      return reply.send({
        success: true,
        reactions: data.reactions ?? {},
        viewerReaction: data.viewerReaction ?? null
      });
    }
  );

  app.get("/api/v1/product/collections", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    try {
      const v2 = await callV2GetOrThrow(`/v2/collections?limit=50`, viewerId, "/api/v1/product/collections");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, collections: items.map(mapV2CollectionToLegacy) });
    } catch {
      return reply.send({ success: true, collections: [] });
    }
  });
  app.get("/api/v1/product/collections/generated", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    try {
      const v2 = await callV2GetOrThrow(`/v2/collections?limit=50`, viewerId, "/api/v1/product/collections/generated");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      const baseCollections = items.map(mapV2CollectionToLegacy);
      const mixesRes = await app.inject({
        method: "POST",
        url: "/api/v1/product/collections/system-mixes/bootstrap",
        headers: {
          "x-viewer-id": viewerId,
          "x-viewer-roles": "internal",
          "content-type": "application/json"
        },
        payload: "{}"
      });
      const mixesPayload = (mixesRes.statusCode >= 200 && mixesRes.statusCode < 300
        ? (mixesRes.json() as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const mixCollections = Array.isArray(mixesPayload.collections)
        ? (mixesPayload.collections as Array<Record<string, unknown>>)
        : [];
      const byId = new Map<string, Record<string, unknown>>();
      for (const c of [...baseCollections, ...mixCollections]) {
        const id = String(c.id ?? c.collectionId ?? "");
        if (!id || byId.has(id)) continue;
        byId.set(id, c);
      }
      return reply.send({ success: true, collections: [...byId.values()] });
    } catch {
      return reply.send({ success: true, collections: [] });
    }
  });
  app.post("/api/v1/product/collections/system-mixes/bootstrap", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const cached = mixBootstrapCache.get(viewerId);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.send(cached.payload);
    }
    const inflight = mixBootstrapInFlight.get(viewerId);
    if (inflight) {
      const payload = await inflight;
      return reply.send(payload);
    }
    const runner = (async () => {
    try {
      const v2 = await callV2GetOrThrow("/v2/mixes/catalog?limit=24", viewerId, "/api/v1/product/collections/system-mixes/bootstrap");
      const mixSpecs = (v2Data(v2).mixSpecs ?? []) as Array<Record<string, unknown>>;
      const normalizeActivityToken = (value: unknown): string =>
        String(value ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
      const recentPosts = await loadRecentPosts(160);
      const thumbsByActivity = new Map<string, Array<{ thumb: string; score: number }>>();
      for (const post of recentPosts) {
        const thumb = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();
        if (!/^https?:\/\//i.test(thumb)) continue;
        const titleToken = normalizeActivityToken(post.title);
        const activities = Array.isArray(post.activities) ? post.activities : [];
        for (const raw of activities) {
          const token = normalizeActivityToken(raw);
          if (!token) continue;
          const bucket = thumbsByActivity.get(token) ?? [];
          const score = titleToken.includes(token) ? 2 : 1;
          if (!bucket.some((entry) => entry.thumb === thumb)) {
            bucket.push({ thumb, score });
          }
          bucket.sort((a, b) => b.score - a.score);
          if (bucket.length > 8) bucket.length = 8;
          thumbsByActivity.set(token, bucket);
        }
      }
      const fallbackTitles = [
        "Abandoned Mix",
        "Hiking Mix",
        "View Mix",
        "Waterfall Mix",
        "Park Mix",
        "Ocean Mix",
        "Mountain Mix",
        "Swimming Mix",
      ];
      const fallbackThumbs = recentPosts
        .map((post) => String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim())
        .filter((thumb) => /^https?:\/\//i.test(thumb))
        .filter((thumb, index, arr) => arr.indexOf(thumb) === index)
        .slice(0, 40);
      const seededSpecs =
        mixSpecs.length > 0
          ? mixSpecs
          : fallbackTitles.map((title, i) => ({
              id: `mix_${title.toLowerCase().replace(/\s+mix$/i, "").replace(/[^a-z0-9]+/g, "_")}`,
              title,
              subtitle: "Fresh picks",
              seeds: {},
              _fallbackIndex: i,
            }));
      const collections = seededSpecs.slice(0, 8).map((spec, i) => {
        const id = String(spec.id ?? `system_mix_${i}`);
        const primaryActivity = normalizeActivityToken(
          (spec.seeds as { primaryActivityId?: unknown } | undefined)?.primaryActivityId
        );
        const resolvedThumbs =
          primaryActivity.length > 0
            ? (thumbsByActivity.get(primaryActivity) ?? []).slice(0, 4).map((entry) => entry.thumb)
            : [];
        const randomFallback = fallbackThumbs.length
          ? [
              fallbackThumbs[i % fallbackThumbs.length],
              fallbackThumbs[(i + 3) % fallbackThumbs.length],
              fallbackThumbs[(i + 7) % fallbackThumbs.length],
              fallbackThumbs[(i + 11) % fallbackThumbs.length],
            ].filter((thumb): thumb is string => Boolean(thumb))
          : [];
        const mixCoverThumbUrls =
          resolvedThumbs.length > 0
            ? resolvedThumbs
            : randomFallback;
        const title = String(spec.title ?? "").trim() || (fallbackTitles[i] ?? `Mix ${i + 1}`);
        return {
          id,
          collectionId: id,
          kind: "system_mix" as const,
          name: title,
          title,
          subtitle: String(spec.subtitle ?? ""),
          ownerId: viewerId,
          privacy: "public",
          description: "",
          items: [] as string[],
          collaborators: [] as string[],
          itemsCount: 0,
          coverUri: mixCoverThumbUrls[0] ?? null,
          displayPhotoUrl: mixCoverThumbUrls[0] ?? null,
          mixCoverThumbUrls,
          mixSpec: spec
        };
      });
      return { success: true as const, collections };
    } catch {
      return { success: true as const, collections: [] as Array<Record<string, unknown>> };
    }
    })();
    mixBootstrapInFlight.set(viewerId, runner);
    try {
      const payload = await runner;
      mixBootstrapCache.set(viewerId, { expiresAt: Date.now() + MIX_BOOTSTRAP_CACHE_TTL_MS, payload });
      return reply.send(payload);
    } finally {
      mixBootstrapInFlight.delete(viewerId);
    }
  });
  app.get<{ Params: { collectionId: string } }>("/api/v1/product/collections/:collectionId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const collectionId = encodeURIComponent(String(request.params.collectionId ?? ""));
    const v2 = await callV2Get(`/v2/collections/${collectionId}`, viewerId);
    if (!v2) {
      return reply.status(404).send({ success: false, error: "Collection not found" });
    }
    const item = v2Data(v2).item as Record<string, unknown> | undefined;
    if (!item) {
      return reply.status(404).send({ success: false, error: "Collection not found" });
    }
    const base = mapV2CollectionToLegacy(item);
    const postIds = Array.isArray(item.items) ? (item.items as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const posts = postIds.map((postId) => ({ postId, id: postId }));
    return reply.send({
      success: true,
      collection: { ...base, posts }
    });
  });
  app.post<{ Params: { collectionId: string } }>("/api/v1/product/collections/:collectionId/opened", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const collectionId = String(request.params.collectionId ?? "").trim();
    const row = await collectionTelemetryRepository.recordOpened(viewerId, collectionId);
    return reply.send({ success: true, openCount: row.openCount, lastOpenedAtMs: row.lastOpenedAtMs });
  });
  app.post<{ Params: { collectionId: string } }>("/api/v1/product/collections/:collectionId/ensure-accent-color", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const collectionId = String(request.params.collectionId ?? "").trim();
    const row = await collectionTelemetryRepository.recordAccentEnsured(viewerId, collectionId);
    return reply.send({ success: true, accentEnsuredAtMs: row.accentEnsuredAtMs });
  });
  const handleCollectionCoverUpload = async (request: any, reply: any) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      let coverUri = "";
      const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
      if (contentType.includes("multipart/form-data")) {
        const part = await request.file();
        if (!part) {
          return reply.status(400).send({ success: false, error: "cover file required" });
        }
        const cfg = getWasabiConfigOrNull();
        if (!cfg) {
          return reply.status(503).send({ success: false, error: "Wasabi configuration unavailable" });
        }
        const fileBuffer = await part.toBuffer();
        const destinationKey = `collections/covers/${viewerId}/${collectionId}/${Date.now()}.jpg`;
        const upload = await uploadPostSessionStagingFromBuffer(
          cfg,
          viewerId,
          `collection-cover-${collectionId}`,
          0,
          "photo",
          fileBuffer,
          { destinationKey, contentType: "image/jpeg" }
        );
        if (!upload.success) {
          return reply.status(500).send({ success: false, error: upload.error ?? "cover_upload_failed" });
        }
        coverUri = wasabiPublicUrlForKey(cfg, destinationKey);
      } else {
        const raw = request.body ?? {};
        coverUri =
          typeof raw.coverUri === "string"
            ? raw.coverUri
            : typeof raw.url === "string"
              ? raw.url
              : typeof raw.imageUrl === "string"
                ? raw.imageUrl
                : "";
      }
      if (!coverUri) {
        return reply.status(400).send({ success: false, error: "cover URL or file required" });
      }
      const updated = await collectionsAdapter.updateCollection({
        viewerId,
        collectionId,
        updates: { coverUri }
      });
      if (!updated.collection) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true, collection: mapV2CollectionToLegacy(updated.collection as unknown as Record<string, unknown>) });
  };
  app.put<{ Params: { collectionId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/collections/:collectionId/cover",
    async (request, reply) => handleCollectionCoverUpload(request, reply)
  );
  app.post<{ Params: { collectionId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/collections/:collectionId/cover",
    async (request, reply) => handleCollectionCoverUpload(request, reply)
  );

  /**
   * Legacy chat photo upload parity.
   * Native expects: POST /api/media/upload-photo (multipart field "file") → { success, url }.
   * Backendv2 owns this path when EXPO_PUBLIC_BACKEND_URL points at v2.
   */
  app.post("/api/media/upload-photo", async (request, reply) => {
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
    const ext =
      typeof part.mimetype === "string" && part.mimetype.toLowerCase().includes("png") ? "png" : "jpg";
    const destinationKey = `chatPhotos/${viewerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const upload = await uploadPostSessionStagingFromBuffer(
      cfg,
      viewerId,
      `chat-photo-${viewerId}`,
      0,
      "photo",
      fileBuffer,
      { destinationKey, contentType: part.mimetype || "image/jpeg" }
    );
    if (!upload.success) {
      return reply.status(500).send({ success: false, error: upload.error ?? "chat_photo_upload_failed" });
    }
    const url = wasabiPublicUrlForKey(cfg, destinationKey);
    return reply.send({ success: true, url });
  });
  app.post<{ Params: { collectionId: string; collaboratorId: string } }>(
    "/api/v1/product/collections/:collectionId/collaborators/:collaboratorId",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const collaboratorId = String(request.params.collaboratorId ?? "").trim();
      if (!collectionId || !collaboratorId) {
        return reply.status(400).send({ success: false, error: "collectionId and collaboratorId are required" });
      }
      const updated = await collectionsAdapter.addCollaboratorToCollection({
        viewerId,
        collectionId,
        collaboratorId
      });
      if (!updated.collection) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true });
    }
  );
  app.delete<{ Params: { collectionId: string; collaboratorId: string } }>(
    "/api/v1/product/collections/:collectionId/collaborators/:collaboratorId",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const collaboratorId = String(request.params.collaboratorId ?? "").trim();
      if (!collectionId || !collaboratorId) {
        return reply.status(400).send({ success: false, error: "collectionId and collaboratorId are required" });
      }
      const updated = await collectionsAdapter.removeCollaboratorFromCollection({
        viewerId,
        collectionId,
        collaboratorId
      });
      if (!updated.collection) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true });
    }
  );
  app.post<{ Params: { collectionId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/collections/:collectionId/collaborators",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const raw = request.body ?? {};
      const collaboratorId = String(raw.userId ?? raw.collaboratorId ?? raw.participantId ?? "").trim();
      if (!collaboratorId) {
        return reply.status(400).send({ success: false, error: "userId or collaboratorId required" });
      }
      const updated = await collectionsAdapter.addCollaboratorToCollection({
        viewerId,
        collectionId,
        collaboratorId
      });
      if (!updated.collection) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true });
    }
  );
  app.post<{ Params: { collectionId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/collections/:collectionId/posts",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const raw = request.body ?? {};
      const postId = String(raw.postId ?? raw.id ?? "").trim();
      if (!postId) {
        return reply.status(400).send({ success: false, error: "postId required" });
      }
      const updated = await collectionsAdapter.addPostToCollection({ viewerId, collectionId, postId });
      if (!updated.changed) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true });
    }
  );
  app.get<{ Params: { collectionId: string } }>("/api/v1/product/collections/:collectionId/posts", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const collectionId = encodeURIComponent(String(request.params.collectionId ?? ""));
    const v2 = await callV2Get(`/v2/collections/${collectionId}`, viewerId);
    if (!v2) {
      return reply.send({ success: true, posts: [] });
    }
    const item = v2Data(v2).item as Record<string, unknown> | undefined;
    const postIds = Array.isArray(item?.items)
      ? (item.items as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const posts = postIds.map((postId) => ({ postId, id: postId }));
    return reply.send({ success: true, posts });
  });
  app.delete<{ Params: { collectionId: string; postId: string } }>(
    "/api/v1/product/collections/:collectionId/posts/:postId",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const postId = String(request.params.postId ?? "").trim();
      const updated = await collectionsAdapter.removePostFromCollection({ viewerId, collectionId, postId });
      if (!updated.changed) {
        return reply.status(404).send({ success: false, error: "Collection not found or not permitted" });
      }
      return reply.send({ success: true });
    }
  );
  app.post<{ Body: Record<string, unknown> }>("/api/v1/product/collections", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const raw = request.body ?? {};
    const name = String(raw.name ?? raw.title ?? "").trim();
    if (!name) {
      return reply.status(400).send({ success: false, error: "name or title is required" });
    }
    const privacyRaw = String(raw.privacy ?? "private").toLowerCase();
    const privacy = privacyRaw === "public" ? "public" : "private";
    const collaborators = Array.isArray(raw.collaborators)
      ? (raw.collaborators as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const items = Array.isArray(raw.items)
      ? (raw.items as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const coverUri =
      typeof raw.coverUri === "string"
        ? raw.coverUri
        : typeof raw.coverURL === "string"
          ? raw.coverURL
          : typeof raw.displayPhotoUrl === "string"
            ? raw.displayPhotoUrl
            : undefined;
    const v2 = await callV2PostWithStatus("/v2/collections", viewerId, {
      name,
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      privacy,
      collaborators,
      items,
      ...(coverUri ? { coverUri } : {})
    });
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const data = v2Data(v2.payload);
    const collection = data.collection as Record<string, unknown> | undefined;
    const collectionId = String(data.collectionId ?? collection?.id ?? "");
    if (!collectionId) {
      return reply.status(500).send({ success: false, error: "missing_collection_id" });
    }
    return reply.send({
      success: true,
      collectionId,
      ...(collection ? { collection: mapV2CollectionToLegacy(collection) } : {})
    });
  });
  app.patch<{ Params: { collectionId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/collections/:collectionId",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const collectionId = String(request.params.collectionId ?? "").trim();
      const raw = request.body ?? {};
      const updates: Record<string, unknown> = {};
      if (typeof raw.name === "string") updates.name = raw.name;
      if (typeof raw.title === "string") updates.name = raw.title;
      if (typeof raw.description === "string") updates.description = raw.description;
      const pr = String(raw.privacy ?? "").toLowerCase();
      if (pr === "public" || pr === "private" || pr === "friends") updates.privacy = pr;
      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ success: false, error: "No updatable fields" });
      }
      const v2 = await callV2PatchWithStatus(`/v2/collections/${encodeURIComponent(collectionId)}`, viewerId, updates);
      if (v2.statusCode >= 400) {
        return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
      }
      return reply.send({ success: true });
    }
  );
  app.delete<{ Params: { collectionId: string } }>("/api/v1/product/collections/:collectionId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const collectionId = String(request.params.collectionId ?? "").trim();
    const v2 = await callV2DeleteWithStatus(`/v2/collections/${encodeURIComponent(collectionId)}`, viewerId);
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    return reply.send({ success: true });
  });

  app.get<{ Params: { postId: string } }>("/api/v1/product/comments/:postId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const postId = encodeURIComponent(String(request.params.postId ?? ""));
    try {
      const v2 = await callV2GetOrThrow(`/v2/posts/${postId}/comments?limit=20`, viewerId, "/api/v1/product/comments/:postId");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, comments: items.map(mapV2CommentToLegacy) });
    } catch {
      return reply.send({ success: true, comments: [] });
    }
  });
  app.post<{ Params: { postId: string }; Body: Record<string, unknown> }>(
    "/api/v1/product/comments/:postId",
    async (request, reply) => {
      const viewerId = resolveCompatViewerId(request);
      const postId = encodeURIComponent(String(request.params.postId ?? ""));
      const raw = (request.body ?? {}) as Record<string, unknown>;
      const text = String(raw.text ?? raw.content ?? "").trim();
      if (!text) {
        return reply.status(400).send({ success: false, error: "text or content is required" });
      }
      try {
        const v2 = await callV2PostOrThrow(`/v2/posts/${postId}/comments`, viewerId, "/api/v1/product/comments/:postId", {
          text
        });
        const comment = v2Data(v2).comment as Record<string, unknown> | undefined;
        return reply.send({ success: true, comment: comment ? mapV2CommentToLegacy(comment) : null });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : "comment_create_failed"
        });
      }
    }
  );
  app.post<{ Params: { postId: string; commentId: string } }>("/api/v1/product/comments/:postId/:commentId/like", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const commentId = encodeURIComponent(String(request.params.commentId ?? ""));
    const v2 = await callV2PostWithStatus(`/v2/comments/${commentId}/like`, viewerId, {});
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const data = v2Data(v2.payload);
    const liked =
      typeof data.liked === "boolean"
        ? data.liked
        : Boolean((data.viewerState as Record<string, unknown> | undefined)?.liked);
    return reply.send({ success: true, liked });
  });
  app.delete<{ Params: { postId: string; commentId: string } }>("/api/v1/product/comments/:postId/:commentId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const commentId = encodeURIComponent(String(request.params.commentId ?? ""));
    const v2 = await callV2DeleteWithStatus(`/v2/comments/${commentId}`, viewerId);
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    return reply.send({ success: true });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/v1/product/social/batch", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const body = request.body ?? {};
    const postIds = Array.isArray(body.postIds)
      ? (body.postIds as unknown[]).filter((id): id is string => typeof id === "string")
      : Array.isArray(body.ids)
        ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
    const unique = [...new Set(postIds.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 60);
    if (unique.length === 0) return reply.send({ success: true, items: [] });

    const postsBatch = new CompatPostsBatchOrchestrator();
    const posts = (await postsBatch.run({ postIds: unique })).posts;
    const byId = new Map(posts.map((p) => [String((p as any).postId ?? (p as any).id ?? ""), p]));

    const items = unique
      .map((postId) => {
        const row = byId.get(postId) as Record<string, unknown> | undefined;
        const likeCountRaw = row?.likeCount ?? row?.likesCount;
        const commentCountRaw = row?.commentCount ?? row?.commentsCount;
        const likeCount = typeof likeCountRaw === "number" && Number.isFinite(likeCountRaw) ? Math.max(0, likeCountRaw) : 0;
        const commentCount =
          typeof commentCountRaw === "number" && Number.isFinite(commentCountRaw) ? Math.max(0, commentCountRaw) : 0;
        return {
          postId,
          likeCount,
          commentCount,
          viewerHasLiked: mutationStateRepository.hasViewerLikedPost(viewerId, postId),
          viewerHasSaved: mutationStateRepository.resolveViewerSavedPost(viewerId, postId, false)
        };
      })
      .filter((it) => it.postId);

    request.log.info(
      {
        route: "/api/v1/product/social/batch",
        compat: true,
        requested: unique.length,
        returned: items.length
      },
      "SOCIAL_BATCH"
    );
    return reply.send({ success: true, items });
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/v1/product/social/batch", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const raw = request.query ?? {};
    const postIds: string[] = [];
    const q = raw as any;
    const rawIds = q.postIds ?? q.ids ?? q.postId ?? q.id;
    if (Array.isArray(rawIds)) {
      for (const v of rawIds) {
        if (typeof v === "string" && v.trim()) postIds.push(v.trim());
      }
    } else if (typeof rawIds === "string" && rawIds.trim()) {
      // Support comma-separated, just in case a caller passes `postIds=a,b,c`
      const parts = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
      postIds.push(...parts);
    }
    const unique = [...new Set(postIds.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 60);
    if (unique.length === 0) return reply.send({ success: true, items: [] });

    const postsBatch = new CompatPostsBatchOrchestrator();
    const posts = (await postsBatch.run({ postIds: unique })).posts;
    const byId = new Map(posts.map((p) => [String((p as any).postId ?? (p as any).id ?? ""), p]));

    const items = unique
      .map((postId) => {
        const row = byId.get(postId) as Record<string, unknown> | undefined;
        const likeCountRaw = row?.likeCount ?? row?.likesCount;
        const commentCountRaw = row?.commentCount ?? row?.commentsCount;
        const likeCount = typeof likeCountRaw === "number" && Number.isFinite(likeCountRaw) ? Math.max(0, likeCountRaw) : 0;
        const commentCount =
          typeof commentCountRaw === "number" && Number.isFinite(commentCountRaw) ? Math.max(0, commentCountRaw) : 0;
        return {
          postId,
          likeCount,
          commentCount,
          viewerHasLiked: mutationStateRepository.hasViewerLikedPost(viewerId, postId),
          viewerHasSaved: mutationStateRepository.resolveViewerSavedPost(viewerId, postId, false)
        };
      })
      .filter((it) => it.postId);

    request.log.info(
      {
        route: "/api/v1/product/social/batch",
        compat: true,
        method: "GET",
        requested: unique.length,
        returned: items.length
      },
      "SOCIAL_BATCH"
    );
    return reply.send({ success: true, items });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/v1/product/social/toggle-like", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const raw = request.body ?? {};
    const postId = String(raw.postId ?? raw.postID ?? raw.id ?? "").trim();
    if (!postId) {
      return reply.status(400).send({ success: false, error: "postId required" });
    }
    const enc = encodeURIComponent(postId);
    const currentlyLiked = mutationStateRepository.hasViewerLikedPost(viewerId, postId);
    const path = currentlyLiked ? `/v2/posts/${enc}/unlike` : `/v2/posts/${enc}/like`;
    const v2 = await callV2PostWithStatus(path, viewerId, {});
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const liked = Boolean((v2Data(v2.payload) as Record<string, unknown>).liked ?? !currentlyLiked);
    return reply.send({ success: true, liked });
  });

  app.get("/api/v1/product/social/me/liked-ids", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const postIds = mutationStateRepository.listViewerLikedPostIds(viewerId);
    return reply.send({ success: true, postIds });
  });

  app.post("/api/v1/product/feed/seen/clear", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const result = await feedSeenRepository.clearForViewer(viewerId);
    return reply.send({ success: true, clearedCount: 1, clearedAtMs: result.clearedAtMs, nonce: result.nonce });
  });

  // Reels near-me/for-you/following are served by `registerLegacyMonolithProductProxyRoutes`
  // (monolith proxy or explicit 503). Avoid local fallback feed synthesis here.

  app.get<{ Querystring: { bbox?: string; limit?: string } }>("/api/v1/product/map/bootstrap", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const bbox = String(request.query.bbox ?? "-125.0,24.0,-66.0,49.0");
    const limit = Math.max(1, Math.min(5000, Number(request.query.limit ?? 120) || 120));
    const v2 = await callV2GetOrThrow(
      `/v2/map/bootstrap?bbox=${encodeURIComponent(bbox)}&limit=${limit}`,
      viewerId,
      "/api/v1/product/map/bootstrap"
    );
    const markers = ((v2.data as Record<string, unknown> | undefined)?.markers ?? []) as Array<Record<string, unknown>>;
    const posts = markers.map((m) => ({
      postId: String(m.postId ?? ""),
      lat: Number(m.lat ?? 0),
      lng: Number(m.lng ?? 0),
      thumbUrl: String(m.thumbUrl ?? ""),
      mediaType: String(m.mediaType ?? "image"),
      ts: Number(m.updatedAtMs ?? Date.now()),
      likesCount: Number((m.social as Record<string, unknown> | undefined)?.likeCount ?? 0),
      activityIds: Array.isArray(m.activityIds) ? m.activityIds : [],
      userId: String(m.userId ?? ""),
      userPic: String(m.userPic ?? "")
    }));
    return reply.send({ success: true, posts, nextCursor: null, serverTs: Date.now() });
  });

  // Location autocomplete / geocode are served only by `registerLegacyMonolithProductProxyRoutes`
  // (monolith proxy or explicit 503). Do not register stub handlers here — they would override the proxy.

  app.get("/api/v1/product/activities/list", async (_request, reply) =>
    reply.send({ success: true, activities: await loadTopActivities(24) })
  );
  app.post<{ Body: { query?: string } }>("/api/v1/product/activities/suggest", async (request, reply) => {
    const q = String(request.body?.query ?? "").trim().toLowerCase();
    const activities = await loadTopActivities(24);
    const suggestions = q ? activities.filter((activity) => activity.includes(q)).slice(0, 10) : activities.slice(0, 10);
    return reply.send({ success: true, suggestions });
  });

  app.get<{ Params: { viewerId: string }; Querystring: { limit?: string; cursor?: string } }>(
    "/api/v1/product/connections/user/:viewerId/story-users",
    async (request, reply) => {
      const viewerId = String(request.params.viewerId ?? "").trim();
      if (!viewerId) return reply.send({ success: true, users: [], storyUsers: [], nextCursor: null });
      const page = await loadSearchStoryUsersPage({
        viewerId,
        limit: Math.max(1, Math.min(24, Number(request.query.limit ?? 10) || 10)),
        cursor: String(request.query.cursor ?? "").trim() || null,
      });
      return reply.send({
        success: true,
        users: page.storyUsers,
        storyUsers: page.storyUsers,
        nextCursor: page.nextCursor,
      });
    }
  );
  app.post<{
    Params: { viewerId: string };
    Body: { limit?: number; cursor?: string | null; seenPostIds?: string[]; suggestedUserIds?: string[] };
  }>("/api/v1/product/connections/user/:viewerId/story-users", async (request, reply) => {
    const viewerId = String(request.params.viewerId ?? "").trim();
    if (!viewerId) return reply.send({ success: true, users: [], storyUsers: [], nextCursor: null });
    const body = (request.body ?? {}) as {
      limit?: number;
      cursor?: string | null;
      seenPostIds?: string[];
      suggestedUserIds?: string[];
    };
    const page = await loadSearchStoryUsersPage({
      viewerId,
      limit: Math.max(1, Math.min(24, Number(body.limit ?? 10) || 10)),
      cursor: body.cursor ?? null,
      seenPostIds: Array.isArray(body.seenPostIds) ? body.seenPostIds : [],
      suggestedUserIds: Array.isArray(body.suggestedUserIds) ? body.suggestedUserIds : [],
    });
    return reply.send({
      success: true,
      users: page.storyUsers,
      storyUsers: page.storyUsers,
      nextCursor: page.nextCursor,
    });
  });

  app.get<{ Params: { userId: string } }>("/api/v1/product/users/:userId/collections", async (request, reply) => {
    const target = String(request.params.userId ?? "").trim();
    const viewerId = resolveCompatViewerId(request);
    if (!target || target !== viewerId) {
      return reply.send({ success: true, collections: [] });
    }
    try {
      const v2 = await callV2GetOrThrow(`/v2/collections?limit=50`, viewerId, "/api/v1/product/users/:userId/collections");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, collections: items.map(mapV2CollectionToLegacy) });
    } catch {
      return reply.send({ success: true, collections: [] });
    }
  });
  app.get<{ Params: { userId: string } }>("/api/v1/product/users/:userId/suggested-follows", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const target = String(request.params.userId ?? "").trim();
    if (!target || target !== viewerId) {
      return reply.send({ success: true, users: [] });
    }
    try {
      const v2 = await callV2GetOrThrow(`/v2/directory/users?limit=12&q=`, viewerId, "/api/v1/product/users/:userId/suggested-follows");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, users: items.map(mapV2DirectoryUserToLegacy) });
    } catch {
      return reply.send({ success: true, users: [] });
    }
  });

  app.post("/api/v1/product/chats/send-text-message", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const chatId = String(body.chatId ?? "").trim();
    const content = String(body.content ?? "").trim();
    const senderId = String(body.senderId ?? "").trim();
    if (!chatId || !content) {
      return reply.status(400).send({ success: false, error: "Chat ID and content are required" });
    }
    if (senderId && senderId !== viewerId && viewerId !== "anonymous") {
      return reply.status(403).send({ success: false, error: "senderId must match authenticated viewer" });
    }
    try {
      const v2 = await callV2PostOrThrow(
        `/v2/chats/${encodeURIComponent(chatId)}/messages`,
        viewerId,
        "/api/v1/product/chats/send-text-message",
        { messageType: "text", text: content }
      );
      const msg = (v2Data(v2).message as Record<string, unknown> | undefined) ?? {};
      return reply.send({ success: true, messageId: String(msg.messageId ?? "") });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "send_text_failed"
      });
    }
  });
  app.post("/api/v1/product/chats/send-text-with-reply", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const chatId = String(body.chatId ?? "").trim();
    const content = String(body.content ?? "").trim();
    const senderId = String(body.senderId ?? "").trim();
    const replyingTo = body.replyingTo != null ? String(body.replyingTo).trim() : "";
    if (!chatId || !content) {
      return reply.status(400).send({ success: false, error: "Chat ID and content are required" });
    }
    if (senderId && senderId !== viewerId && viewerId !== "anonymous") {
      return reply.status(403).send({ success: false, error: "senderId must match authenticated viewer" });
    }
    try {
      const v2 = await callV2PostOrThrow(
        `/v2/chats/${encodeURIComponent(chatId)}/messages`,
        viewerId,
        "/api/v1/product/chats/send-text-with-reply",
        {
          messageType: "text",
          text: content,
          ...(replyingTo ? { replyingToMessageId: replyingTo } : {})
        }
      );
      const msg = (v2Data(v2).message as Record<string, unknown> | undefined) ?? {};
      return reply.send({ success: true, messageId: String(msg.messageId ?? "") });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "send_text_reply_failed"
      });
    }
  });
  app.post("/api/v1/product/chats/send-photo-message", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const chatId = String(body.chatId ?? "").trim();
    const photoUrl = String(body.photoUrl ?? "").trim();
    const senderId = String(body.senderId ?? "").trim();
    if (!chatId || !photoUrl) {
      return reply.status(400).send({ success: false, error: "Chat ID and photoUrl are required" });
    }
    if (senderId && senderId !== viewerId && viewerId !== "anonymous") {
      return reply.status(403).send({ success: false, error: "senderId must match authenticated viewer" });
    }
    try {
      const v2 = await callV2PostOrThrow(
        `/v2/chats/${encodeURIComponent(chatId)}/messages`,
        viewerId,
        "/api/v1/product/chats/send-photo-message",
        { messageType: "photo", photoUrl }
      );
      const msg = (v2Data(v2).message as Record<string, unknown> | undefined) ?? {};
      return reply.send({ success: true, messageId: String(msg.messageId ?? "") });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "send_photo_failed"
      });
    }
  });

  app.get("/api/v1/product/groups", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    try {
      const v2 = await callV2GetOrThrow(`/v2/groups?limit=30`, viewerId, "/api/v1/product/groups");
      const items = (v2Data(v2).items as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, groups: items });
    } catch (error) {
      return reply.status(503).send({
        success: false,
        error: error instanceof Error ? error.message : "groups_list_failed"
      });
    }
  });
  app.post<{ Body: Record<string, unknown> }>("/api/v1/product/groups", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const raw = request.body ?? {};
    const name = String(raw.name ?? raw.title ?? "").trim();
    if (!name) {
      return reply.status(400).send({ success: false, error: "name required" });
    }
    const v2 = await callV2PostWithStatus("/v2/groups", viewerId, {
      name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      coverUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : typeof raw.coverUrl === "string" ? raw.coverUrl : undefined
    });
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const group = (v2Data(v2.payload).group as Record<string, unknown> | undefined) ?? {};
    return reply.send({ success: true, group });
  });
  app.get<{ Params: { groupId: string } }>("/api/v1/product/groups/:groupId", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const gid = encodeURIComponent(String(request.params.groupId ?? ""));
    try {
      const v2 = await callV2GetOrThrow(`/v2/groups/${gid}`, viewerId, "/api/v1/product/groups/:groupId");
      const payload = v2Data(v2);
      const group = payload.group as Record<string, unknown> | undefined;
      const members = Array.isArray(group?.members) ? group.members : [];
      return reply.send({ success: true, group: group ?? null, members });
    } catch (error) {
      return reply.status(404).send({
        success: false,
        error: error instanceof Error ? error.message : "group_not_found"
      });
    }
  });
  app.post<{ Params: { groupId: string } }>("/api/v1/product/groups/:groupId/join", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const gid = encodeURIComponent(String(request.params.groupId ?? ""));
    const v2 = await callV2PostWithStatus(`/v2/groups/${gid}/join`, viewerId, {});
    if (v2.statusCode >= 400) {
      return reply.status(v2.statusCode).send({ success: false, error: compatErrorMessage(v2.payload) });
    }
    const group = (v2Data(v2.payload).group as Record<string, unknown> | undefined) ?? {};
    return reply.send({ success: true, group });
  });
}
