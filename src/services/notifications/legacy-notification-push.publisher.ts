import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

export type LegacyNotificationSender = {
  senderName?: string;
  senderProfilePic?: string | null;
  senderUsername?: string;
};

export type LegacyNotificationData = {
  senderUserId: string;
  type: string;
  message: string;
  postId?: string | null;
  commentId?: string | null;
  chatId?: string | null;
  collectionId?: string | null;
  placeId?: string | null;
  audioId?: string | null;
  targetUserId?: string | null;
  profileUserId?: string | null;
  pushTitle?: string | null;
  pushBody?: string | null;
  pushData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type PushDeliveryDebugStatus = {
  notificationId: string;
  recipientUserId: string;
  attempted: boolean;
  success: boolean;
  skippedNoExpoToken?: boolean;
  error?: string;
  payload?: Record<string, unknown> | null;
  responseBody?: unknown;
  updatedAtMs: number;
};

/** Optional routing envelope merged into Expo `data` for client dedupe, filtering, and tap routing. */
export type LegacyPushRoutingMeta = {
  notificationId: string;
  recipientUserId: string;
};

const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_EXPO_PUSH_TARGETS_PER_SEND = 5;
const pushDebugByNotificationId = new Map<string, PushDeliveryDebugStatus>();
const POST_RELATED_PUSH_TYPES = new Set([
  "post",
  "post_discovery",
  "like",
  "comment",
  "mention",
  "push_image_test",
  "post_like",
  "post_comment",
  "reply",
  "saved_post",
  "collection_add",
  "tag",
  "system_post_featured",
  "generic_post",
]);
const PEOPLE_RELATED_PUSH_TYPES = new Set([
  "follow",
  "contact_joined",
  "new_follower",
  "user_follow",
  "friend_request",
  "friend_accept",
  "chat",
  "message",
  "dm",
  "new_message",
  "direct_message",
  "groupchat",
  "invite",
  "collection_shared",
  "group_invite",
  "group_joined",
  "group_faceoff",
  "place_follow",
  "audio_like",
]);

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringifyExpoDataValues(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
}

function isPostRelatedPush(notificationData: LegacyNotificationData): boolean {
  const type = asTrimmedString(notificationData.type)?.toLowerCase() ?? "";
  if (POST_RELATED_PUSH_TYPES.has(type)) return true;
  return asTrimmedString(notificationData.postId) != null;
}

function isPeopleRelatedPush(notificationData: LegacyNotificationData): boolean {
  const type = asTrimmedString(notificationData.type)?.toLowerCase() ?? "";
  return PEOPLE_RELATED_PUSH_TYPES.has(type);
}

function resolveRichImageUrl(
  notificationData: LegacyNotificationData,
  senderData: LegacyNotificationSender | null
): string | null {
  const metadata = notificationData.metadata ?? {};
  const pushData = (notificationData.pushData ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    metadata.groupPhotoUrl,
    metadata.groupImageUrl,
    metadata.displayPhotoURL,
    metadata.senderProfilePic,
    senderData?.senderProfilePic,
    metadata.postThumbUrl,
    metadata.imageUrl,
    metadata.photoUrl,
    metadata.thumbUrl,
    metadata.thumbnailUrl,
    metadata.displayPhotoLink,
    metadata.postImageUrl,
    metadata.postPhotoUrl,
    pushData.imageUrl,
    pushData.thumbUrl,
    pushData.thumbnailUrl,
  ];
  for (const candidate of candidates) {
    const value = asTrimmedString(candidate);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function buildLegacyRoute(notificationData: LegacyNotificationData): string {
  const profileUserId =
    asTrimmedString(notificationData.targetUserId) ??
    asTrimmedString(notificationData.profileUserId) ??
    asTrimmedString(notificationData.senderUserId);
  const metadata = notificationData.metadata ?? {};
  const metadataRoute = asTrimmedString(metadata.route);
  if (metadataRoute) return metadataRoute;
  if (
    notificationData.type === "like" ||
    notificationData.type === "comment" ||
    notificationData.type === "mention" ||
    notificationData.type === "post" ||
    notificationData.type === "post_discovery" ||
    notificationData.type === "push_image_test" ||
    notificationData.type === "post_like" ||
    notificationData.type === "post_comment" ||
    notificationData.type === "reply" ||
    notificationData.type === "saved_post" ||
    notificationData.type === "collection_add" ||
    notificationData.type === "tag" ||
    notificationData.type === "system_post_featured" ||
    notificationData.type === "generic_post"
  ) {
    return "/display/display";
  }
  if (
    notificationData.type === "achievement_leaderboard" ||
    notificationData.type === "achievements_leaderboard" ||
    notificationData.type === "leaderboard_rank_up" ||
    notificationData.type === "leaderboard_rank_down" ||
    notificationData.type === "leaderboard_passed"
  ) {
    return "/achievements/leaderboard";
  }
  if (
    notificationData.type === "follow" ||
    notificationData.type === "contact_joined" ||
    notificationData.type === "new_follower" ||
    notificationData.type === "user_follow" ||
    notificationData.type === "friend_request" ||
    notificationData.type === "friend_accept"
  ) {
    return profileUserId
      ? `/userDisplay?userId=${encodeURIComponent(profileUserId)}`
      : "/userDisplay/userDisplay";
  }
  if (notificationData.type === "group_joined" || notificationData.type === "group_invite" || notificationData.type === "group_faceoff") {
    const groupId = asTrimmedString(metadata.groupId);
    return groupId ? `/groups/${groupId}` : "/map";
  }
  if (notificationData.type === "invite" || notificationData.type === "collection_shared") {
    return "/collections/collection";
  }
  if (
    notificationData.type === "chat" ||
    notificationData.type === "message" ||
    notificationData.type === "dm" ||
    notificationData.type === "new_message" ||
    notificationData.type === "direct_message" ||
    notificationData.type === "groupchat"
  ) {
    return "/chat/chatScreen";
  }
  return "/map";
}

/** Explicit routing hint for native clients (alongside legacy `route`). */
export function inferPushTargetType(notificationData: LegacyNotificationData): "post" | "user" | "chat" | "collection" | "route" {
  const t = asTrimmedString(notificationData.type)?.toLowerCase() ?? "";
  if (
    t === "chat" ||
    t === "message" ||
    t === "dm" ||
    t === "new_message" ||
    t === "direct_message" ||
    t === "groupchat"
  ) {
    return "chat";
  }
  if (
    t === "follow" ||
    t === "contact_joined" ||
    t === "new_follower" ||
    t === "user_follow" ||
    t === "friend_request" ||
    t === "friend_accept"
  ) {
    return "user";
  }
  if (t === "invite" || t === "collection_shared" || t === "addedcollaborator") return "collection";
  if (
    t === "like" ||
    t === "comment" ||
    t === "mention" ||
    t === "post" ||
    t === "post_discovery" ||
    t === "push_image_test" ||
    t === "post_like" ||
    t === "post_comment" ||
    t === "reply" ||
    t === "saved_post" ||
    t === "collection_add" ||
    t === "tag" ||
    t === "system_post_featured" ||
    t === "generic_post" ||
    asTrimmedString(notificationData.postId)
  ) {
    return "post";
  }
  if (t === "group_joined" || t === "group_invite" || t === "group_faceoff") return "route";
  return "route";
}

function isLikelyExpoPushToken(value: string): boolean {
  return /^ExponentPushToken\[/.test(value) || /^ExpoPushToken\[/.test(value);
}

/** Bounded unique Expo device tokens from user doc (scalar + arrays). */
export function collectExponentPushTokenTargets(userData: Record<string, unknown>, max: number = MAX_EXPO_PUSH_TARGETS_PER_SEND): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushOne = (raw: unknown) => {
    const s = asTrimmedString(raw);
    if (!s || !isLikelyExpoPushToken(s) || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  pushOne(userData.expoPushToken);
  const expoArr = userData.expoPushTokens;
  if (Array.isArray(expoArr)) {
    for (const x of expoArr) pushOne(x);
  }
  const pushArr = userData.pushTokens;
  if (Array.isArray(pushArr)) {
    for (const x of pushArr) pushOne(x);
  }
  pushOne(userData.pushToken);
  return out.slice(0, max);
}

function isDeviceNotRegisteredMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.trim().toLowerCase();
  return m.includes("devicenotregistered") || m === "devicenotregistered";
}

function expoPushResponseRows(responseBody: unknown): unknown[] {
  if (!responseBody || typeof responseBody !== "object") return [];
  const d = (responseBody as { data?: unknown }).data;
  if (Array.isArray(d)) return d;
  if (d != null && typeof d === "object") return [d];
  return [];
}

function parseExpoPushInvalidTokens(tokensSent: readonly string[], responseBody: unknown): string[] {
  const invalid = new Set<string>();
  const rows = expoPushResponseRows(responseBody);
  if (rows.length === 0) return [...invalid];
  rows.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const r = row as { status?: unknown; message?: unknown };
    const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
    if (status === "error" && isDeviceNotRegisteredMessage(r.message)) {
      const token = tokensSent[i] ?? tokensSent[0];
      if (token) invalid.add(token);
    }
  });
  return [...invalid];
}

function expoResponseHasOkTicket(responseBody: unknown): boolean {
  return expoPushResponseRows(responseBody).some(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as { status?: unknown }).status ?? "").toLowerCase() === "ok"
  );
}

async function removeStaleExpoPushTokensFromUserDoc(
  db: Firestore,
  recipientUserId: string,
  staleTokens: readonly string[]
): Promise<void> {
  if (staleTokens.length === 0) return;
  const unique = [...new Set(staleTokens.filter((t) => t.trim().length > 0))];
  if (unique.length === 0) return;
  const ref = db.collection("users").doc(recipientUserId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const scalar = asTrimmedString(data.expoPushToken);
  const patch: Record<string, unknown> = {
    expoPushTokens: FieldValue.arrayRemove(...unique),
    pushTokens: FieldValue.arrayRemove(...unique),
  };
  if (scalar && unique.includes(scalar)) {
    patch.expoPushToken = FieldValue.delete();
  }
  try {
    await ref.update(patch);
  } catch (error) {
    console.warn("[notifications] failed to strip stale expo push tokens", {
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolvePushText(notificationData: LegacyNotificationData, senderData: LegacyNotificationSender | null): {
  title: string;
  body: string;
} {
  const displayName = asTrimmedString(senderData?.senderName) ?? "Someone";
  const title = asTrimmedString(notificationData.pushTitle) ?? displayName;
  if (asTrimmedString(notificationData.pushBody)) {
    return { title, body: asTrimmedString(notificationData.pushBody)! };
  }
  if (notificationData.type === "like") return { title, body: "liked your post" };
  if (notificationData.type === "comment") return { title, body: "commented on your post" };
  if (notificationData.type === "mention") return { title, body: notificationData.message || "mentioned you in a post" };
  if (notificationData.type === "follow") return { title, body: "followed you" };
  if (notificationData.type === "contact_joined") return { title, body: "joined the app" };
  if (notificationData.type === "group_joined") {
    const groupName = asTrimmedString(notificationData.metadata?.groupName) ?? "your group";
    return { title, body: `joined ${groupName}` };
  }
  if (notificationData.type === "group_invite") {
    const groupName = asTrimmedString(notificationData.metadata?.groupName) ?? "a group";
    return { title, body: `invited you to join ${groupName}` };
  }
  if (notificationData.type === "post") return { title, body: "just posted!" };
  if (notificationData.type === "invite") {
    const collectionName = asTrimmedString(notificationData.metadata?.collectionName) ?? "a collection";
    return { title, body: `invited you to collaborate on "${collectionName}".` };
  }
  if (notificationData.type === "collection_shared") {
    const collectionName = asTrimmedString(notificationData.metadata?.collectionName) ?? "a collection";
    return { title, body: `shared collection "${collectionName}" with you.` };
  }
  if (notificationData.type === "chat") return { title, body: notificationData.message || "New message" };
  if (notificationData.type === "place_follow") {
    const placeName = asTrimmedString(notificationData.metadata?.placeName) ?? "a place";
    return { title, body: `started following "${placeName}".` };
  }
  if (notificationData.type === "audio_like") return { title, body: "liked your audio." };
  if (notificationData.type === "system") return { title: "Locava", body: notificationData.message || "Notification" };
  return { title, body: notificationData.message || "You have a new notification." };
}

export function buildLegacyExpoPushPayload(
  notificationData: LegacyNotificationData,
  senderData: LegacyNotificationSender | null,
  routingMeta?: LegacyPushRoutingMeta | null
): Record<string, unknown> {
  const { title, body } = resolvePushText(notificationData, senderData);
  const metadata = notificationData.metadata ?? {};
  const profileUserId =
    asTrimmedString(notificationData.targetUserId) ??
    asTrimmedString(notificationData.profileUserId) ??
    asTrimmedString(notificationData.senderUserId);
  const routeIntent = buildLegacyRoute(notificationData);
  const data: Record<string, unknown> = {
    type: notificationData.type || "",
    senderUserId: notificationData.senderUserId || "",
    route: routeIntent,
    ...(notificationData.pushData ?? {}),
  };
  const optionalData: Array<[string, unknown]> = [
    ["collectionId", notificationData.collectionId],
    ["collectionName", metadata.collectionName],
    ["postId", notificationData.postId],
    ["chatId", notificationData.chatId],
    ["placeId", notificationData.placeId],
    ["audioId", notificationData.audioId],
    ["commentId", notificationData.commentId],
    ["groupId", metadata.groupId],
    ["groupName", metadata.groupName],
    ["postTitle", metadata.postTitle],
    ["profileUserId", profileUserId],
  ];
  for (const [key, value] of optionalData) {
    const resolved = typeof value === "string" ? value.trim() : value;
    if (typeof resolved === "string" && resolved.length > 0) {
      data[key] = resolved;
    }
  }
  if (routingMeta) {
    data.notificationId = routingMeta.notificationId;
    data.recipientUserId = routingMeta.recipientUserId;
    const targetType = inferPushTargetType(notificationData);
    data.targetType = targetType;
    const postId = asTrimmedString(data.postId ?? notificationData.postId);
    if (targetType === "post" && postId) {
      data.targetId = postId;
      data.routeIntent = { targetType: "post", postId, targetId: postId };
    } else if (targetType === "user") {
      const userId = asTrimmedString(profileUserId) ?? "";
      if (userId) {
        data.targetId = userId;
        data.routeIntent = { targetType: "user", userId, targetId: userId };
      }
    } else if (targetType === "chat") {
      const chatId = asTrimmedString(data.chatId ?? notificationData.chatId);
      if (chatId) {
        data.targetId = chatId;
        data.routeIntent = { targetType: "chat", chatId, targetId: chatId };
      }
    } else {
      data.routeIntent = routeIntent;
    }
  }
  if (asTrimmedString(senderData?.senderProfilePic)) {
    data.senderProfilePic = asTrimmedString(senderData?.senderProfilePic)!;
  }
  if (asTrimmedString(senderData?.senderName)) {
    data.senderDisplayName = asTrimmedString(senderData?.senderName)!;
  }

  const payload: Record<string, unknown> = {
    sound: "default",
    title,
    body,
    data: stringifyExpoDataValues(data),
  };

  const imageUrl = resolveRichImageUrl(notificationData, senderData);
  if (imageUrl && (isPostRelatedPush(notificationData) || isPeopleRelatedPush(notificationData))) {
    payload.richContent = { image: imageUrl };
    payload.mutableContent = true;
    const stringData = payload.data as Record<string, string>;
    stringData.imageUrl = imageUrl;
    stringData._richContent = JSON.stringify({ image: imageUrl });
  }

  return payload;
}

class LegacyNotificationPushPublisher {
  getDebugStatus(notificationId: string): PushDeliveryDebugStatus | null {
    return pushDebugByNotificationId.get(notificationId) ?? null;
  }

  preview(notificationData: LegacyNotificationData, senderData: LegacyNotificationSender | null): Record<string, unknown> {
    return buildLegacyExpoPushPayload(notificationData, senderData);
  }

  async sendToRecipient(input: {
    notificationId: string;
    recipientUserId: string;
    notificationData: LegacyNotificationData;
    senderData: LegacyNotificationSender | null;
  }): Promise<PushDeliveryDebugStatus> {
    const baseStatus: PushDeliveryDebugStatus = {
      notificationId: input.notificationId,
      recipientUserId: input.recipientUserId,
      attempted: false,
      success: false,
      updatedAtMs: Date.now(),
    };
    const routingMeta: LegacyPushRoutingMeta = {
      notificationId: input.notificationId,
      recipientUserId: input.recipientUserId,
    };
    const db = getFirestoreSourceClient();
    if (!db) {
      pushDebugByNotificationId.set(input.notificationId, {
        ...baseStatus,
        error: "firestore_unavailable",
      });
      return pushDebugByNotificationId.get(input.notificationId)!;
    }
    try {
      const userSnap = await db.collection("users").doc(input.recipientUserId).get();
      const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
      const targets = collectExponentPushTokenTargets(userData, MAX_EXPO_PUSH_TARGETS_PER_SEND);
      if (targets.length === 0) {
        const status = {
          ...baseStatus,
          attempted: true,
          skippedNoExpoToken: true,
          success: true,
          updatedAtMs: Date.now(),
        };
        pushDebugByNotificationId.set(input.notificationId, status);
        return status;
      }
      const payloadBase = buildLegacyExpoPushPayload(input.notificationData, input.senderData, routingMeta);
      const messages = targets.map((to) => ({
        ...payloadBase,
        to,
        priority: "high" as const,
      }));
      const response = await fetch(DEFAULT_EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
          "content-type": "application/json",
        },
        body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
      });
      const responseBody = await response.json().catch(() => null);
      const stale = parseExpoPushInvalidTokens(targets, responseBody);
      if (stale.length > 0) {
        void removeStaleExpoPushTokensFromUserDoc(db, input.recipientUserId, stale);
      }
      const ticketsOk = expoResponseHasOkTicket(responseBody);
      const success = response.ok && ticketsOk;
      const status: PushDeliveryDebugStatus = {
        ...baseStatus,
        attempted: true,
        success,
        payload: payloadBase,
        responseBody,
        error: success ? undefined : response.ok ? "expo_ticket_all_errors" : `expo_http_${response.status}`,
        updatedAtMs: Date.now(),
      };
      pushDebugByNotificationId.set(input.notificationId, status);
      return status;
    } catch (error) {
      const status: PushDeliveryDebugStatus = {
        ...baseStatus,
        attempted: true,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        updatedAtMs: Date.now(),
      };
      pushDebugByNotificationId.set(input.notificationId, status);
      return status;
    }
  }
}

export const legacyNotificationPushPublisher = new LegacyNotificationPushPublisher();
