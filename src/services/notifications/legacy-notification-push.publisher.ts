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

const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const pushDebugByNotificationId = new Map<string, PushDeliveryDebugStatus>();

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
    notificationData.type === "push_image_test"
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
  if (notificationData.type === "follow" || notificationData.type === "contact_joined") {
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
  if (notificationData.type === "chat") {
    return "/chat/chatScreen";
  }
  return "/map";
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
  senderData: LegacyNotificationSender | null
): Record<string, unknown> {
  const { title, body } = resolvePushText(notificationData, senderData);
  const metadata = notificationData.metadata ?? {};
  const profileUserId =
    asTrimmedString(notificationData.targetUserId) ??
    asTrimmedString(notificationData.profileUserId) ??
    asTrimmedString(notificationData.senderUserId);
  const data: Record<string, unknown> = {
    type: notificationData.type || "",
    senderUserId: notificationData.senderUserId || "",
    route: buildLegacyRoute(notificationData),
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

  const imageUrl = asTrimmedString(metadata.postThumbUrl);
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
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
      const expoPushToken = asTrimmedString(userData.expoPushToken);
      if (!expoPushToken) {
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
      const payload = buildLegacyExpoPushPayload(input.notificationData, input.senderData);
      const response = await fetch(DEFAULT_EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          to: expoPushToken,
          priority: "high",
        }),
      });
      const responseBody = await response.json().catch(() => null);
      const status: PushDeliveryDebugStatus = {
        ...baseStatus,
        attempted: true,
        success: response.ok,
        payload,
        responseBody,
        error: response.ok ? undefined : `expo_http_${response.status}`,
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
