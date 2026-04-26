import { resolveLocalDebugViewerId } from "../src/lib/local-dev-identity.ts";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8090";
const VIEWER_ID = resolveLocalDebugViewerId(process.env.DEBUG_VIEWER_ID);

type CheckResult = {
  surface: string;
  ok: boolean;
  notes: string[];
};

function assert(condition: boolean, msg: string, notes: string[]): void {
  if (!condition) notes.push(msg);
}

async function json(method: string, path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "content-type": "application/json", "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" } : { "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await res.json().catch(() => ({}));
    return { status: res.status, payload };
  } catch (error) {
    return {
      status: 0,
      payload: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function jsonWithRetry(method: string, path: string, body?: unknown): Promise<any> {
  const first = await json(method, path, body);
  if (first.status >= 200 && first.status < 300) return first;
  return json(method, path, body);
}

async function checkV2NotificationsHydration(): Promise<CheckResult> {
  const notes: string[] = [];
  const res = await json("GET", "/v2/notifications?limit=10");
  assert(res.status === 200, "v2/notifications did not return 200", notes);
  const items = res.payload?.data?.items ?? [];
  assert(Array.isArray(items), "v2 notifications items missing", notes);
  const first = items[0];
  if (first) {
    const actor = first.actor;
    assert(actor && typeof actor.userId === "string" && actor.userId.length > 0, "v2 notification actor.userId missing", notes);
    assert(typeof actor.handle === "string", "v2 notification actor.handle missing", notes);
  }
  return { surface: "V2 Notifications Hydration", ok: notes.length === 0, notes };
}

async function checkChatsInbox(): Promise<CheckResult> {
  const notes: string[] = [];
  const res = await json("GET", "/v2/chats/inbox?limit=10");
  assert(res.status === 200, "v2/chats/inbox did not return 200", notes);
  const items = res.payload?.data?.items ?? [];
  assert(Array.isArray(items), "chats inbox items missing", notes);
  const direct = items.find((it: any) => it?.isGroup === false);
  if (direct) {
    assert(typeof direct.displayPhotoUrl === "string" || direct.displayPhotoUrl === null, "direct chat displayPhotoUrl missing", notes);
  }
  return { surface: "Chats Inbox", ok: notes.length === 0, notes };
}

async function checkConnectionsCompat(): Promise<CheckResult> {
  const notes: string[] = [];
  const following = await json("GET", `/api/v1/product/connections/user/${encodeURIComponent(VIEWER_ID)}/following?page=1&limit=20`);
  const followers = await json("GET", `/api/v1/product/connections/user/${encodeURIComponent(VIEWER_ID)}/followers?page=1&limit=20`);
  const friends = await json("GET", `/api/v1/product/users/${encodeURIComponent(VIEWER_ID)}/friends-data`);
  assert(following.status === 200, "following compat endpoint failed", notes);
  assert(followers.status === 200, "followers compat endpoint failed", notes);
  assert(friends.status === 200, "friends-data compat endpoint failed", notes);
  assert(Array.isArray(following.payload?.following), "following array missing", notes);
  assert(Array.isArray(followers.payload?.followers), "followers array missing", notes);
  assert(Array.isArray(friends.payload?.following), "friends-data following missing", notes);
  return { surface: "Followers/Following Compat", ok: notes.length === 0, notes };
}

async function checkMixesCompat(): Promise<CheckResult> {
  const notes: string[] = [];
  const prewarm = await json("POST", "/api/v1/product/mixes/prewarm", {});
  const suggest = await json("POST", "/api/v1/product/mixes/suggest", { query: "food" });
  const feed = await json("POST", "/api/v1/product/mixes/feed", { limit: 12 });
  assert(prewarm.status === 200, "mixes/prewarm failed", notes);
  assert(suggest.status === 200, "mixes/suggest failed", notes);
  assert(feed.status === 200, "mixes/feed failed", notes);
  assert(Array.isArray(prewarm.payload?.mixSpecs), "mixSpecs missing in prewarm", notes);
  assert(Array.isArray(prewarm.payload?.previews), "previews missing in prewarm", notes);
  assert(Array.isArray(suggest.payload?.candidates), "candidates missing in suggest", notes);
  assert(Array.isArray(feed.payload?.posts), "posts missing in feed", notes);
  return { surface: "Search Default Mixes Compat", ok: notes.length === 0, notes };
}

async function checkProfileAndSearchV2(): Promise<CheckResult> {
  const notes: string[] = [];
  const profile = await jsonWithRetry("GET", `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/bootstrap?gridLimit=12`);
  const searchUsers = await jsonWithRetry("GET", "/v2/search/users?q=jo&limit=8");
  const searchResults = await jsonWithRetry("GET", "/v2/search/results?q=food&limit=8");
  assert(profile.status === 200, "profile bootstrap failed", notes);
  assert(searchUsers.status === 200, "search users failed", notes);
  assert(searchResults.status === 200, "search results failed", notes);
  assert(typeof profile.payload?.data?.firstRender?.profile?.profilePic === "string", "profile bootstrap profilePic missing", notes);
  return { surface: "Profile/Search V2", ok: notes.length === 0, notes };
}

async function checkSearchLegacy(): Promise<CheckResult> {
  const notes: string[] = [];
  const suggest = await json("POST", "/api/v1/product/search/suggest", { query: "hiking" });
  const bootstrap = await json("POST", "/api/v1/product/search/bootstrap", { query: "hiking", limit: 10 });
  const live = await json("POST", "/api/v1/product/search/live", { query: "hiking", limit: 10 });
  assert(suggest.status === 200, "search/suggest failed", notes);
  assert(bootstrap.status === 200, "search/bootstrap failed", notes);
  assert(live.status === 200, "search/live failed", notes);
  assert(Array.isArray(suggest.payload?.suggestions), "search/suggest suggestions missing", notes);
  assert(Array.isArray(bootstrap.payload?.posts), "search/bootstrap posts missing", notes);
  assert(Array.isArray(live.payload?.posts), "search/live posts missing", notes);
  const firstBootstrap = bootstrap.payload?.posts?.[0];
  if (firstBootstrap) {
    assert(typeof firstBootstrap.postId === "string" && firstBootstrap.postId.length > 0, "search/bootstrap postId missing", notes);
    assert(typeof firstBootstrap.userId === "string", "search/bootstrap userId missing", notes);
    assert(typeof firstBootstrap.thumbUrl === "string", "search/bootstrap thumbUrl missing", notes);
  }
  return { surface: "Search Legacy Compat", ok: notes.length === 0, notes };
}

async function checkNotificationsLegacy(): Promise<CheckResult> {
  const notes: string[] = [];
  const list = await json("GET", "/api/v1/product/notifications?limit=10");
  const bootstrap = await json("GET", "/api/v1/product/notifications/bootstrap?limit=10");
  const stats = await json("GET", "/api/v1/product/notifications/stats");
  const readAllPost = await json("POST", "/api/v1/product/notifications/read-all", {});
  const readAllPut = await json("PUT", "/api/v1/product/notifications/read-all", {});
  assert(list.status === 200, "notifications list failed", notes);
  assert(bootstrap.status === 200, "notifications bootstrap failed", notes);
  assert(stats.status === 200, "notifications stats failed", notes);
  assert(readAllPost.status === 200, "notifications read-all POST failed", notes);
  assert(readAllPut.status === 200, "notifications read-all PUT failed", notes);
  assert(Array.isArray(list.payload?.notifications), "notifications list shape invalid", notes);
  assert(Array.isArray(bootstrap.payload?.notifications), "notifications bootstrap shape invalid", notes);
  assert(typeof stats.payload?.stats === "object", "notifications stats payload missing", notes);
  return { surface: "Notifications Legacy Compat", ok: notes.length === 0, notes };
}

async function checkCollectionsCommentsLegacy(): Promise<CheckResult> {
  const notes: string[] = [];
  const collections = await json("GET", "/api/v1/product/collections");
  const generated = await json("GET", "/api/v1/product/collections/generated");
  const create = await json("POST", "/api/v1/product/collections", { name: "Parity test" });
  const commentsList = await json("GET", "/api/v1/product/comments/test-post");
  const commentsCreate = await json("POST", "/api/v1/product/comments/test-post", { text: "hello" });
  assert(collections.status === 200, "collections list failed", notes);
  assert(generated.status === 200, "collections generated failed", notes);
  assert(create.status === 200, "collections create failed", notes);
  assert(commentsList.status === 200, "comments list failed", notes);
  assert(commentsCreate.status === 200, "comments create failed", notes);
  assert(Array.isArray(collections.payload?.collections), "collections list shape invalid", notes);
  assert(Array.isArray(commentsList.payload?.comments), "comments list shape invalid", notes);
  return { surface: "Collections/Comments Legacy Compat", ok: notes.length === 0, notes };
}

async function checkReelsLocationUploadCompat(): Promise<CheckResult> {
  const notes: string[] = [];
  const reels = await json("GET", "/api/v1/product/reels/bootstrap");
  const nearMe = await json("GET", "/api/v1/product/reels/near-me?lat=0&lng=0&radiusMiles=10&limit=8");
  const nearMeCount = await json("GET", "/api/v1/product/reels/near-me/count?lat=0&lng=0&radiusMiles=10");
  const mapBootstrap = await json("GET", "/api/v1/product/map/bootstrap?limit=20");
  const autocomplete = await json("GET", "/api/v1/product/location/autocomplete?q=Bos");
  const geocode = await json("POST", "/api/v1/product/location/forward-geocode", { text: "Boston" });
  const uploadSession = await json("POST", "/api/v1/product/upload/stage-presign", {
    sessionId: "parity_presign_smoke",
    items: [{ index: 0, assetType: "photo" }]
  });
  assert(reels.status === 200, "reels bootstrap failed", notes);
  assert(nearMe.status === 200, "reels near-me failed", notes);
  assert(nearMeCount.status === 200, "reels near-me count failed", notes);
  assert(mapBootstrap.status === 200, "map bootstrap failed", notes);
  assert(
    autocomplete.status === 200 || autocomplete.status === 503,
    "location autocomplete must be monolith-proxied (200) or explicit upstream_unavailable (503)",
    notes
  );
  assert(
    geocode.status === 200 || geocode.status === 503,
    "forward geocode must be monolith-proxied (200) or explicit upstream_unavailable (503)",
    notes
  );
  assert(
    uploadSession.status === 200 || uploadSession.status === 503,
    "upload stage-presign failed",
    notes
  );
  assert(Array.isArray(mapBootstrap.payload?.posts), "map bootstrap posts missing", notes);
  assert(typeof nearMeCount.payload?.count === "number", "reels near-me count shape invalid", notes);
  return { surface: "Reels/Map/Location/Upload Compat", ok: notes.length === 0, notes };
}

async function checkFeedHydrationQuality(): Promise<CheckResult> {
  const notes: string[] = [];
  const feed = await jsonWithRetry("GET", "/v2/feed/bootstrap?limit=8");
  assert(feed.status === 200, "v2 feed bootstrap failed", notes);
  const items = feed.payload?.data?.firstRender?.feed?.items;
  assert(Array.isArray(items), "v2 feed bootstrap items missing", notes);
  const first = Array.isArray(items) ? items[0] : null;
  if (first) {
    const postId = String(first.postId ?? first.id ?? "");
    assert(postId.length > 0, "v2 feed first item missing post id", notes);
    const author = first.author ?? {};
    assert(typeof author.userId === "string" && author.userId.length > 0, "v2 feed author.userId missing", notes);
    assert(typeof author.handle === "string", "v2 feed author.handle missing", notes);
    const media = first.media ?? {};
    assert(typeof media.posterUrl === "string", "v2 feed media.posterUrl missing", notes);
  }
  return { surface: "Feed Hydration Quality", ok: notes.length === 0, notes };
}

async function checkLegacyPathCoverage(): Promise<CheckResult> {
  const notes: string[] = [];
  const checks: Array<{ method: string; path: string; expect2xx?: boolean }> = [
    { method: "GET", path: "/api/v1/product/viewer/bootstrap", expect2xx: true },
    { method: "GET", path: "/api/v1/product/feed/bootstrap?limit=8", expect2xx: true },
    { method: "GET", path: `/api/v1/product/connections/status/${encodeURIComponent(VIEWER_ID)}`, expect2xx: true },
    { method: "POST", path: "/api/v1/product/dynamic-collections/materialize", expect2xx: true },
    { method: "GET", path: "/api/v1/product/dynamic-collections/by-slug/test-slug", expect2xx: true },
    { method: "POST", path: "/api/v1/product/upload/create-from-staged", expect2xx: true },
    { method: "POST", path: "/api/v1/product/upload/create-with-files", expect2xx: true },
    { method: "POST", path: "/api/v1/product/upload/create-with-files-async", expect2xx: true },
    { method: "GET", path: "/api/v1/product/groups", expect2xx: true }
  ];

  for (const c of checks) {
    const res = await json(c.method, c.path, c.method === "POST" ? {} : undefined);
    if (c.expect2xx) {
      const isDynamic = c.path.includes("dynamic-collections");
      const isGeocode = c.path.includes("location/");
      const isUpload = c.path.includes("/api/v1/product/upload/");
      if (isDynamic || isGeocode) {
        assert(
          (res.status >= 200 && res.status < 300) || res.status === 503,
          `${c.method} ${c.path} failed (${res.status})`,
          notes
        );
      } else if (isUpload) {
        assert(res.status === 200 || res.status === 503, `${c.method} ${c.path} failed (${res.status})`, notes);
      } else {
        assert(res.status >= 200 && res.status < 300, `${c.method} ${c.path} failed (${res.status})`, notes);
      }
    } else {
      assert(res.status !== 404, `${c.method} ${c.path} returned 404`, notes);
    }
  }
  return { surface: "Legacy Path Coverage", ok: notes.length === 0, notes };
}

async function checkChatReactionAndFeedSeen(): Promise<CheckResult> {
  const notes: string[] = [];
  const inbox = await json("GET", "/v2/chats/inbox?limit=10");
  assert(inbox.status === 200, "chats inbox for reaction test failed", notes);
  const convId = String(inbox.payload?.data?.items?.[0]?.conversationId ?? "");
  assert(convId.length > 0, "missing conversation id for reaction test", notes);
  const thread = await json("GET", `/v2/chats/${encodeURIComponent(convId)}/messages?limit=10`);
  assert(thread.status === 200, "thread for reaction test failed", notes);
  const mid = String(thread.payload?.data?.items?.[0]?.messageId ?? "");
  assert(mid.length > 0, "missing message id for reaction test", notes);
  const react = await json("POST", `/v2/chats/${encodeURIComponent(convId)}/messages/${encodeURIComponent(mid)}/reaction`, {
    emoji: "❤️"
  });
  assert(react.status === 200, "message reaction failed", notes);
  assert(react.payload?.data?.viewerReaction === "❤️", "viewer reaction not echoed", notes);

  const seen = await json("POST", "/api/v1/product/feed/seen/clear", {});
  assert(seen.status === 200, "feed seen clear failed", notes);
  assert(typeof seen.payload?.clearedAtMs === "number", "feed seen clear missing clearedAtMs", notes);

  const groups = await json("GET", "/api/v1/product/groups");
  assert(groups.status === 200, "legacy groups list failed", notes);
  assert(Array.isArray(groups.payload?.groups), "legacy groups list shape invalid", notes);
  return { surface: "Chat Reaction / Feed Seen / Groups", ok: notes.length === 0, notes };
}

async function checkV2CollectionManage(): Promise<CheckResult> {
  const notes: string[] = [];
  const create = await json("POST", "/v2/collections/create", {
    name: "Parity Manage Test",
    privacy: "private",
    collaborators: [],
    items: []
  });
  assert(create.status === 200, "v2 collections create failed", notes);
  const createdId = String(create.payload?.data?.collection?.id ?? create.payload?.data?.collectionId ?? "");
  assert(createdId.length > 0, "v2 collections create missing collection id", notes);
  if (createdId) {
    const leave = await json("POST", `/v2/collections/${encodeURIComponent(createdId)}/leave`, {});
    assert(leave.status === 200, "v2 collections leave failed", notes);
    const recreate = await json("POST", "/v2/collections/create", {
      name: "Parity Delete Test",
      privacy: "private",
      collaborators: [],
      items: []
    });
    const recreateId = String(recreate.payload?.data?.collection?.id ?? recreate.payload?.data?.collectionId ?? "");
    if (recreateId) {
      const del = await json("POST", `/v2/collections/${encodeURIComponent(recreateId)}/delete`, {});
      assert(del.status === 200, "v2 collections delete failed", notes);
    } else {
      notes.push("v2 collections recreate missing collection id");
    }
  }
  return { surface: "V2 Collections Manage", ok: notes.length === 0, notes };
}

async function main(): Promise<void> {
  const checks = await Promise.all([
    checkChatsInbox(),
    checkV2NotificationsHydration(),
    checkConnectionsCompat(),
    checkMixesCompat(),
    checkProfileAndSearchV2(),
    checkSearchLegacy(),
    checkNotificationsLegacy(),
    checkCollectionsCommentsLegacy(),
    checkReelsLocationUploadCompat(),
    checkLegacyPathCoverage(),
    checkV2CollectionManage(),
    checkFeedHydrationQuality(),
    checkChatReactionAndFeedSeen()
  ]);

  let failed = 0;
  for (const c of checks) {
    const status = c.ok ? "PASS" : "FAIL";
    if (!c.ok) failed += 1;
    console.log(`[${status}] ${c.surface}`);
    if (!c.ok) {
      for (const note of c.notes) console.log(`  - ${note}`);
    }
  }

  if (failed > 0) process.exit(1);
}

await main();
