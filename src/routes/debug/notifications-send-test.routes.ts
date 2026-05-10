import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { failure, success } from "../../lib/response.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import {
  applyCanonicalRoutingOnLegacyNotificationDoc,
  notificationsRepository,
} from "../../repositories/surfaces/notifications.repository.js";
import type { LegacyNotificationData, LegacyNotificationSender } from "../../services/notifications/legacy-notification-push.publisher.js";
import { legacyNotificationPushPublisher } from "../../services/notifications/legacy-notification-push.publisher.js";

const ROUTE_PATH = "/debug/notifications/send-test";

export type DebugNotificationsSendTestRouteOpts = {
  routeEnabled: boolean;
  notificationTestSecret: string | null;
};

function authDebugSecret(request: FastifyRequest, expectedSecret: string | null): boolean {
  const secret = expectedSecret?.trim();
  if (!secret) return false;
  const raw = request.headers["x-locava-debug-secret"];
  const provided = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0] ?? "") : "";
  return provided === secret;
}

const BodySchema = z.object({
  recipientId: z.string().min(1),
  type: z.string().min(1),
  targetType: z.enum(["post", "user", "chat"]).optional(),
  postId: z.string().optional(),
  userId: z.string().optional(),
  chatId: z.string().optional(),
  actorUserId: z.string().optional(),
  sendPush: z.boolean().optional().default(false),
  createInApp: z.boolean().optional().default(true),
  title: z.string().optional(),
  body: z.string().optional(),
});

function inferTargetType(type: string, explicit?: "post" | "user" | "chat"): "post" | "user" | "chat" {
  if (explicit) return explicit;
  const t = type.toLowerCase();
  if (["chat", "message", "dm", "new_message", "direct_message", "groupchat"].includes(t)) return "chat";
  if (
    ["follow", "new_follower", "user_follow", "friend_request", "friend_accept", "contact_joined"].includes(t)
  ) {
    return "user";
  }
  return "post";
}

async function pickOtherUserId(db: Firestore, exclude: string): Promise<string | null> {
  const snap = await db.collection("users").limit(40).get();
  for (const d of snap.docs) {
    if (d.id !== exclude) return d.id;
  }
  return null;
}

async function pickDefaultPostId(db: Firestore): Promise<string | null> {
  const envPid = process.env.TEST_NOTIFICATION_POST_ID?.trim();
  if (envPid) return envPid;
  try {
    const q = await db.collection("posts").orderBy("createdAt", "desc").limit(12).get();
    for (const d of q.docs) {
      const data = d.data() as { assets?: unknown };
      if (Array.isArray(data.assets) && data.assets.length > 0) return d.id;
    }
    return q.docs[0]?.id ?? null;
  } catch {
    const q2 = await db.collection("posts").limit(1).get();
    return q2.docs[0]?.id ?? null;
  }
}

export function registerDebugNotificationsSendTestRoutes(
  app: FastifyInstance,
  opts: DebugNotificationsSendTestRouteOpts,
): void {
  app.post(ROUTE_PATH, async (request, reply) => {
    if (!opts.routeEnabled) {
      return reply.status(404).send(failure("not_found", "debug_notifications_disabled"));
    }
    if (!authDebugSecret(request, opts.notificationTestSecret)) {
      return reply.status(401).send(failure("unauthorized", "missing_or_invalid_debug_secret"));
    }
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_body", "bad_request", parsed.error.flatten()));
    }
    const body = parsed.data;
    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("service_unavailable", "firestore_unavailable"));
    }

    const inferredTarget = inferTargetType(body.type, body.targetType);

    const actorUserId =
      body.actorUserId?.trim() ||
      process.env.TEST_NOTIFICATION_ACTOR_ID?.trim() ||
      (await pickOtherUserId(db, body.recipientId));
    if (!actorUserId) {
      return reply.status(400).send(
        failure(
          "invalid_actor",
          "Set actorUserId or TEST_NOTIFICATION_ACTOR_ID, or ensure another user exists in Firestore",
        ),
      );
    }

    let postId: string | undefined = body.postId?.trim();
    let userId: string | undefined = body.userId?.trim();
    let chatId: string | undefined = body.chatId?.trim();

    if (inferredTarget === "post") {
      if (!postId) {
        const picked = await pickDefaultPostId(db);
        if (!picked) {
          return reply.status(400).send(
            failure("invalid_post", "Set postId or TEST_NOTIFICATION_POST_ID, or seed posts in Firestore"),
          );
        }
        postId = picked;
      }
    } else if (inferredTarget === "user") {
      userId = userId ?? actorUserId;
    } else {
      chatId = chatId?.trim() || process.env.TEST_NOTIFICATION_CHAT_ID?.trim() || "debug_test_chat_stub";
    }

    const routingTargetId =
      inferredTarget === "post" ? postId! : inferredTarget === "user" ? userId! : chatId!;

    const notificationData: Record<string, unknown> = {
      senderUserId: actorUserId,
      senderName: body.title ?? "Locava Test",
      senderUsername: `test_${actorUserId.slice(0, 8)}`,
      type: body.type,
      message: body.body ?? "Tap to open (debug)",
      read: false,
      priority: "high",
      timestamp: FieldValue.serverTimestamp(),
    };
    if (inferredTarget === "post") {
      notificationData.postId = postId;
    }
    if (inferredTarget === "user") {
      notificationData.targetUserId = userId;
    }
    if (inferredTarget === "chat") {
      notificationData.chatId = chatId;
    }

    applyCanonicalRoutingOnLegacyNotificationDoc(notificationData, {
      type: body.type,
      actorId: actorUserId,
      targetId: routingTargetId,
    });

    let notificationId: string | null = null;
    let createdInApp = false;
    if (body.createInApp) {
      const created = await notificationsRepository.debugWriteInboxNotification({
        recipientUserId: body.recipientId,
        notificationData,
      });
      notificationId = created.notificationId;
      createdInApp = true;
    }

    const anchorId =
      notificationId ?? `debug_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    let pushResult: unknown = null;
    if (body.sendPush) {
      const legacy: LegacyNotificationData = {
        senderUserId: actorUserId,
        type: body.type,
        message: String(notificationData.message ?? ""),
        postId: postId ?? null,
        chatId: chatId ?? null,
        targetUserId: inferredTarget === "user" ? userId ?? null : null,
        profileUserId: inferredTarget === "user" ? userId ?? null : null,
      };
      const sender: LegacyNotificationSender = {
        senderName: String(notificationData.senderName ?? "Test"),
        senderUsername: String(notificationData.senderUsername ?? ""),
      };
      pushResult = await legacyNotificationPushPublisher.sendToRecipient({
        notificationId: anchorId,
        recipientUserId: body.recipientId,
        notificationData: legacy,
        senderData: sender,
      });
    }

    const { timestamp: _ts, ...notificationDocPreview } = notificationData;

    return reply.send(
      success({
        path: ROUTE_PATH,
        recipientId: body.recipientId,
        type: body.type,
        inferredTarget,
        postId: postId ?? null,
        userId: userId ?? null,
        chatId: chatId ?? null,
        actorUserId,
        notificationId,
        pushAnchorNotificationId: anchorId,
        createdInApp,
        sendPushRequested: body.sendPush,
        notificationDoc: notificationDocPreview,
        pushResult,
      }),
    );
  });
}
