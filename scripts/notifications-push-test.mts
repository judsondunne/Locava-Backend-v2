/**
 * Sends test Expo push notifications for all known legacy notification types.
 *
 * Safety:
 * - Requires ENABLE_NOTIFICATION_PUSH_TESTS=true
 * - Disabled in production
 * - Set NOTIFICATION_TEST_EXPO_TOKEN (always single-quote in shell so `[...]` is not globbed):
 *   ENABLE_NOTIFICATION_PUSH_TESTS=true NOTIFICATION_TEST_EXPO_TOKEN='ExponentPushToken[xxxx]' npm run debug:notifications:push-test
 */

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const TARGET_TOKEN =
  process.env.NOTIFICATION_TEST_EXPO_TOKEN?.trim() || "ExponentPushToken[ldmOQlOPiuUnEK5OVWweKx]";

type NotificationTypeCase = {
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  image?: string;
};

const CASES: NotificationTypeCase[] = [
  { type: "post_discovery", title: "Locava", body: "Check out this cool swimming hole near you", data: { route: "/map" } },
  { type: "post", title: "Sender Name", body: "just posted!", data: { postId: "post_test_1", route: "/deep-link-post" } },
  { type: "like", title: "Sender Name", body: "liked your post", data: { postId: "post_test_1", route: "/deep-link-post" } },
  {
    type: "comment",
    title: "Sender Name",
    body: "commented on your post",
    data: { postId: "post_test_1", commentId: "comment_test_1", route: "/deep-link-post" }
  },
  {
    type: "mention",
    title: "Sender Name",
    body: "mentioned you in a post",
    data: { postId: "post_test_1", commentId: "comment_test_2", route: "/deep-link-post" }
  },
  { type: "follow", title: "Sender Name", body: "followed you", data: { profileUserId: "sender_user", route: "/display/display" } },
  {
    type: "contact_joined",
    title: "Sender Name",
    body: "joined the app",
    data: { profileUserId: "sender_user", route: "/display/display" }
  },
  { type: "chat", title: "Sender Name", body: "Hey from chat", data: { chatId: "chat_test_1", route: "/chat/chatScreen" } },
  {
    type: "invite",
    title: "Sender Name",
    body: "invited you to collaborate on \"A Collection\".",
    data: { collectionId: "collection_test_1", collectionName: "A Collection", route: "/collections/collection" }
  },
  {
    type: "collection_shared",
    title: "Sender Name",
    body: "shared collection \"A Collection\" with you.",
    data: { collectionId: "collection_test_1", collectionName: "A Collection", route: "/collections/collection" }
  },
  {
    type: "group_joined",
    title: "Sender Name",
    body: "joined A Group",
    data: { groupId: "group_test_1", groupName: "A Group", route: "/groups/group_test_1" }
  },
  {
    type: "group_invite",
    title: "Sender Name",
    body: "invited you to join A Group",
    data: { groupId: "group_test_1", groupName: "A Group", route: "/groups/group_test_1" }
  },
  {
    type: "place_follow",
    title: "Sender Name",
    body: "started following \"A Place\".",
    data: { placeId: "place_test_1", placeName: "A Place", route: "/map" }
  },
  {
    type: "audio_like",
    title: "Sender Name",
    body: "liked your audio.",
    data: { audioId: "audio_test_1", route: "/deep-link-post" }
  },
  { type: "system", title: "Locava", body: "System notification test", data: { route: "/map" } },
  {
    type: "achievement_leaderboard",
    title: "Leaderboard update",
    body: "Open your leaderboard.",
    data: { route: "/achievements/leaderboard" }
  },
  {
    type: "leaderboard_rank_up",
    title: "Leaderboard update",
    body: "You moved up to #2.",
    data: { rank: "2", route: "/achievements/leaderboard" }
  },
  {
    type: "leaderboard_rank_down",
    title: "Leaderboard update",
    body: "Someone passed you on the leaderboard.",
    data: { route: "/achievements/leaderboard" }
  },
  {
    type: "leaderboard_passed",
    title: "Leaderboard update",
    body: "Someone passed you on the leaderboard.",
    data: { route: "/achievements/leaderboard" }
  },
  {
    type: "push_image_test",
    title: "Sender Name",
    body: "Photo attachment test",
    data: { postId: "post_test_1", route: "/deep-link-post" },
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&auto=format&fit=crop&q=80"
  }
];

function ensureAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("notifications-push-test is disabled in production");
  }
  if (String(process.env.ENABLE_NOTIFICATION_PUSH_TESTS ?? "").toLowerCase() !== "true") {
    throw new Error("ENABLE_NOTIFICATION_PUSH_TESTS=true is required");
  }
  if (!TARGET_TOKEN.startsWith("ExponentPushToken[")) {
    throw new Error("NOTIFICATION_TEST_EXPO_TOKEN must be a valid Expo push token");
  }
}

async function expoSend(input: NotificationTypeCase): Promise<{ ticketId: string | null; ticketStatus: string; raw: unknown }> {
  const message: Record<string, unknown> = {
    to: TARGET_TOKEN,
    sound: "default",
    title: input.title,
    body: input.body,
    data: {
      notificationType: input.type,
      ...input.data
    },
    mutableContent: true
  };
  if (input.image) {
    message.richContent = { image: input.image };
    (message.data as Record<string, string>).imageUrl = input.image;
    (message.data as Record<string, string>)._richContent = JSON.stringify({ image: input.image });
    message.priority = "high";
  }

  const res = await fetch(EXPO_SEND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  });
  const payload = await res.json().catch(() => ({}));
  const ticket = Array.isArray((payload as { data?: unknown[] }).data)
    ? (payload as { data: Array<Record<string, unknown>> }).data[0]
    : ((payload as { data?: Record<string, unknown> }).data ?? {});
  const ticketId = typeof ticket?.id === "string" ? ticket.id : null;
  const ticketStatus = typeof ticket?.status === "string" ? ticket.status : "unknown";
  return { ticketId, ticketStatus, raw: payload };
}

async function fetchReceipts(ids: string[]): Promise<unknown> {
  if (ids.length === 0) return { data: {} };
  const res = await fetch(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids })
  });
  return res.json().catch(() => ({}));
}

async function main(): Promise<void> {
  ensureAllowed();
  const startedAt = Date.now();
  const rows: Array<{ type: string; ticketId: string | null; ticketStatus: string; ok: boolean; response: unknown }> = [];

  for (const c of CASES) {
    const out = await expoSend(c);
    const ok = out.ticketStatus !== "error";
    rows.push({ type: c.type, ticketId: out.ticketId, ticketStatus: out.ticketStatus, ok, response: out.raw });
    console.log(`[${ok ? "OK" : "ERR"}] ${c.type} ticketStatus=${out.ticketStatus} ticketId=${out.ticketId ?? "none"}`);
  }

  const ticketIds = rows.map((r) => r.ticketId).filter((v): v is string => typeof v === "string" && v.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const receipts = await fetchReceipts(ticketIds);
  console.log(JSON.stringify({ targetToken: TARGET_TOKEN, sentCount: rows.length, ticketIds, receipts, elapsedMs: Date.now() - startedAt }, null, 2));

  const failed = rows.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(`Expo send returned error tickets for: ${failed.map((f) => f.type).join(", ")}`);
  }
}

await main();
