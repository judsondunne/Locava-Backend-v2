import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { diagnosticsStore, type RequestDiagnostic } from "../../observability/diagnostics-store.js";
import { isLocalDevIdentityModeEnabled, resolveLocalDevIdentityContext } from "../../lib/local-dev-identity.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";
import { buildLegendScopeId } from "../../domains/legends/legends.types.js";
import { getAnalyticsIngestService } from "../../services/analytics/analytics-runtime.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";
import { legacyNotificationPushPublisher } from "../../services/notifications/legacy-notification-push.publisher.js";
import { chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { ChatsService } from "../../services/surfaces/chats.service.js";
import { ChatsSendMessageOrchestrator } from "../../orchestration/mutations/chats-send-message.orchestrator.js";

const LocalViewerQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  internal: z.coerce.boolean().optional().default(true)
});

const DebugNotificationActorSchema = z.object({
  recipientUserId: z.string().min(1),
  actorUserId: z.string().min(1),
});

const DebugPostLikeSchema = DebugNotificationActorSchema.extend({
  postId: z.string().min(1),
});

const DebugCommentSchema = DebugPostLikeSchema.extend({
  commentText: z.string().min(1).default("Testing Backend v2 comment notification deep link"),
});

const DebugChatSchema = DebugNotificationActorSchema.extend({
  messageText: z.string().min(1).default("Testing Backend v2 realtime chat notification"),
});

const DebugPushDryRunSchema = z.object({
  recipientUserId: z.string().min(1),
  actorUserId: z.string().min(1),
  postId: z.string().optional(),
  type: z.string().min(1),
  send: z.coerce.boolean().optional().default(false),
});

/** Subset of HTTP verbs supported by `app.inject` typings (excludes e.g. TRACE). */
type LocalDebugHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

type DebugRouteCall = {
  method: LocalDebugHttpMethod;
  path: string;
  body?: unknown;
  explicitViewerId?: string;
  internal: boolean;
};

type LocalDebugRouteResult = {
  canonicalRoute: string;
  statusCode: number;
  ok: boolean;
  envelopeOk: boolean | null;
  usedRealFirestoreData: boolean;
  ids: string[];
  counts: Record<string, number>;
  timingMs: { total: number; routeLatency: number | null };
  fallbackUsage: string[];
  timeoutUsage: string[];
  legacyPathUsage: boolean;
  verificationNotes: string[];
  envelopeMeta: unknown;
  responseData: unknown;
  responseError: unknown;
  effectiveViewerId: string;
  localDevIdentityModeUsed: boolean;
  usedDefaultViewerId: boolean;
};

type InjectLiteReply = { statusCode: number; payload: string };

type ParsedEnvelope = {
  ok?: boolean;
  data?: unknown;
  error?: unknown;
  meta?: { requestId?: string; latencyMs?: number; db?: unknown };
};

function normalizeActivityForBackfill(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, "_").slice(0, 128);
}

function normalizeCityKey(state: string, city: string): string {
  return `${state}_${normalizeLowerLocationKey(city)}`;
}

function normalizeStateKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return normalizeUpperLocationKey(value);
}

function normalizeCountryKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return normalizeUpperLocationKey(trimmed);
}

function normalizeUpperLocationKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeLowerLocationKey(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function resolveLegendScopeMetaForBackfill(scopeId: string): {
  scopeType: "place" | "activity" | "placeActivity";
  title: string;
  subtitle: string;
  placeType: "state" | "city" | "country" | null;
  placeId: string | null;
  activityId: string | null;
} {
  const parts = scopeId.split(":").map((part) => part.trim());
  if (parts[0] === "activity") {
    const activityId = parts[1] ?? "";
    const label = activityId.replace(/_/g, " ").trim() || "Activity";
    return {
      scopeType: "activity",
      title: `${label} Legend`,
      subtitle: "Across Locava",
      placeType: null,
      placeId: null,
      activityId: activityId || null
    };
  }
  if (parts[0] === "placeActivity") {
    const placeType = parts[1] === "city" ? "city" : parts[1] === "country" ? "country" : "state";
    const placeId = parts[2] ?? "";
    const activityId = parts[3] ?? "";
    const label = activityId.replace(/_/g, " ").trim() || "Activity";
    return {
      scopeType: "placeActivity",
      title: `${label} Legend`,
      subtitle: placeId ? `${placeType.toUpperCase()} ${placeId}` : placeType.toUpperCase(),
      placeType,
      placeId: placeId || null,
      activityId: activityId || null
    };
  }
  const placeType = parts[1] === "city" ? "city" : parts[1] === "country" ? "country" : "state";
  const placeId = parts[2] ?? "";
  return {
    scopeType: "place",
    title: "Local Legend",
    subtitle: placeId ? `${placeType.toUpperCase()} ${placeId}` : placeType.toUpperCase(),
    placeType,
    placeId: placeId || null,
    activityId: null
  };
}

function parseJsonPayload(payload: string): ParsedEnvelope | null {
  if (!payload || payload.length === 0) {
    return null;
  }
  try {
    return JSON.parse(payload) as ParsedEnvelope;
  } catch {
    return null;
  }
}

function findDiagnostic(requestId: string | undefined): RequestDiagnostic | null {
  if (!requestId) return null;
  const recent = diagnosticsStore.getRecentRequests(200);
  return recent.find((row) => row.requestId === requestId) ?? null;
}

function summarizePayload(payload: unknown): { counts: Record<string, number>; ids: string[] } {
  const counts: Record<string, number> = {};
  const ids: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      counts.arrayItems = (counts.arrayItems ?? 0) + value.length;
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (Array.isArray(nested)) {
        counts[key] = nested.length;
      } else if (typeof nested === "string" && /(id|Id|ID)$/.test(key)) {
        ids.push(nested);
      } else if (nested && typeof nested === "object") {
        visit(nested);
      }
    }
  };

  visit(payload);
  return { counts, ids: [...new Set(ids)].slice(0, 20) };
}

async function callCanonicalRoute(app: FastifyInstance, input: DebugRouteCall): Promise<LocalDebugRouteResult> {
  const startedAtMs = Date.now();
  const identity = resolveLocalDevIdentityContext(input.explicitViewerId);
  const headers: Record<string, string> = {
    "x-viewer-id": identity.viewerId,
    "x-viewer-roles": input.internal ? "internal" : ""
  };
  if (input.body !== undefined) headers["content-type"] = "application/json";
  const payloadStr =
    input.body === undefined ? undefined : typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const response = (await app.inject({
    method: input.method,
    url: input.path,
    headers,
    ...(payloadStr !== undefined ? { payload: payloadStr } : {})
  })) as InjectLiteReply;
  const elapsedMs = Date.now() - startedAtMs;
  const envelope = parseJsonPayload(response.payload);
  const diagnostic = findDiagnostic(envelope?.meta?.requestId);
  const payloadSummary = summarizePayload(envelope?.data);
  const legacyPathUsed = input.path.startsWith("/api/");
  app.log.info(
    { debugRoutePath: input.path, effectiveViewerId: identity.viewerId, localDevIdentityModeUsed: identity.localDevIdentityModeEnabled },
    "local debug identity applied"
  );

  return {
    canonicalRoute: `${input.method} ${input.path}`,
    statusCode: response.statusCode,
    ok: response.statusCode >= 200 && response.statusCode < 300,
    envelopeOk: envelope?.ok ?? null,
    usedRealFirestoreData: Boolean(diagnostic && (diagnostic.dbOps.reads > 0 || diagnostic.dbOps.queries > 0)),
    ids: payloadSummary.ids,
    counts: payloadSummary.counts,
    timingMs: {
      total: elapsedMs,
      routeLatency: diagnostic?.latencyMs ?? null
    },
    fallbackUsage: diagnostic?.fallbacks ?? [],
    timeoutUsage: diagnostic?.timeouts ?? [],
    legacyPathUsage: legacyPathUsed,
    verificationNotes: [
      diagnostic?.routeName ? `routeName=${diagnostic.routeName}` : "routeName=unknown",
      `requestId=${envelope?.meta?.requestId ?? "unknown"}`
    ],
    envelopeMeta: envelope?.meta ?? null,
    responseData: envelope?.data ?? null,
    responseError: envelope?.error ?? null,
    effectiveViewerId: identity.viewerId,
    localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
    usedDefaultViewerId: identity.usedDefaultViewerId
  };
}

export async function registerLocalDebugRoutes(app: FastifyInstance): Promise<void> {
  if (!isLocalDevIdentityModeEnabled()) {
    app.log.info({ routeFamily: "/debug/local/*" }, "local debug routes disabled (ENABLE_LOCAL_DEV_IDENTITY!=1)");
    return;
  }

  const notificationsService = new NotificationsService(notificationsRepository);
  const chatsService = new ChatsService(chatsRepository);
  const chatsSendMessageOrchestrator = new ChatsSendMessageOrchestrator(chatsService);
  const db = getFirestoreSourceClient();

  const fetchSenderMeta = async (userId: string): Promise<Record<string, unknown>> => {
    if (!db) return {};
    const snap = await db.collection("users").doc(userId).get();
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return {
      senderName: typeof data.name === "string" ? data.name : typeof data.displayName === "string" ? data.displayName : undefined,
      senderProfilePic:
        typeof data.profilePic === "string"
          ? data.profilePic
          : typeof data.profilePicture === "string"
            ? data.profilePicture
            : typeof data.photoURL === "string"
              ? data.photoURL
              : undefined,
      senderUsername:
        typeof data.handle === "string"
          ? data.handle.replace(/^@+/, "")
          : typeof data.username === "string"
            ? data.username.replace(/^@+/, "")
            : undefined,
    };
  };

  app.post("/debug/local/notifications/test/post-like", async (request) => {
    const body = DebugPostLikeSchema.parse(request.body);
    await notificationsService.createFromMutation({
      type: "like",
      actorId: body.actorUserId,
      recipientUserId: body.recipientUserId,
      targetId: body.postId,
    });
    return {
      ok: true,
      routeName: "debug.notifications.test.post_like",
      triggered: body,
    };
  });

  app.post("/debug/local/notifications/test/comment", async (request) => {
    const body = DebugCommentSchema.parse(request.body);
    await notificationsService.createFromMutation({
      type: "comment",
      actorId: body.actorUserId,
      recipientUserId: body.recipientUserId,
      targetId: body.postId,
      commentId: `debug_comment_${Date.now()}`,
      metadata: {
        commentText: body.commentText,
      },
    });
    return {
      ok: true,
      routeName: "debug.notifications.test.comment",
      triggered: body,
    };
  });

  app.post("/debug/local/notifications/test/follow", async (request) => {
    const body = DebugNotificationActorSchema.parse(request.body);
    await notificationsService.createFromMutation({
      type: "follow",
      actorId: body.actorUserId,
      recipientUserId: body.recipientUserId,
      targetId: body.recipientUserId,
    });
    return {
      ok: true,
      routeName: "debug.notifications.test.follow",
      triggered: body,
    };
  });

  app.post("/debug/local/notifications/test/chat-message", async (request) => {
    const body = DebugChatSchema.parse(request.body);
    const conversation = await chatsService.createOrGetDirectConversation({
      viewerId: body.actorUserId,
      otherUserId: body.recipientUserId,
    });
    const result = await chatsSendMessageOrchestrator.run({
      viewerId: body.actorUserId,
      conversationId: conversation.conversationId,
      messageType: "text",
      text: body.messageText,
      photoUrl: null,
      gifUrl: null,
      gif: null,
      postId: null,
      replyingToMessageId: null,
      clientMessageId: `debug_chat_${Date.now()}`,
    });
    return {
      ok: true,
      routeName: "debug.notifications.test.chat_message",
      conversationId: conversation.conversationId,
      messageId: result.message.messageId,
      triggered: body,
    };
  });

  app.get<{ Params: { userId: string } }>("/debug/local/notifications/user/:userId", async (request) => {
    const userId = String(request.params.userId ?? "").trim();
    if (!userId) return { ok: false, error: "userId required" };
    if (!db) {
      return { ok: false, error: "firestore unavailable" };
    }
    const [userSnap, notificationsSnap] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("users").doc(userId).collection("notifications").orderBy("timestamp", "desc").limit(20).get(),
    ]);
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const unreadCount =
      typeof userData.unreadCount === "number"
        ? userData.unreadCount
        : typeof userData.unreadNotificationCount === "number"
          ? userData.unreadNotificationCount
          : typeof userData.notificationUnreadCount === "number"
            ? userData.notificationUnreadCount
            : 0;
    const rows = notificationsSnap.docs.map((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const payload = legacyNotificationPushPublisher.preview(
        {
          senderUserId: typeof data.senderUserId === "string" ? data.senderUserId : "",
          type: typeof data.type === "string" ? data.type : "post",
          message: typeof data.message === "string" ? data.message : "",
          postId: typeof data.postId === "string" ? data.postId : null,
          commentId: typeof data.commentId === "string" ? data.commentId : null,
          chatId:
            typeof data.chatId === "string"
              ? data.chatId
              : typeof data.conversationId === "string"
                ? data.conversationId
                : null,
          collectionId: typeof data.collectionId === "string" ? data.collectionId : null,
          placeId: typeof data.placeId === "string" ? data.placeId : null,
          audioId: typeof data.audioId === "string" ? data.audioId : null,
          targetUserId: typeof data.targetUserId === "string" ? data.targetUserId : null,
          metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
        },
        {
          senderName: typeof data.senderName === "string" ? data.senderName : undefined,
          senderProfilePic: typeof data.senderProfilePic === "string" ? data.senderProfilePic : null,
          senderUsername: typeof data.senderUsername === "string" ? data.senderUsername : undefined,
        },
      );
      return {
        notificationId: doc.id,
        path: `users/${userId}/notifications/${doc.id}`,
        raw: data,
        parsedDeepLinkTarget: (payload.data as Record<string, unknown> | undefined)?.route ?? null,
        push: legacyNotificationPushPublisher.getDebugStatus(doc.id),
      };
    });
    return {
      ok: true,
      routeName: "debug.notifications.user.list",
      userId,
      unreadCount,
      notificationPath: `users/${userId}/notifications`,
      notifications: rows,
    };
  });

  app.post("/debug/local/notifications/test/push-dry-run", async (request) => {
    const body = DebugPushDryRunSchema.parse(request.body);
    const senderMeta = await fetchSenderMeta(body.actorUserId);
    const payload = legacyNotificationPushPublisher.preview(
      {
        senderUserId: body.actorUserId,
        type: body.type,
        message:
          body.type === "like"
            ? "liked your post."
            : body.type === "comment"
              ? "commented on your post."
              : body.type === "follow"
                ? "followed you."
                : "Testing Backend v2 push preview",
        postId: body.postId ?? null,
        metadata: body.postId ? { postTitle: "your post" } : null,
      },
      {
        senderName: typeof senderMeta.senderName === "string" ? senderMeta.senderName : undefined,
        senderProfilePic: typeof senderMeta.senderProfilePic === "string" ? senderMeta.senderProfilePic : null,
        senderUsername: typeof senderMeta.senderUsername === "string" ? senderMeta.senderUsername : undefined,
      },
    );
    let sent = null;
    if (body.send) {
      sent = await legacyNotificationPushPublisher.sendToRecipient({
        notificationId: `dry_run_${Date.now()}`,
        recipientUserId: body.recipientUserId,
        notificationData: {
          senderUserId: body.actorUserId,
          type: body.type,
          message:
            body.type === "like"
              ? "liked your post."
              : body.type === "comment"
                ? "commented on your post."
                : body.type === "follow"
                  ? "followed you."
                  : "Testing Backend v2 push preview",
          postId: body.postId ?? null,
          metadata: body.postId ? { postTitle: "your post" } : null,
        },
        senderData: {
          senderName: typeof senderMeta.senderName === "string" ? senderMeta.senderName : undefined,
          senderProfilePic: typeof senderMeta.senderProfilePic === "string" ? senderMeta.senderProfilePic : null,
          senderUsername: typeof senderMeta.senderUsername === "string" ? senderMeta.senderUsername : undefined,
        },
      });
    }
    return {
      ok: true,
      routeName: "debug.notifications.test.push_dry_run",
      payload,
      sent,
    };
  });

  app.get("/debug/local/analytics/events", async () => getAnalyticsIngestService(app.config).getDebugSnapshot());

  app.post("/debug/local/analytics/test-publish", async () => {
    const accepted = await getAnalyticsIngestService(app.config).publishDebugProbe();
    return {
      ok: true,
      accepted,
      snapshot: getAnalyticsIngestService(app.config).getDebugSnapshot()
    };
  });

  app.get("/debug/local/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/bootstrap",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/session", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/check-handle", async (request) => {
    const query = LocalViewerQuerySchema.extend({ handle: z.string().min(1).default("locava_debug_handle") }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/auth/check-handle?handle=${encodeURIComponent(query.handle)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/check-user-exists", async (request) => {
    const query = LocalViewerQuerySchema.extend({ email: z.string().email() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/auth/check-user-exists?email=${encodeURIComponent(query.email)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`,
      explicitViewerId: viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/grid/:userId", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(24).optional(), cursor: z.string().optional() }).parse(
      request.query
    );
    const q = new URLSearchParams();
    q.set("limit", String(query.limit ?? 12));
    if (query.cursor) q.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(params.userId)}/grid?${q.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/post-detail/:userId/:postId", async (request) => {
    const params = z.object({ userId: z.string().min(1), postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(params.userId)}/posts/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/chats/inbox", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const limit = query.limit ?? 20;
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/chats/inbox?limit=${String(limit)}`,
      explicitViewerId: viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/chats/thread/:conversationId", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/messages?limit=${String(query.limit ?? 30)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/search/users", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("a"), limit: z.coerce.number().int().min(1).max(20).optional() }).parse(
      request.query
    );
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=${String(query.limit ?? 12)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/search/results", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo"), limit: z.coerce.number().int().min(4).max(12).optional() }).parse(
      request.query
    );
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/search/results?q=${encodeURIComponent(query.q)}&limit=${String(query.limit ?? 8)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections/list", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections?limit=${String(query.limit ?? 20)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections/detail/:collectionId", async (request) => {
    const params = z.object({ collectionId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections/${encodeURIComponent(params.collectionId)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(20).optional(),
      postId: z.string().optional()
    }).parse(request.query);
    const created = await callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/collections",
      body: { name: `Debug Collection ${Date.now()}` },
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
    const list = await callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections?limit=${String(query.limit ?? 12)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
    let save: LocalDebugRouteResult | null = null;
    let posts: LocalDebugRouteResult | null = null;
    if (query.postId && created.ok && created.responseData && typeof created.responseData === "object") {
      save = await callCanonicalRoute(app, {
        method: "POST",
        path: `/v2/posts/${encodeURIComponent(query.postId)}/save`,
        explicitViewerId: query.viewerId,
        internal: query.internal
      });
      const createdItem = (created.responseData as { item?: { id?: string } }).item;
      if (createdItem?.id) {
        posts = await callCanonicalRoute(app, {
          method: "GET",
          path: `/v2/collections/${encodeURIComponent(createdItem.id)}/posts?limit=${String(query.limit ?? 12)}`,
          explicitViewerId: query.viewerId,
          internal: query.internal
        });
      }
    }
    return {
      canonicalRoute: "aggregate collections flow",
      usedRealFirestoreData: Boolean(created.usedRealFirestoreData || list.usedRealFirestoreData || save?.usedRealFirestoreData || posts?.usedRealFirestoreData),
      legacyPathUsage: false,
      counts: { createdStatus: created.statusCode, listStatus: list.statusCode },
      ids: [...created.ids, ...list.ids],
      timingMs: { total: (created.timingMs.total ?? 0) + (list.timingMs.total ?? 0) + (save?.timingMs.total ?? 0) + (posts?.timingMs.total ?? 0) },
      fallbackUsage: [...created.fallbackUsage, ...list.fallbackUsage, ...(save?.fallbackUsage ?? []), ...(posts?.fallbackUsage ?? [])],
      effectiveViewerId: created.effectiveViewerId,
      localDevIdentityModeUsed: created.localDevIdentityModeUsed,
      usedDefaultViewerId: created.usedDefaultViewerId,
      verificationNotes: ["create -> list -> optional save -> optional list posts"],
      created,
      list,
      save,
      posts
    };
  });

  app.get("/debug/local/achievements/snapshot", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/snapshot",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/hero", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/hero",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/pending-delta", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/pending-delta",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/status", async (request) => {
    const query = LocalViewerQuerySchema.extend({ lat: z.string().optional(), long: z.string().optional() }).parse(request.query);
    const params = new URLSearchParams();
    if (query.lat) params.set("lat", query.lat);
    if (query.long) params.set("long", query.long);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/achievements/status${params.size ? `?${params.toString()}` : ""}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/badges", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/badges",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/leagues", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/leagues",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/leaderboard/:scope", async (request) => {
    const params = z.object({ scope: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ leagueId: z.string().optional() }).parse(request.query);
    const suffix = query.leagueId ? `?leagueId=${encodeURIComponent(query.leagueId)}` : "";
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/achievements/leaderboard/${encodeURIComponent(params.scope)}${suffix}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/notifications/list", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/notifications?limit=${String(query.limit ?? 20)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/directory/users", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(20).optional(),
      excludeUserIds: z.string().optional()
    }).parse(request.query);
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 10));
    if (query.q) params.set("q", query.q);
    if (query.excludeUserIds) params.set("excludeUserIds", query.excludeUserIds);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/directory/users?${params.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/map/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      bbox: z.string().optional(),
      limit: z.coerce.number().int().min(20).max(300).optional()
    }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/map/bootstrap?bbox=${encodeURIComponent(query.bbox ?? "-122.55,37.68,-122.30,37.84")}&limit=${String(query.limit ?? 120)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(4).max(12).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/bootstrap?limit=${String(query.limit ?? 8)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/page", async (request) => {
    const query = LocalViewerQuerySchema.extend({ cursor: z.string().optional(), limit: z.coerce.number().int().min(4).max(12).optional() }).parse(
      request.query
    );
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 8));
    if (query.cursor) params.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/page?${params.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/item-detail/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/items/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/posts/detail/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/viewer/account-state", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const identity = resolveLocalDevIdentityContext(query.viewerId);
    const viewerId = identity.viewerId;
    const authSession = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    const bootstrap = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/bootstrap",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    const authSessionSecondRead = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    return {
      canonicalRoute: "aggregate viewer/account-state",
      explicitViewerId: viewerId,
      usedRealFirestoreData:
        Boolean(authSession.usedRealFirestoreData) ||
        Boolean(bootstrap.usedRealFirestoreData) ||
        Boolean(authSessionSecondRead.usedRealFirestoreData),
      timingMs: {
        total: Number(
          (
            Number(authSession.timingMs?.total ?? 0) +
            Number(bootstrap.timingMs?.total ?? 0) +
            Number(authSessionSecondRead.timingMs?.total ?? 0)
          ).toFixed(2)
        )
      },
      fallbackUsage: [
        ...(Array.isArray(authSession.fallbackUsage) ? authSession.fallbackUsage : []),
        ...(Array.isArray(bootstrap.fallbackUsage) ? bootstrap.fallbackUsage : []),
        ...(Array.isArray(authSessionSecondRead.fallbackUsage) ? authSessionSecondRead.fallbackUsage : [])
      ],
      legacyPathUsage: false,
      effectiveViewerId: identity.viewerId,
      localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
      usedDefaultViewerId: identity.usedDefaultViewerId,
      verificationNotes: ["Verifies v2 auth session/bootstrap consistency across consecutive reads"],
      authSession,
      bootstrap,
      authSessionSecondRead
    };
  });

  app.get("/debug/local/rails/legacy-usage", async () => {
    const identity = resolveLocalDevIdentityContext();
    const contracts = (await app.inject({ method: "GET", url: "/routes" })) as InjectLiteReply;
    const routesPayload = parseJsonPayload(contracts.payload);
    const rows = Array.isArray((routesPayload?.data as { routes?: unknown[] } | undefined)?.routes)
      ? (((routesPayload?.data as { routes?: unknown[] }).routes ?? []) as Array<{ path?: string }>)
      : [];
    const legacyRoutesFromContract = rows
      .map((row) => row.path ?? "")
      .filter((path) => path.startsWith("/api/") || path.startsWith("/api/v1/product/"));
    const knownCompatCandidates = [
      { method: "GET", url: "/api/v1/product/session/bootstrap" },
      { method: "GET", url: "/api/v1/product/profile/bootstrap" },
      { method: "PATCH", url: "/api/v1/product/viewer" },
      { method: "PUT", url: "/api/users/:userId" }
    ] as const;
    const registeredCompat = knownCompatCandidates
      .filter((candidate) => app.hasRoute({ method: candidate.method, url: candidate.url }))
      .map((candidate) => candidate.url);
    const legacyRoutes = [...new Set([...legacyRoutesFromContract, ...registeredCompat])];
    return {
      canonicalRoute: "GET /routes",
      usedRealFirestoreData: false,
      legacyPathUsage: legacyRoutes.length > 0,
      counts: { legacyRouteCount: legacyRoutes.length },
      ids: [],
      timingMs: { total: 0 },
      fallbackUsage: [],
      effectiveViewerId: identity.viewerId,
      localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
      usedDefaultViewerId: identity.usedDefaultViewerId,
      verificationNotes: ["Route registry scan for legacy namespaces"],
      legacyRoutes
    };
  });

  app.post("/debug/local/chats/create-direct", async (request) => {
    const body = z.object({ otherUserId: z.string().min(1), viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/chats/create-or-get",
      body: { otherUserId: body.otherUserId },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/send", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        messageType: z.enum(["text", "photo", "gif"]).optional(),
        text: z.string().optional(),
        photoUrl: z.string().url().optional(),
        gifUrl: z.string().url().optional(),
        clientMessageId: z.string().min(8).max(128).optional()
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/messages`,
      body: {
        messageType: body.messageType ?? "text",
        text: body.text ?? `debug-harness-message-${Date.now()}`,
        photoUrl: body.photoUrl,
        gifUrl: body.gifUrl,
        clientMessageId: body.clientMessageId ?? `debug-${Date.now()}`
      },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/mark-read", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/mark-read`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/mark-unread", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/mark-unread`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.put("/debug/local/chats/:conversationId/typing-status", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional(), isTyping: z.boolean().optional().default(true) }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "PUT",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/typing-status`,
      body: { isTyping: body.isTyping },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/collections/create", async (request) => {
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        name: z.string().min(1).default(`Debug Collection ${new Date().toISOString()}`),
        description: z.string().optional().default("Created by local debug harness"),
        privacy: z.enum(["public", "private"]).optional().default("private")
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/collections",
      body: {
        name: body.name,
        description: body.description,
        privacy: body.privacy,
        collaborators: [],
        items: []
      },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  

  app.post("/debug/local/posts/:postId/like", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/like`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/unlike", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/unlike`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/save", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/save`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/unsave", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/unsave`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.get("/debug/local/comments/list/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(5).max(20).optional(), cursor: z.string().optional() }).parse(
      request.query
    );
    const q = new URLSearchParams();
    q.set("limit", String(query.limit ?? 10));
    if (query.cursor) q.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/comments?${q.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.post("/debug/local/comments/create/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional(), text: z.string().min(1).max(400).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/comments`,
      body: { text: body.text ?? `debug comment ${new Date().toISOString()}`, clientMutationKey: `debug-comment-${Date.now()}` },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/comments/like/:commentId", async (request) => {
    const params = z.object({ commentId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/comments/${encodeURIComponent(params.commentId)}/like`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/users/:userId/follow", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/users/${encodeURIComponent(params.userId)}/follow`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/users/:userId/unfollow", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/users/${encodeURIComponent(params.userId)}/unfollow`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/notifications/mark-read", async (request) => {
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        notificationIds: z.array(z.string().min(1)).min(1).max(20)
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/notifications/mark-read",
      body: { notificationIds: body.notificationIds },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/notifications/mark-all-read", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/notifications/mark-all-read",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/achievements/screen-opened", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/achievements/screen-opened",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/achievements/ack-leaderboard-event", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/achievements/ack-leaderboard-event",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/legends/backfill", async (request) => {
    const body = z
      .object({
        dryRun: z.boolean().default(true),
        pageSize: z.number().int().min(50).max(2000).default(500),
        cursorPostId: z.string().min(1).optional(),
        forceRebuild: z.boolean().optional().default(false)
      })
      .parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) {
      return { ok: false, error: "firestore_unavailable" };
    }

    const startedAt = Date.now();
    const postsCol = db.collection("posts");
    const firstWinners = new Map<string, { userId: string; postId: string; createdAtMs: number; title: string; subtitle: string; kind: string; activityKey?: string | null; locationScope?: "state" | "city" | "country" | null; locationKey?: string | null }>();
    const rankCounts = new Map<string, Map<string, number>>();
    const scopeCounts = new Map<string, Map<string, number>>();
    let totalProcessed = 0;
    let pages = 0;
    let nextCursorPostId: string | null = null;
    let cursor = body.cursorPostId ?? null;
    while (true) {
      let query = postsCol.orderBy("__name__").limit(body.pageSize);
      if (cursor) query = postsCol.orderBy("__name__").startAfter(cursor).limit(body.pageSize);
      const snap = await query.get();
      pages += 1;
      if (snap.empty) break;
      for (const doc of snap.docs) {
      nextCursorPostId = doc.id;
      cursor = doc.id;
      const row = (doc.data() ?? {}) as Record<string, unknown>;
      const postId = doc.id;
      const userId = typeof row.userId === "string" && row.userId.trim() ? row.userId.trim() : null;
      if (!userId) continue;
      const geoData = row.geoData && typeof row.geoData === "object" ? (row.geoData as Record<string, unknown>) : null;
      const stateRegionId = typeof row.stateRegionId === "string" ? row.stateRegionId.trim() : "";
      const countryRegionId = typeof row.countryRegionId === "string" ? row.countryRegionId.trim() : "";
      const stateFromRegion = stateRegionId ? stateRegionId.split("-").slice(1).join("_") : "";
      const state = normalizeStateKey(
        typeof row.state === "string"
          ? row.state
          : geoData && typeof geoData.state === "string"
            ? geoData.state
            : stateFromRegion
      );
      const city =
        typeof row.city === "string"
          ? row.city.trim()
          : geoData && typeof geoData.city === "string"
            ? geoData.city.trim()
            : "";
      const country = normalizeCountryKey(
        countryRegionId ||
          (geoData && typeof geoData.country === "string" ? geoData.country : "")
      );
      const createdAtMs =
        typeof row.createdAtMs === "number"
          ? row.createdAtMs
          : typeof row.createdAt === "object" && row.createdAt && "toMillis" in (row.createdAt as object)
            ? Number((row.createdAt as { toMillis: () => number }).toMillis())
            : 0;
      const activities = Array.isArray(row.activities) ? row.activities.map((v) => normalizeActivityForBackfill(v)).filter((v): v is string => Boolean(v)) : [];

      const bump = (key: string) => {
        const existing = rankCounts.get(key) ?? new Map<string, number>();
        existing.set(userId, (existing.get(userId) ?? 0) + 1);
        rankCounts.set(key, existing);
      };
      const bumpScope = (scopeId: string) => {
        const existing = scopeCounts.get(scopeId) ?? new Map<string, number>();
        existing.set(userId, (existing.get(userId) ?? 0) + 1);
        scopeCounts.set(scopeId, existing);
      };
      const applyFirst = (
        key: string,
        payload: { title: string; subtitle: string; kind: string; activityKey?: string | null; locationScope?: "state" | "city" | "country" | null; locationKey?: string | null }
      ) => {
        const existing = firstWinners.get(key);
        if (!existing || createdAtMs < existing.createdAtMs || (createdAtMs === existing.createdAtMs && postId < existing.postId)) {
          firstWinners.set(key, { userId, postId, createdAtMs, ...payload });
        }
      };

      if (country) {
        bump(`location_rank:country:${country}`);
        bumpScope(buildLegendScopeId(["place", "country", country]));
        applyFirst(`location_first:country:${country}`, {
          title: `First Poster in ${country}`,
          subtitle: "Original legend",
          kind: "location_first",
          locationScope: "country",
          locationKey: country
        });
      }
      if (state) {
        const locState = `location_rank:state:${state}`;
        bump(locState);
        bumpScope(buildLegendScopeId(["place", "state", state]));
        applyFirst(`location_first:state:${state}`, {
          title: `First Poster in ${state}`,
          subtitle: "Original legend",
          kind: "location_first",
          locationScope: "state",
          locationKey: state
        });
      }
      if (state && city) {
        const cityKey = normalizeCityKey(state, city);
        const locCity = `location_rank:city:${cityKey}`;
        bump(locCity);
        bumpScope(buildLegendScopeId(["place", "city", cityKey]));
        applyFirst(`location_first:city:${cityKey}`, {
          title: `First Poster in ${city}`,
          subtitle: `Original legend • ${state}`,
          kind: "location_first",
          locationScope: "city",
          locationKey: cityKey
        });
      }

      for (const activity of activities) {
        bump(`activity_rank:${activity}`);
        bumpScope(`activity:${activity}`);
        applyFirst(`activity_first:${activity}`, {
          title: `First ${activity.replace(/_/g, " ")} on Locava`,
          subtitle: "Original legend",
          kind: "activity_first",
          activityKey: activity
        });
        if (state) {
          const comboState = `combo_rank:state:${state}:activity:${activity}`;
          bump(comboState);
          bumpScope(buildLegendScopeId(["placeActivity", "state", state, activity]));
          applyFirst(`combo_first:state:${state}:activity:${activity}`, {
            title: `First ${activity.replace(/_/g, " ")} in ${state}`,
            subtitle: "Original legend",
            kind: "combo_first",
            activityKey: activity,
            locationScope: "state",
            locationKey: state
          });
        }
        if (state && city) {
          const cityKey = normalizeCityKey(state, city);
          const comboCity = `combo_rank:city:${cityKey}:activity:${activity}`;
          bump(comboCity);
          bumpScope(buildLegendScopeId(["placeActivity", "city", cityKey, activity]));
          applyFirst(`combo_first:city:${cityKey}:activity:${activity}`, {
            title: `First ${activity.replace(/_/g, " ")} in ${city}`,
            subtitle: `Original legend • ${state}`,
            kind: "combo_first",
            activityKey: activity,
            locationScope: "city",
            locationKey: cityKey
          });
        }
        if (country) {
          const comboCountry = `combo_rank:country:${country}:activity:${activity}`;
          bump(comboCountry);
          bumpScope(buildLegendScopeId(["placeActivity", "country", country, activity]));
          applyFirst(`combo_first:country:${country}:activity:${activity}`, {
            title: `First ${activity.replace(/_/g, " ")} in ${country}`,
            subtitle: "Original legend",
            kind: "combo_first",
            activityKey: activity,
            locationScope: "country",
            locationKey: country
          });
        }
      }
        totalProcessed += 1;
      }
      if (snap.size < body.pageSize) break;
    }

    const writesSummary = { firstClaimsCreated: 0, rankAggregatesWritten: 0, scopeDocsWritten: 0, userStatsWritten: 0 };
    if (!body.dryRun) {
      let batch = db.batch();
      let batchOps = 0;
      const queueDelete = (ref: FirebaseFirestore.DocumentReference) => {
        batch.delete(ref);
        batchOps += 1;
      };
      const queueSet = (
        ref: FirebaseFirestore.DocumentReference,
        data: Record<string, unknown>,
        options: FirebaseFirestore.SetOptions = { merge: true }
      ) => {
        batch.set(ref, data, options);
        batchOps += 1;
      };
      const flushBatch = async () => {
        if (batchOps === 0) return;
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      };
      if (body.forceRebuild) {
        const [claimsSnap, aggSnap, scopesSnap, statsSnap] = await Promise.all([
          db.collection("legendFirstClaims").limit(2000).get(),
          db.collection("legendRankAggregates").limit(2000).get(),
          db.collection("legendScopes").limit(2000).get(),
          db.collection("legendUserStats").limit(8000).get()
        ]);
        for (const d of claimsSnap.docs) {
          queueDelete(d.ref);
          if (batchOps >= 400) await flushBatch();
        }
        for (const d of aggSnap.docs) {
          queueDelete(d.ref);
          if (batchOps >= 400) await flushBatch();
        }
        for (const d of scopesSnap.docs) {
          queueDelete(d.ref);
          if (batchOps >= 400) await flushBatch();
        }
        for (const d of statsSnap.docs) {
          queueDelete(d.ref);
          if (batchOps >= 400) await flushBatch();
        }
      }
      for (const [claimKey, claim] of firstWinners.entries()) {
        queueSet(
          legendRepository.firstClaimRef(claimKey),
          {
            claimKey,
            kind: claim.kind,
            family: "first",
            dimension: claim.kind === "activity_first" ? "activity" : claim.kind === "combo_first" ? "combo" : "location",
            userId: claim.userId,
            postId: claim.postId,
            title: claim.title,
            subtitle: claim.subtitle,
            description: "Backfilled original legend claim.",
            iconContext: claim.kind === "activity_first" ? "activity" : claim.kind === "combo_first" ? "combo" : "location",
            activityKey: claim.activityKey ?? null,
            locationScope: claim.locationScope ?? null,
            locationKey: claim.locationKey ?? null,
            claimedAt: new Date(claim.createdAtMs || Date.now()),
            createdAt: new Date(claim.createdAtMs || Date.now())
          },
          { merge: true }
        );
        if (batchOps >= 400) await flushBatch();
        writesSummary.firstClaimsCreated += 1;
      }
      for (const [aggregateKey, counts] of rankCounts.entries()) {
        const rows = [...counts.entries()].map(([userId, count]) => ({ userId, count }));
        rows.sort((a, b) => (b.count - a.count) || a.userId.localeCompare(b.userId));
        const topUsers = rows.slice(0, 20);
        const [kind, maybeScope, maybeLocation, maybeActivityLabel, maybeActivity] = aggregateKey.split(":");
        queueSet(
          legendRepository.rankAggregateRef(aggregateKey),
          {
            aggregateKey,
            kind,
            family: "rank",
            dimension: kind === "activity_rank" ? "activity" : kind === "combo_rank" ? "combo" : "location",
            locationScope: maybeScope === "state" || maybeScope === "city" || maybeScope === "country" ? maybeScope : null,
            locationKey: maybeLocation ?? null,
            activityKey: aggregateKey.includes(":activity:") ? aggregateKey.split(":activity:")[1] : kind === "activity_rank" ? maybeScope ?? null : null,
            countsByUser: Object.fromEntries(counts.entries()),
            topUsers,
            totalPosts: rows.reduce((sum, row) => sum + row.count, 0),
            updatedAt: new Date()
          },
          { merge: true }
        );
        if (batchOps >= 400) await flushBatch();
        writesSummary.rankAggregatesWritten += 1;
        void maybeActivityLabel;
        void maybeActivity;
      }
      for (const [scopeId, counts] of scopeCounts.entries()) {
        const rows = [...counts.entries()].map(([userId, count]) => ({ userId, count }));
        rows.sort((a, b) => (b.count - a.count) || a.userId.localeCompare(b.userId));
        const topUsers = rows.slice(0, 20);
        const leader = topUsers[0] ?? null;
        const scopeMeta = resolveLegendScopeMetaForBackfill(scopeId);
        queueSet(
          legendRepository.scopeRef(scopeId),
          {
            scopeId,
            scopeType: scopeMeta.scopeType,
            title: scopeMeta.title,
            subtitle: scopeMeta.subtitle,
            placeType: scopeMeta.placeType,
            placeId: scopeMeta.placeId,
            activityId: scopeMeta.activityId,
            geohashPrecision: null,
            geohash: null,
            totalPosts: rows.reduce((sum, row) => sum + row.count, 0),
            leaderUserId: leader?.userId ?? null,
            leaderCount: leader?.count ?? 0,
            topUsers,
            lastPostId: null,
            updatedAt: new Date()
          },
          { merge: true }
        );
        if (batchOps >= 400) await flushBatch();
        writesSummary.scopeDocsWritten += 1;
        for (let idx = 0; idx < rows.length; idx += 1) {
          const row = rows[idx]!;
          queueSet(
            legendRepository.userStatRef(scopeId, row.userId),
            {
              scopeId,
              userId: row.userId,
              count: row.count,
              rankSnapshot: idx + 1,
              isLeader: idx === 0,
              lastPostId: null,
              updatedAt: new Date()
            },
            { merge: true }
          );
          writesSummary.userStatsWritten += 1;
          if (batchOps >= 400) await flushBatch();
        }
      }
      await flushBatch();
    }

    return {
      ok: true,
      dryRun: body.dryRun,
      pageSize: body.pageSize,
      pages,
      processedPosts: totalProcessed,
      firstClaimsCandidateCount: firstWinners.size,
      rankAggregateCount: rankCounts.size,
      scopeCount: scopeCounts.size,
      writesSummary,
      nextCursorPostId,
      elapsedMs: Date.now() - startedAt
    };
  });

  app.get("/debug/local-run/feed", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const bootstrap = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/bootstrap?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    const page = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/page?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "feed", ok: Boolean(bootstrap.ok) && Boolean(page.ok), timingMs: Date.now() - startedAt, effectiveViewerId: bootstrap.effectiveViewerId, checks: [bootstrap, page] };
  });

  app.get("/debug/local-run/profile", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const profile = await callCanonicalRoute(app, { method: "GET", path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`, explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "profile", ok: Boolean(profile.ok), timingMs: Date.now() - startedAt, effectiveViewerId: profile.effectiveViewerId, checks: [profile] };
  });

  app.get("/debug/local-run/chats", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const inbox = await callCanonicalRoute(app, { method: "GET", path: "/v2/chats/inbox?limit=10", explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "chats", ok: Boolean(inbox.ok), timingMs: Date.now() - startedAt, effectiveViewerId: inbox.effectiveViewerId, checks: [inbox] };
  });

  app.get("/debug/local-run/search", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo") }).parse(request.query);
    const startedAt = Date.now();
    const users = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=10`, explicitViewerId: query.viewerId, internal: query.internal });
    const results = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/results?q=${encodeURIComponent(query.q)}&limit=8`, explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "search", ok: Boolean(users.ok) && Boolean(results.ok), timingMs: Date.now() - startedAt, effectiveViewerId: users.effectiveViewerId, checks: [users, results] };
  });

  app.get("/debug/local-run/full-app", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo") }).parse(request.query);
    const startedAt = Date.now();
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const feed = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/bootstrap?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    const profile = await callCanonicalRoute(app, { method: "GET", path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`, explicitViewerId: query.viewerId, internal: query.internal });
    const chats = await callCanonicalRoute(app, { method: "GET", path: "/v2/chats/inbox?limit=10", explicitViewerId: query.viewerId, internal: query.internal });
    const search = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=10`, explicitViewerId: query.viewerId, internal: query.internal });
    const checks = [feed, profile, chats, search];
    return { run: "full-app", ok: checks.every((row) => Boolean(row.ok)), timingMs: Date.now() - startedAt, effectiveViewerId: feed.effectiveViewerId, checks };
  });
}
