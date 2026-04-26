import { resolveLocalDebugViewerId } from "../src/lib/local-dev-identity.ts";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = resolveLocalDebugViewerId(process.env.DEBUG_VIEWER_ID);

type JsonValue = Record<string, unknown>;
type RunRow = {
  key: string;
  status: number;
  elapsedMs: number;
  routeLatencyMs: number | null;
  dbReads: number;
  dbQueries: number;
  fallbackUsage: string[];
  timeoutUsage: string[];
};

const runRows: RunRow[] = [];

async function call(method: string, path: string, body?: unknown): Promise<JsonValue> {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const elapsedMs = Date.now() - started;
  const payload = (await response.json()) as JsonValue;
  const printable = {
    method,
    path,
    status: response.status,
    elapsedMs,
    ok: (payload.ok as boolean | undefined) ?? (payload.ok === undefined && response.ok),
    canonicalRoute: payload.canonicalRoute,
    usedRealFirestoreData: payload.usedRealFirestoreData,
    fallbackUsage: payload.fallbackUsage,
    legacyPathUsage: payload.legacyPathUsage
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(printable));
  runRows.push({
    key: `${method} ${path}`,
    status: response.status,
    elapsedMs,
    routeLatencyMs: typeof (payload.timingMs as JsonValue | undefined)?.routeLatency === "number"
      ? Number((payload.timingMs as JsonValue).routeLatency)
      : null,
    dbReads: Number((((payload.envelopeMeta as JsonValue | undefined)?.db as JsonValue | undefined)?.reads as number | undefined) ?? 0),
    dbQueries: Number((((payload.envelopeMeta as JsonValue | undefined)?.db as JsonValue | undefined)?.queries as number | undefined) ?? 0),
    fallbackUsage: Array.isArray(payload.fallbackUsage) ? (payload.fallbackUsage as string[]) : [],
    timeoutUsage: Array.isArray(payload.timeoutUsage) ? (payload.timeoutUsage as string[]) : []
  });
  if (path.startsWith("/debug/local")) {
    const effectiveViewerId = typeof payload.effectiveViewerId === "string" ? payload.effectiveViewerId : null;
    if (effectiveViewerId !== VIEWER_ID) {
      throw new Error(`unexpected_effective_viewer_id:${path}:${String(effectiveViewerId)}`);
    }
  }
  return payload;
}

function readConversationId(inboxPayload: JsonValue): string | null {
  const rows = (((inboxPayload.responseData as JsonValue | undefined)?.items as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const first = rows[0];
  return typeof first?.conversationId === "string" ? first.conversationId : null;
}

function readFeedPostId(feedPayload: JsonValue): string | null {
  const rows = (((feedPayload.responseData as JsonValue | undefined)?.items as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const first = rows[0];
  return typeof first?.postId === "string" ? first.postId : null;
}

function readNotificationIds(listPayload: JsonValue): string[] {
  const rows = (((listPayload.responseData as JsonValue | undefined)?.items as unknown[]) ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, 3);
}

function readCollectionId(createPayload: JsonValue): string | null {
  const data = createPayload.responseData as JsonValue | undefined;
  if (!data) return null;
  const direct = data.collectionId;
  if (typeof direct === "string") return direct;
  const nested = (data.collection as JsonValue | undefined)?.id;
  return typeof nested === "string" ? nested : null;
}

async function main(): Promise<void> {
  const authEmail = `debug.harness.${Date.now()}@example.com`;
  const authPassword = "Passw0rd!";
  const registered = await call("POST", "/v2/auth/register", {
    email: authEmail,
    password: authPassword,
    displayName: "Debug Harness User"
  });
  const registerUid = typeof ((registered.data as JsonValue | undefined)?.user as JsonValue | undefined)?.uid === "string"
    ? ((((registered.data as JsonValue | undefined)?.user as JsonValue).uid) as string)
    : null;
  if (registerUid) {
    await call("POST", "/v2/auth/profile", {
      userId: registerUid,
      name: "Debug Harness User",
      age: 28,
      handle: `debug${Date.now().toString().slice(-6)}`
    });
    await call("POST", "/v2/auth/profile/branch", { branchData: { source: "debug_harness" } });
    await call("POST", "/v2/auth/login", { email: authEmail, password: authPassword });
  }
  await call("GET", `/debug/local/auth/check-handle?viewerId=${encodeURIComponent(VIEWER_ID)}&handle=debug_harness_handle`);
  await call("GET", `/debug/local/auth/check-user-exists?viewerId=${encodeURIComponent(VIEWER_ID)}&email=${encodeURIComponent(authEmail)}`);

  await call("GET", "/debug/local/bootstrap");
  await call("GET", "/debug/local/auth/session");
  const profile = await call("GET", "/debug/local/profile/bootstrap");
  const profileItems = ((((profile.responseData as JsonValue | undefined)?.firstRender as JsonValue | undefined)?.gridPreview as JsonValue | undefined)?.items ??
    []) as Array<JsonValue>;
  const samplePostId = typeof profileItems[0]?.postId === "string" ? (profileItems[0].postId as string) : null;
  await call("GET", `/debug/local/profile/grid/${encodeURIComponent(VIEWER_ID)}?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=12`);
  if (samplePostId) {
    await call(
      "GET",
      `/debug/local/profile/post-detail/${encodeURIComponent(VIEWER_ID)}/${encodeURIComponent(samplePostId)}?viewerId=${encodeURIComponent(VIEWER_ID)}`
    );
  }

  const inbox = await call("GET", "/debug/local/chats/inbox?limit=10");
  let convoId = readConversationId(inbox);
  if (!convoId) {
    const direct = await call("POST", "/debug/local/chats/create-direct", {
      viewerId: VIEWER_ID,
      otherUserId: "qQkjhy6OBvOJaNpn0ZSuj1s9oUl1"
    });
    const directData = direct.responseData as JsonValue | undefined;
    convoId = typeof directData?.conversationId === "string" ? directData.conversationId : null;
  }
  if (convoId) {
    await call("GET", `/debug/local/chats/thread/${encodeURIComponent(convoId)}?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=15`);
    await call("PUT", `/debug/local/chats/${encodeURIComponent(convoId)}/typing-status`, { viewerId: VIEWER_ID, isTyping: true });
    await call("POST", `/debug/local/chats/${encodeURIComponent(convoId)}/send`, {
      viewerId: VIEWER_ID,
      messageType: "text",
      text: `harness ${new Date().toISOString()}`
    });
    await call("POST", `/debug/local/chats/${encodeURIComponent(convoId)}/mark-read`, { viewerId: VIEWER_ID });
    await call("POST", `/debug/local/chats/${encodeURIComponent(convoId)}/mark-unread`, { viewerId: VIEWER_ID });
  }
  await call("GET", "/debug/local/search/users?q=jo");
  await call("GET", `/debug/local/search/results?viewerId=${encodeURIComponent(VIEWER_ID)}&q=food`);
  await call("GET", `/debug/local/directory/users?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`);
  await call("GET", `/debug/local/collections/list?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`);
  await call("GET", `/debug/local/collections/saved?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`);
  const created = await call("POST", "/debug/local/collections/create", {
    viewerId: VIEWER_ID,
    name: `Debug Harness ${new Date().toISOString()}`,
    description: "Created by smoke script",
    privacy: "private"
  });
  const collectionId = readCollectionId(created);
  if (collectionId) {
    await call("GET", `/debug/local/collections/detail/${encodeURIComponent(collectionId)}?viewerId=${encodeURIComponent(VIEWER_ID)}`);
    await call("POST", "/debug/local/collections/update", {
      viewerId: VIEWER_ID,
      collectionId,
      updates: { description: `Updated by smoke at ${new Date().toISOString()}` }
    });
  }
  await call("GET", `/debug/local/achievements/hero?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/snapshot?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/pending-delta?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/status?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/badges?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/leagues?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/achievements/leaderboard/xp_global?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("POST", "/debug/local/achievements/screen-opened", { viewerId: VIEWER_ID });
  await call("POST", "/debug/local/achievements/ack-leaderboard-event", { viewerId: VIEWER_ID, eventId: "debug-harness-event" });
  const notifications = await call("GET", `/debug/local/notifications/list?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`);
  const notificationIds = readNotificationIds(notifications);
  if (notificationIds.length > 0) {
    await call("POST", "/debug/local/notifications/mark-read", { viewerId: VIEWER_ID, notificationIds });
  }
  await call("POST", "/debug/local/notifications/mark-all-read", { viewerId: VIEWER_ID });
  const feedBootstrap = await call("GET", `/debug/local/feed/bootstrap?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/feed/page?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  const interactionPostId = samplePostId ?? readFeedPostId(feedBootstrap);
  if (interactionPostId) {
    await call("GET", `/debug/local/feed/item-detail/${encodeURIComponent(interactionPostId)}?viewerId=${encodeURIComponent(VIEWER_ID)}`);
    await call("GET", `/debug/local/posts/detail/${encodeURIComponent(interactionPostId)}?viewerId=${encodeURIComponent(VIEWER_ID)}`);
    await call("POST", `/debug/local/posts/${encodeURIComponent(interactionPostId)}/like`, { viewerId: VIEWER_ID });
    await call("POST", `/debug/local/posts/${encodeURIComponent(interactionPostId)}/unlike`, { viewerId: VIEWER_ID });
    await call("POST", `/debug/local/posts/${encodeURIComponent(interactionPostId)}/save`, { viewerId: VIEWER_ID });
    await call("POST", `/debug/local/posts/${encodeURIComponent(interactionPostId)}/unsave`, { viewerId: VIEWER_ID });
    const comments = await call("GET", `/debug/local/comments/list/${encodeURIComponent(interactionPostId)}?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`);
    await call("POST", `/debug/local/comments/create/${encodeURIComponent(interactionPostId)}`, { viewerId: VIEWER_ID, text: "debug comment coverage" });
    const commentRows = (((comments.responseData as JsonValue | undefined)?.items as unknown[]) ?? []) as Array<Record<string, unknown>>;
    const firstCommentId = typeof commentRows[0]?.id === "string" ? commentRows[0].id : null;
    if (firstCommentId) {
      await call("POST", `/debug/local/comments/like/${encodeURIComponent(firstCommentId)}`, { viewerId: VIEWER_ID });
    }
  }
  await call("GET", `/debug/local/map/bootstrap?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", `/debug/local/viewer/account-state?viewerId=${encodeURIComponent(VIEWER_ID)}`);
  await call("GET", "/debug/local/rails/legacy-usage");
  await call("GET", "/debug/local-run/full-app");

  const summary = {
    totalCalls: runRows.length,
    failures: runRows.filter((row) => row.status >= 400).length,
    maxElapsedMs: Math.max(...runRows.map((row) => row.elapsedMs)),
    fallbackCalls: runRows.filter((row) => row.fallbackUsage.length > 0).length,
    timeoutCalls: runRows.filter((row) => row.timeoutUsage.length > 0).length
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ kind: "full-pass-summary", ...summary }));
}

await main();
