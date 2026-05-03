export type RouteContract = {
  method: string;
  path: string;
  description: string;
  tags: string[];
  querySchema?: Record<string, unknown>;
  bodySchema?: Record<string, unknown>;
};

export const routeContracts: RouteContract[] = [
  { method: "GET", path: "/health", description: "Liveness check", tags: ["system"] },
  { method: "GET", path: "/ready", description: "Readiness check", tags: ["system"] },
  { method: "GET", path: "/version", description: "Service version", tags: ["system"] },
  { method: "GET", path: "/diagnostics", description: "Diagnostics and recent metrics", tags: ["observability"], querySchema: { limit: "number (1-200)" } },
  { method: "GET", path: "/routes", description: "Route manifest", tags: ["observability"] },
  {
    method: "POST",
    path: "/api/public/expo-push",
    description: "Temporary public Expo push relay for QA/manual validation",
    tags: ["public", "notifications"],
    bodySchema: { to: "ExponentPushToken[...] required", title: "string optional", body: "string required", data: "object optional" }
  },
  {
    method: "POST",
    path: "/video-processor",
    description:
      "Video worker (Cloud Tasks): downloads originals, encodes faststart AVC/HEVC ladder, uploads to Wasabi videos-lab, updates Firestore. Optional header x-locava-video-processor-secret when VIDEO_PROCESSOR_TASK_SECRET is set.",
    tags: ["internal", "media", "posting"],
    bodySchema: { postId: "string", userId: "string", videoAssets: "Array<{ id, original }>" }
  },
  { method: "GET", path: "/internal/health-dashboard", description: "Internal HTML health dashboard", tags: ["internal", "observability"] },
  { method: "GET", path: "/internal/health-dashboard/data", description: "Internal JSON health dashboard data", tags: ["internal", "observability"] },
  {
    method: "GET",
    path: "/internal/health-dashboard/cloud-tasks-video",
    description: "Probe video Cloud Tasks queue config (metadata only; no task enqueued)",
    tags: ["internal", "observability"]
  },
  { method: "GET", path: "/test/ping", description: "Basic ping", tags: ["test"] },
  { method: "POST", path: "/test/echo", description: "Echo payload", tags: ["test"], bodySchema: { message: "string", payload: "unknown optional" } },
  { method: "GET", path: "/test/error", description: "Forced error", tags: ["test"] },
  { method: "GET", path: "/test/slow", description: "Slow endpoint simulation", tags: ["test"], querySchema: { ms: "number (0-10000)" } },
  { method: "GET", path: "/test/db-simulate", description: "Database operation simulation", tags: ["test", "database"], querySchema: { reads: "number (0-1000)", writes: "number (0-1000)" } },
  { method: "GET", path: "/v2/auth/session", description: "V2 auth/session surface", tags: ["v2", "auth"], querySchema: { debugSlowDeferredMs: "number (0-2000) optional" } },
  {
    method: "POST",
    path: "/v2/analytics/events",
    description: "V2 analytics batch ingest surface",
    tags: ["v2", "analytics"],
    bodySchema: { events: "Array<analytics_event> required (1-250)" }
  },
  { method: "GET", path: "/v2/auth/check-handle", description: "V2 auth handle availability", tags: ["v2", "auth"], querySchema: { handle: "string (1-40) required" } },
  { method: "GET", path: "/v2/auth/check-user-exists", description: "V2 auth email existence check", tags: ["v2", "auth"], querySchema: { email: "email required" } },
  {
    method: "POST",
    path: "/v2/auth/login",
    description: "V2 auth email/password sign in",
    tags: ["v2", "auth"],
    bodySchema: { email: "email required", password: "string required", authIntent: "sign_in|sign_up optional", branchData: "object optional" }
  },
  {
    method: "POST",
    path: "/v2/auth/register",
    description: "V2 auth email/password sign up",
    tags: ["v2", "auth"],
    bodySchema: { email: "email required", password: "string (>=6) required", displayName: "string optional" }
  },
  {
    method: "POST",
    path: "/v2/auth/signin/google",
    description: "V2 auth Google sign in",
    tags: ["v2", "auth"],
    bodySchema: { accessToken: "string required", authIntent: "sign_in|sign_up optional", branchData: "object optional" }
  },
  {
    method: "POST",
    path: "/v2/auth/signin/apple",
    description: "V2 auth Apple sign in",
    tags: ["v2", "auth"],
    bodySchema: { identityToken: "string required", authorizationCode: "string optional", email: "email optional", fullName: "string|object optional" }
  },
  {
    method: "POST",
    path: "/v2/auth/profile",
    description: "V2 create/update onboarding profile",
    tags: ["v2", "auth"],
    bodySchema: {
      userId: "string required",
      name: "string required",
      age: "number required",
      handle: "string optional",
      expoPushToken: "ExponentPushToken[...] optional",
      pushToken: "string optional",
      pushTokenPlatform: "ios|android optional"
    }
  },
  {
    method: "POST",
    path: "/v2/auth/push-token",
    description: "V2 register device Expo/FCM push token for the signed-in viewer (exclusive per device token)",
    tags: ["v2", "auth", "notifications"],
    bodySchema: {
      expoPushToken: "ExponentPushToken[...] optional",
      pushToken: "string optional (defaults to expoPushToken)",
      pushTokenPlatform: "ios|android optional"
    }
  },
  {
    method: "POST",
    path: "/v2/auth/profile/branch",
    description: "V2 merge branch/deferred deep-link payload",
    tags: ["v2", "auth"],
    bodySchema: { branchData: "object required" }
  },
  {
    method: "POST",
    path: "/v2/invites/resolve",
    description: "Resolve Branch invite payload into inviter/group metadata",
    tags: ["v2", "invites"],
    bodySchema: { branchData: "object required" }
  },
  { method: "GET", path: "/v2/bootstrap", description: "V2 bootstrap surface", tags: ["v2", "bootstrap"], querySchema: { debugSlowDeferredMs: "number (0-2000) optional" } },
  { method: "GET", path: "/v2/feed/bootstrap", description: "V2 home/feed bootstrap surface", tags: ["v2", "home", "feed"], querySchema: { limit: "number (4-8) optional", debugSlowDeferredMs: "number (0-2000) optional" } },
  { method: "GET", path: "/v2/feed/for-you", description: "V2 For You feed (queue-based reel-first)", tags: ["v2", "home", "feed"], querySchema: { limit: "number (1-20) optional", cursor: "string optional", debug: "0|1 optional" } },
  { method: "GET", path: "/v2/feed/page", description: "V2 home/feed continuation page surface", tags: ["v2", "home", "feed"], querySchema: { cursor: "string optional", limit: "number (4-8) optional" } },
  { method: "GET", path: "/v2/feed/items/:postId/detail", description: "V2 home/feed item detail hydration surface", tags: ["v2", "home", "feed", "post"], querySchema: { debugSlowDeferredMs: "number (0-2000) optional" } },
  { method: "GET", path: "/v2/profiles/:userId/bootstrap", description: "V2 profile bootstrap surface", tags: ["v2", "profile"], querySchema: { gridLimit: "number (6-18) optional", debugSlowDeferredMs: "number (0-2000) optional" } },
  { method: "GET", path: "/v2/profiles/:userId/grid", description: "V2 profile grid pagination surface", tags: ["v2", "profile"], querySchema: { cursor: "string optional", limit: "number (6-24) optional" } },
  { method: "GET", path: "/v2/profiles/:userId/posts/:postId/detail", description: "V2 profile post detail hydration surface", tags: ["v2", "profile", "post"], querySchema: { debugSlowDeferredMs: "number (0-2000) optional" } },
  {
    method: "GET",
    path: "/v2/social/batch",
    description: "V2 batched post social counts + viewer like/save flags (compat with legacy social batch)",
    tags: ["v2", "social", "post"],
    querySchema: { postIds: "string|string[] repeated optional" }
  },
  { method: "GET", path: "/v2/search/results", description: "V2 search committed results surface", tags: ["v2", "search"], querySchema: { q: "string (2-80) required", cursor: "string optional", limit: "number (4-12) optional" } },
  { method: "GET", path: "/v2/search/users", description: "V2 search users/profiles results surface", tags: ["v2", "search", "users"], querySchema: { q: "string (1-80) required", cursor: "string optional", limit: "number (5-12) optional" } },
  { method: "GET", path: "/v2/search/suggest", description: "V2 search typing suggestions (users/activities/locations/sentences)", tags: ["v2", "search"], querySchema: { q: "string (1-80) required" } },
  { method: "GET", path: "/v2/search/bootstrap", description: "V2 search idle bootstrap rails and previews", tags: ["v2", "search"], querySchema: { q: "string (0-80) optional", limit: "number (1-80) optional" } },
  { method: "GET", path: "/v2/search/home-bootstrap", description: "Search home v1 bootstrap (suggested users + 8 activity mix previews)", tags: ["v2", "search", "home"], querySchema: { includeDebug: "0|1 optional", bypassCache: "0|1 optional" } },
  { method: "GET", path: "/v2/search/mixes/:activityKey/page", description: "Cursor page for activity mix posts (search home deep link)", tags: ["v2", "search", "mixes"], querySchema: { cursor: "string optional", limit: "number optional", includeDebug: "0|1 optional" } },
  { method: "GET", path: "/v2/search/mixes/bootstrap", description: "V2 search mixes bootstrap (mix shelves)", tags: ["v2", "search", "mixes"], querySchema: { lat: "number optional", lng: "number optional", limit: "number (1-24) optional", includeDebug: "0|1 optional" } },
  { method: "POST", path: "/v2/search/mixes/feed", description: "V2 search mixes feed page", tags: ["v2", "search", "mixes"], bodySchema: { mixId: "string required", cursor: "string|null optional", limit: "number (4-36) optional", lat: "number|null optional", lng: "number|null optional", includeDebug: "boolean optional" } },
  {
    method: "GET",
    path: "/v2/social/suggested-friends",
    description: "V2 reusable suggested friends surface",
    tags: ["v2", "social"],
    querySchema: { limit: "number (1-50) optional", surface: "onboarding|profile|search|home|notifications|generic optional" }
  },
  {
    method: "POST",
    path: "/v2/social/contacts/sync",
    description: "V2 contact sync + contact-matched users",
    tags: ["v2", "social", "mutation"],
    bodySchema: { contacts: "Array<{name?: string, phoneNumbers?: string[], emails?: string[]}> required" }
  },
  {
    method: "GET",
    path: "/v2/users/suggested",
    description: "V2 suggested users feed (mutuals/contacts/groups/referrals/popular/fallback)",
    tags: ["v2", "users", "social"],
    querySchema: {
      limit: "number (1-50) optional",
      cursor: "string optional",
      surface: "onboarding|profile|search|home|notifications|generic optional",
      includeDebug: "0|1 optional"
    }
  },
  { method: "GET", path: "/v2/posts/:postId/detail", description: "V2 canonical post detail hydration", tags: ["v2", "post"] },
  {
    method: "POST",
    path: "/v2/posts/stage",
    description: "V2 canonical post staging record",
    tags: ["v2", "post", "mutation"],
    bodySchema: {
      clientMutationId: "string (8-128) required",
      assets: "Array<{assetIndex:number,assetType:photo|video}> required"
    }
  },
  {
    method: "POST",
    path: "/v2/posts/media/sign-upload",
    description: "V2 post media upload signing",
    tags: ["v2", "post", "upload", "mutation"],
    bodySchema: { stageId: "string required", items: "Array<{assetIndex:number,assetType:photo|video}> required" }
  },
  {
    method: "POST",
    path: "/v2/posts/media/complete",
    description: "V2 post media upload completion/validation",
    tags: ["v2", "post", "upload", "mutation"],
    bodySchema: { stageId: "string required", items: "Array<{assetIndex:number,assetType:photo|video}> required" }
  },
  {
    method: "POST",
    path: "/v2/posts/publish",
    description: "V2 canonical publish mutation",
    tags: ["v2", "post", "mutation"],
    bodySchema: {
      stageId: "string required",
      clientMutationId: "string (8-128) required"
    }
  },
  { method: "GET", path: "/v2/posts/:postId/card", description: "V2 canonical post card hydration", tags: ["v2", "post"] },
  {
    method: "POST",
    path: "/v2/posts/details:batch",
    description: "V2 canonical post detail batch hydration",
    tags: ["v2", "post"],
    bodySchema: { postIds: "string[] (1-15) required", reason: "prefetch|open|surface_bootstrap required" }
  },
  { method: "POST", path: "/v2/posts/:postId/like", description: "V2 post like mutation", tags: ["v2", "mutation", "post"] },
  { method: "POST", path: "/v2/posts/:postId/unlike", description: "V2 post unlike mutation", tags: ["v2", "mutation", "post"] },
  { method: "GET", path: "/v2/posts/:postId/likes", description: "V2 post likes list", tags: ["v2", "surface", "post"] },
  { method: "POST", path: "/v2/users/:userId/follow", description: "V2 user follow mutation", tags: ["v2", "mutation", "user"] },
  { method: "POST", path: "/v2/users/:userId/unfollow", description: "V2 user unfollow mutation", tags: ["v2", "mutation", "user"] },
  {
    method: "GET",
    path: "/v2/users/:userId/last-active",
    description: "V2 user last-active timestamp (for chat header presence)",
    tags: ["v2", "users", "chats"]
  },
  {
    method: "GET",
    path: "/v2/groups",
    description: "V2 groups directory/list surface",
    tags: ["v2", "groups"],
    querySchema: { limit: "number (1-80) optional", q: "string (0-80) optional" }
  },
  {
    method: "POST",
    path: "/v2/groups",
    description: "V2 create group mutation",
    tags: ["v2", "groups", "mutation"],
    bodySchema: { name: "string required", bio: "string optional", photoUrl: "url|null optional", college: "{enabled:boolean,eduEmailDomain:string}|null optional" }
  },
  { method: "GET", path: "/v2/groups/:groupId", description: "V2 group detail surface", tags: ["v2", "groups"] },
  {
    method: "PATCH",
    path: "/v2/groups/:groupId",
    description: "V2 update group mutation",
    tags: ["v2", "groups", "mutation"],
    bodySchema: { name: "string optional", bio: "string optional", photoUrl: "url|null optional", joinMode: "open|private optional", isPublic: "boolean optional", college: "{enabled:boolean,eduEmailDomain:string}|null optional" }
  },
  { method: "POST", path: "/v2/groups/:groupId/join", description: "V2 join group mutation", tags: ["v2", "groups", "mutation"] },
  {
    method: "POST",
    path: "/v2/groups/:groupId/verify-college",
    description: "V2 verify college email and join group",
    tags: ["v2", "groups", "mutation"],
    bodySchema: { email: "email required", method: "email_entry|google optional" }
  },
  {
    method: "POST",
    path: "/v2/groups/:groupId/members",
    description: "V2 add group member mutation",
    tags: ["v2", "groups", "mutation"],
    bodySchema: { memberId: "string required" }
  },
  {
    method: "POST",
    path: "/v2/groups/:groupId/invitations",
    description: "V2 create group invitations mutation",
    tags: ["v2", "groups", "mutation"],
    bodySchema: { memberIds: "string[] required" }
  },
  { method: "DELETE", path: "/v2/groups/:groupId/members/:memberId", description: "V2 remove group member mutation", tags: ["v2", "groups", "mutation"] },
  { method: "GET", path: "/v2/groups/:groupId/share-link", description: "V2 ensure group Branch share link", tags: ["v2", "groups"] },
  {
    method: "POST",
    path: "/v2/posting/upload-session",
    description: "V2 posting/upload session creation",
    tags: ["v2", "posting", "upload", "mutation"],
    bodySchema: { clientSessionKey: "string (8-128) required", mediaCountHint: "number (1-20) optional" }
  },
  {
    method: "POST",
    path: "/v2/posting/finalize",
    description: "V2 posting finalize mutation from upload session",
    tags: ["v2", "posting", "upload", "mutation"],
    bodySchema: {
      sessionId: "string required",
      idempotencyKey: "string (8-128) required",
      mediaCount: "number (1-20) optional"
    }
  },
  {
    method: "GET",
    path: "/v2/posting/operations/:operationId",
    description: "V2 posting operation reconcile/status surface",
    tags: ["v2", "posting", "upload", "status"]
  },
  {
    method: "POST",
    path: "/v2/posting/operations/:operationId/cancel",
    description: "V2 posting operation cancel mutation",
    tags: ["v2", "posting", "upload", "mutation"]
  },
  {
    method: "POST",
    path: "/v2/posting/operations/:operationId/retry",
    description: "V2 posting operation retry mutation",
    tags: ["v2", "posting", "upload", "mutation"]
  },
  {
    method: "POST",
    path: "/v2/posting/media/register",
    description: "V2 posting media registration/session binding",
    tags: ["v2", "posting", "upload", "media", "mutation"],
    bodySchema: {
      sessionId: "string required",
      assetIndex: "number (0-79) required",
      assetType: "photo|video required",
      clientMediaKey: "string (8-128) optional"
    }
  },
  {
    method: "GET",
    path: "/v2/posting/location/suggest",
    description: "V2 posting location setter places-only autofill (GeoNames-backed)",
    tags: ["v2", "posting", "location"],
    querySchema: { q: "string (1-80) required", limit: "number (1-12) optional" }
  },
  {
    method: "POST",
    path: "/v2/posting/media/:mediaId/mark-uploaded",
    description: "V2 posting media mark-uploaded mutation",
    tags: ["v2", "posting", "upload", "media", "mutation"],
    bodySchema: { uploadedObjectKey: "string optional" }
  },
  {
    method: "GET",
    path: "/v2/posting/media/:mediaId/status",
    description: "V2 posting media status/readiness surface",
    tags: ["v2", "posting", "upload", "media", "status"]
  },
  {
    method: "GET",
    path: "/v2/posts/:postId/comments",
    description: "V2 comments list (top-level only) pagination surface",
    tags: ["v2", "comments"],
    querySchema: { cursor: "string optional", limit: "number (5-20) optional" }
  },
  {
    method: "POST",
    path: "/v2/posts/:postId/comments",
    description: "V2 create top-level comment mutation",
    tags: ["v2", "comments", "mutation"],
    bodySchema: {
      text: "string (0-400) optional when gif present",
      gif: "{provider:giphy,gifId,previewUrl,...} optional when text present",
      clientMutationKey: "string (8-128) optional"
    }
  },
  {
    method: "POST",
    path: "/v2/comments/:commentId/like",
    description: "V2 like comment mutation",
    tags: ["v2", "comments", "mutation"]
  },
  {
    method: "DELETE",
    path: "/v2/comments/:commentId",
    description: "V2 delete comment mutation",
    tags: ["v2", "comments", "mutation"]
  },
  {
    method: "GET",
    path: "/v2/notifications",
    description: "V2 notifications page surface",
    tags: ["v2", "notifications"],
    querySchema: { cursor: "string optional", limit: "number (10-20) optional" }
  },
  {
    method: "POST",
    path: "/v2/notifications/mark-read",
    description: "V2 mark selected notifications as read",
    tags: ["v2", "notifications", "mutation"],
    bodySchema: { notificationIds: "string[] (1-20) required" }
  },
  {
    method: "POST",
    path: "/v2/notifications/mark-all-read",
    description: "V2 mark all notifications as read",
    tags: ["v2", "notifications", "mutation"]
  },
  {
    method: "GET",
    path: "/v2/chats/inbox",
    description: "V2 chats inbox page surface",
    tags: ["v2", "chats"],
    querySchema: { cursor: "string optional", limit: "number (10-20) optional" }
  },
  {
    method: "GET",
    path: "/v2/chats/:conversationId",
    description: "V2 chat conversation detail surface",
    tags: ["v2", "chats"]
  },
  {
    method: "GET",
    path: "/v2/chats/:conversationId/messages",
    description: "V2 chat thread messages page surface",
    tags: ["v2", "chats"],
    querySchema: { cursor: "string optional", limit: "number (10-50) optional" }
  },
  {
    method: "POST",
    path: "/v2/chats/:conversationId/messages",
    description: "V2 send chat message (text, photo, gif, or shared post)",
    tags: ["v2", "chats", "mutation"],
    bodySchema: {
      messageType: "text|photo|gif|post",
      text: "string optional (required for text; caption for post)",
      postId: "string required when messageType=post",
      photoUrl: "url when photo",
      gifUrl: "url when gif",
      clientMessageId: "string (8-128) optional"
    }
  },
  {
    method: "POST",
    path: "/v2/chats/:conversationId/mark-read",
    description: "V2 mark conversation as read",
    tags: ["v2", "chats", "mutation"]
  },
  {
    method: "POST",
    path: "/v2/chats/:conversationId/mark-unread",
    description: "V2 mark conversation as unread",
    tags: ["v2", "chats", "mutation"]
  },
  {
    method: "POST",
    path: "/v2/chats/create-or-get",
    description: "V2 create or get direct chat",
    tags: ["v2", "chats", "mutation"],
    bodySchema: { otherUserId: "string required" }
  },
  {
    method: "POST",
    path: "/v2/chats/create-group",
    description: "V2 create group chat",
    tags: ["v2", "chats", "mutation"],
    bodySchema: {
      participants: "string[] (2-11) required",
      groupName: "string (1-80) required",
      displayPhotoURL: "url optional"
    }
  },
  {
    method: "POST",
    path: "/v2/chats/group-avatar-upload",
    description: "V2 upload temporary group avatar before chat creation",
    tags: ["v2", "chats", "mutation", "upload"]
  },
  {
    method: "POST",
    path: "/v2/chats/:conversationId/group-photo",
    description: "V2 upload and persist group chat photo",
    tags: ["v2", "chats", "mutation", "upload"]
  },
  {
    method: "DELETE",
    path: "/v2/chats/:conversationId",
    description: "V2 delete conversation",
    tags: ["v2", "chats", "mutation"]
  },
  {
    method: "PUT",
    path: "/v2/chats/:conversationId/typing-status",
    description: "V2 update typing status",
    tags: ["v2", "chats", "mutation"],
    bodySchema: { isTyping: "boolean required" }
  },
  {
    method: "DELETE",
    path: "/v2/chats/:conversationId/messages/:messageId",
    description: "V2 delete chat message",
    tags: ["v2", "chats", "mutation"]
  },
  {
    method: "POST",
    path: "/v2/chats/:conversationId/update-group",
    description: "V2 update group chat name and/or photo",
    tags: ["v2", "chats", "mutation"],
    bodySchema: {
      groupName: "string (1-80) optional",
      displayPhotoURL: "url|null optional",
      participants: "string[] (2-12) optional"
    }
  },
  { method: "GET", path: "/v2/achievements/hero", description: "V2 achievements hero read surface", tags: ["v2", "achievements"] },
  {
    method: "GET",
    path: "/v2/achievements/snapshot",
    description: "V2 achievements snapshot read surface",
    tags: ["v2", "achievements"]
  },
  {
    method: "GET",
    path: "/v2/achievements/bootstrap",
    description: "V2 achievements bootstrap aggregate surface",
    tags: ["v2", "achievements"]
  },
  {
    method: "GET",
    path: "/v2/achievements/pending-delta",
    description: "V2 achievements pending-delta parity read surface",
    tags: ["v2", "achievements"]
  },
  {
    method: "GET",
    path: "/v2/achievements/status",
    description: "V2 achievements canonical status read surface",
    tags: ["v2", "achievements"],
    querySchema: { lat: "string optional", long: "string optional" }
  },
  {
    method: "GET",
    path: "/v2/achievements/badges",
    description: "V2 achievements canonical badge list read surface",
    tags: ["v2", "achievements"]
  },
  {
    method: "GET",
    path: "/v2/achievements/claimables",
    description: "V2 achievements claimable rewards read surface",
    tags: ["v2", "achievements"]
  },
  {
    method: "POST",
    path: "/v2/achievements/screen-opened",
    description: "V2 achievements screen-opened analytics rail",
    tags: ["v2", "achievements"]
  },
  { method: "GET", path: "/v2/achievements/leagues", description: "V2 achievements leagues catalog", tags: ["v2", "achievements"] },
  {
    method: "GET",
    path: "/v2/achievements/leaderboard/:scope",
    description: "V2 achievements leaderboard read surface",
    tags: ["v2", "achievements"],
    querySchema: { leagueId: "string optional (xp_league)" }
  },
  {
    method: "GET",
    path: "/v2/achievements/leaderboard/:leaderboardKey/viewer-rank",
    description: "V2 achievements viewer-rank read surface",
    tags: ["v2", "achievements"],
    querySchema: { leagueId: "string optional (xp_league)" }
  },
  {
    method: "POST",
    path: "/v2/achievements/ack-leaderboard-event",
    description: "V2 achievements leaderboard event acknowledgement",
    tags: ["v2", "achievements"]
  },
  {
    method: "POST",
    path: "/v2/achievements/claim-weekly-capture",
    description: "V2 achievements weekly capture claim",
    tags: ["v2", "achievements"]
  },
  {
    method: "POST",
    path: "/v2/achievements/claim",
    description: "V2 achievements generic claim mutation",
    tags: ["v2", "achievements"],
    bodySchema: { kind: "weekly_capture|badge|challenge required", id: "string required" }
  },
  { method: "POST", path: "/v2/achievements/claim-badge", description: "V2 achievements badge claim", tags: ["v2", "achievements"] },
  {
    method: "POST",
    path: "/v2/achievements/claim-challenge",
    description: "V2 achievements challenge claim",
    tags: ["v2", "achievements"]
  },
  {
    method: "POST",
    path: "/v2/achievements/claim-intro-bonus",
    description: "V2 achievements onboarding intro bonus claim",
    tags: ["v2", "achievements"]
  },
  {
    method: "GET",
    path: "/v2/map/bootstrap",
    description: "V2 map marker-index bootstrap read surface",
    tags: ["v2", "map"],
    querySchema: { bbox: "string minLng,minLat,maxLng,maxLat required", limit: "number (20-300) optional" }
  },
  {
    method: "GET",
    path: "/v2/map/markers",
    description: "V2 map lightweight marker dataset",
    tags: ["v2", "map"]
  },
  {
    method: "GET",
    path: "/v2/collections",
    description: "V2 viewer collection list",
    tags: ["v2", "collections"],
    querySchema: { limit: "number (1-50) optional" }
  },
  {
    method: "GET",
    path: "/v2/collections/:collectionId",
    description: "V2 collection detail",
    tags: ["v2", "collections"]
  },
  {
    method: "GET",
    path: "/v2/collections/:collectionId/posts",
    description: "V2 collection posts (paged ids + hydrated cards)",
    tags: ["v2", "collections"],
    querySchema: { cursor: "string optional", limit: "number (1-20) optional" }
  },
  {
    method: "POST",
    path: "/v2/collections",
    description: "V2 create collection",
    tags: ["v2", "collections", "mutation"]
  },
  { method: "PATCH", path: "/v2/collections/:collectionId", description: "V2 edit collection", tags: ["v2", "collections", "mutation"] },
  { method: "DELETE", path: "/v2/collections/:collectionId", description: "V2 delete collection", tags: ["v2", "collections", "mutation"] },
  { method: "POST", path: "/v2/collections/:collectionId/posts", description: "V2 add post to collection", tags: ["v2", "collections", "mutation"] },
  {
    method: "DELETE",
    path: "/v2/collections/:collectionId/posts/:postId",
    description: "V2 remove post from collection",
    tags: ["v2", "collections", "mutation"]
  },
  { method: "GET", path: "/v2/posts/:postId/save-state", description: "V2 post save-state", tags: ["v2", "collections"] },
  { method: "POST", path: "/v2/posts/:postId/save", description: "V2 post save mutation", tags: ["v2", "collections", "mutation"] },
  { method: "POST", path: "/v2/posts/:postId/unsave", description: "V2 post unsave mutation", tags: ["v2", "collections", "mutation"] },
  {
    method: "GET",
    path: "/v2/collections/save-sheet",
    description: "V2 save sheet hydration",
    tags: ["v2", "collections"],
    querySchema: { postId: "string required" }
  },
  { method: "GET", path: "/admin", description: "Internal dashboard", tags: ["admin"] },
  {
    method: "POST",
    path: "/internal/ops/backfill/user-search-fields",
    description: "Bearer-token maintenance: backfill searchHandle/searchName on user docs (requires INTERNAL_OPS_TOKEN)",
    tags: ["internal", "ops", "firestore"],
    bodySchema: {
      dryRun: "boolean optional",
      limit: "positive integer optional",
      startAfterDocId: "string optional",
      progressEvery: "integer optional",
      pageSize: "integer (1-500) optional",
      batchSize: "integer (1-500) optional"
    }
  },
  { method: "GET", path: "/debug/local/auth/session", description: "Dev-only local harness auth session probe", tags: ["debug", "local", "dev"] },
  {
    method: "GET",
    path: "/debug/local/profile/bootstrap",
    description: "Dev-only local harness self-profile probe",
    tags: ["debug", "local", "dev"]
  },
  { method: "GET", path: "/debug/local/chats/inbox", description: "Dev-only local harness chats inbox probe", tags: ["debug", "local", "dev"] },
  {
    method: "GET",
    path: "/debug/local/feed/bootstrap",
    description: "Dev-only local harness feed bootstrap probe",
    tags: ["debug", "local", "dev"]
  },
  {
    method: "GET",
    path: "/debug/local/rails/legacy-usage",
    description: "Dev-only local harness legacy rails inventory",
    tags: ["debug", "local", "dev"]
  },
  { method: "GET", path: "/openapi.json", description: "OpenAPI-like contract output", tags: ["contract"] }
];
