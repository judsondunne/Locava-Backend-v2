import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createApp } from "../src/app/createApp.js";
import { diagnosticsStore } from "../src/observability/diagnostics-store.js";
import { getRoutePolicy } from "../src/observability/route-policies.js";

type Classification =
  | "PASS"
  | "PASS_WITH_INTENTIONAL_LEGACY_PROXY"
  | "PASS_WITH_STAGED_HYDRATION"
  | "BROKEN_CONTRACT"
  | "BROKEN_NATIVE_INTEGRATION"
  | "BROKEN_SOURCE_OF_TRUTH"
  | "BROKEN_FAKE_FALLBACK"
  | "BROKEN_TIMEOUT"
  | "BROKEN_LATENCY_BUDGET"
  | "BROKEN_PAYLOAD_BUDGET"
  | "BROKEN_READ_BUDGET"
  | "BROKEN_CACHE_INVALIDATION"
  | "BROKEN_PAGINATION"
  | "MISSING_TEST"
  | "MISSING_ROUTE"
  | "MISSING_NATIVE_WIRING";

type Envelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: unknown };
  meta?: { requestId?: string; latencyMs?: number; db?: { reads?: number; writes?: number; queries?: number } };
};

type AuditState = {
  viewerId: string;
  targetUserId: string | null;
  samplePostId: string | null;
  sampleCommentPostId: string | null;
  auditCommentPostId: string | null;
  sampleCollectionId: string | null;
  tempCollectionId: string | null;
  sampleConversationId: string | null;
  sampleCommentId: string | null;
  sampleMessageId: string | null;
  sampleNotificationId: string | null;
  sampleUnreadNotificationId: string | null;
  uploadSessionId: string | null;
  mediaId: string | null;
  operationId: string | null;
  tempConversationId: string | null;
};

type AuditSpec = {
  id: string;
  route: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  nativeSurface: string;
  nativeRef: string;
  expectations?: {
    pagination?: boolean;
    intentionalLegacyProxy?: boolean;
    stagedHydration?: boolean;
  };
  buildPath: (state: AuditState) => string | null;
  buildBody?: (state: AuditState) => unknown;
  afterSuccess?: (state: AuditState, envelope: Envelope) => void;
};

type AuditRow = {
  id: string;
  nativeSurface: string;
  nativeRef: string;
  method: string;
  path: string | null;
  routeName: string | null;
  statusCode: number | null;
  classification: Classification;
  latencyMs: number | null;
  budgetMs: number | null;
  payloadBytes: number | null;
  budgetBytes: number | null;
  firestoreReads: number | null;
  firestoreQueries: number | null;
  readBudget: number | null;
  cacheStatus: "hit" | "miss" | "revalidated_304" | "unknown";
  pagination: "cursor" | "missing" | "not_applicable";
  errorCode: string | null;
  errorMessage: string | null;
  budgetViolations: string[];
  fallbacks: string[];
  timeouts: string[];
  surfaceTimings: Record<string, number>;
  notes: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const reportPath = path.join(repoRoot, "tmp", "full-app-v2-audit-report.json");
const auditDocPath = path.join(workspaceRoot, "docs", "full-app-backendv2-system-audit-2026-04-25.md");
const only = (() => {
  const idx = process.argv.indexOf("--only");
  return idx >= 0 ? String(process.argv[idx + 1] ?? "").trim() : "";
})();
const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";

function getAuditFirestore() {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim())
    : path.resolve(workspaceRoot, "Locava Backend", ".secrets", "learn-32d72-13d7a236a08e.json");
  const credential = JSON.parse(fs.readFileSync(credentialPath, "utf8")) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  const app = initializeApp({
    credential: cert(credential),
    projectId: credential.project_id
  });
  return getFirestore(app);
}

async function ensureCommentAuditFixturePost(viewerIdToUse: string): Promise<string> {
  const fixtureId = process.env.LOCAVA_AUDIT_COMMENT_POST_ID?.trim() || `audit-v2-comment-target-${viewerIdToUse}`;
  const db = getAuditFirestore();
  const now = Date.now();
  await db.collection("posts").doc(fixtureId).set(
    {
      id: fixtureId,
      userId: viewerIdToUse,
      caption: "Backendv2 audit comment fixture",
      description: "Backendv2 audit comment fixture",
      mediaType: "image",
      displayPhotoLink: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80&auto=format&fit=crop",
      thumbUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400&q=80&auto=format&fit=crop",
      photoLink: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80&auto=format&fit=crop",
      assetsReady: true,
      isPublic: false,
      comments: [],
      commentCount: 0,
      commentsCount: 0,
      likedBy: [],
      time: Timestamp.fromMillis(now),
      lastUpdated: Timestamp.fromMillis(now),
      updatedAtMs: now,
      createdAtMs: now
    },
    { merge: true }
  );
  return fixtureId;
}

async function findExistingCommentAuditPost(viewerIdToUse: string): Promise<string | null> {
  const db = getAuditFirestore();
  const snap = await db.collection("posts").where("userId", "==", viewerIdToUse).orderBy("time", "desc").limit(20).get();
  const candidates = snap.docs
    .map((doc) => ({
      id: doc.id,
      showComments: doc.get("showComments"),
    }))
    .filter((row) => row.id && !row.id.startsWith("audit-v2-comment-target-") && row.showComments !== false)
  return candidates[0]?.id ?? null;
}

async function cleanupCommentAuditFixturePost(fixtureId: string | null): Promise<void> {
  if (!fixtureId) return;
  if (process.env.LOCAVA_AUDIT_COMMENT_POST_ID?.trim()) return;
  const db = getAuditFirestore();
  await db.collection("posts").doc(fixtureId).delete();
}

function readJson(payload: string): Envelope | null {
  try {
    return JSON.parse(payload) as Envelope;
  } catch {
    return null;
  }
}

function findDiagnostic(requestId: string | undefined) {
  if (!requestId) return null;
  return diagnosticsStore.getRecentRequests(200).find((row) => row.requestId === requestId) ?? null;
}

function detectCacheStatus(envelope: Envelope, diagnostic: ReturnType<typeof findDiagnostic>): AuditRow["cacheStatus"] {
  const diagnostics = envelope.data?.diagnostics as Record<string, unknown> | undefined;
  const cacheSource = diagnostics?.cacheSource;
  if (cacheSource === "hit" || cacheSource === "miss" || cacheSource === "revalidated_304") return cacheSource;
  if ((diagnostic?.cache.hits ?? 0) > 0) return "hit";
  if ((diagnostic?.cache.misses ?? 0) > 0) return "miss";
  return "unknown";
}

function detectPagination(envelope: Envelope): AuditRow["pagination"] {
  const page = envelope.data?.page as Record<string, unknown> | undefined;
  if (!page) return "not_applicable";
  if ("nextCursor" in page || "cursorIn" in page) return "cursor";
  return "missing";
}

function collectLeafStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLeafStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectLeafStrings(nested, out);
  }
  return out;
}

function detectFakeFallback(envelope: Envelope, diagnostic: ReturnType<typeof findDiagnostic>): boolean {
  const tokens = ["fake", "stub", "demo", "placeholder", "synthetic", "mock"];
  const fallbackLabels = [...(diagnostic?.fallbacks ?? []), ...(((envelope.data?.fallbacks as unknown[]) ?? []).map((value) => String(value)))];
  if (fallbackLabels.some((value) => tokens.some((token) => value.toLowerCase().includes(token)))) return true;
  const leafStrings = collectLeafStrings(envelope.data ?? {});
  return leafStrings.some((value) => tokens.some((token) => value.toLowerCase().includes(token)));
}

function classify(spec: AuditSpec, envelope: Envelope | null, diagnostic: ReturnType<typeof findDiagnostic>): Classification {
  if (!envelope || typeof envelope.ok !== "boolean") return "BROKEN_CONTRACT";
  if (envelope.ok !== true) {
    const code = String(envelope.error?.code ?? "");
    if (code === "route_not_found") return "MISSING_ROUTE";
    if (code === "source_of_truth_required") return "BROKEN_SOURCE_OF_TRUTH";
    if (code === "timeout") return "BROKEN_TIMEOUT";
    if (code === "validation_error" || code === "invalid_json" || code === "invalid_envelope") return "BROKEN_CONTRACT";
    return "BROKEN_CONTRACT";
  }
  if (detectFakeFallback(envelope, diagnostic)) return "BROKEN_FAKE_FALLBACK";
  if (diagnostic?.budgetViolations.includes("latency_p95_exceeded")) return "BROKEN_LATENCY_BUDGET";
  if (diagnostic?.budgetViolations.includes("payload_bytes_exceeded")) return "BROKEN_PAYLOAD_BUDGET";
  if (diagnostic?.budgetViolations.includes("db_reads_exceeded") || diagnostic?.budgetViolations.includes("db_queries_exceeded")) {
    return "BROKEN_READ_BUDGET";
  }
  if (spec.expectations?.pagination && detectPagination(envelope) !== "cursor") return "BROKEN_PAGINATION";
  if (spec.expectations?.intentionalLegacyProxy) return "PASS_WITH_INTENTIONAL_LEGACY_PROXY";
  if (spec.expectations?.stagedHydration) return "PASS_WITH_STAGED_HYDRATION";
  return "PASS";
}

function note(row: AuditRow, message: string): void {
  row.notes.push(message);
}

function formatSurfaceTimingNote(surfaceTimings: Record<string, number> | undefined): string | null {
  if (!surfaceTimings) return null;
  const entries = Object.entries(surfaceTimings).filter(([, value]) => Number.isFinite(value));
  if (entries.length === 0) return null;
  return `Surface timings: ${entries
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}=${value}ms`)
    .join(", ")}`;
}

const specs: AuditSpec[] = [
  {
    id: "auth-session",
    route: "/v2/auth/session",
    method: "GET",
    nativeSurface: "Auth/session/bootstrap",
    nativeRef: "Locava-Native/src/auth/auth.api.ts",
    buildPath: () => "/v2/auth/session",
  },
  {
    id: "feed-bootstrap",
    route: "/v2/feed/bootstrap",
    method: "GET",
    nativeSurface: "Home feed bootstrap",
    nativeRef: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
    expectations: { stagedHydration: true },
    buildPath: () => "/v2/feed/bootstrap?limit=4",
    afterSuccess: (state, envelope) => {
      const firstRender = envelope.data?.firstRender as Record<string, unknown> | undefined;
      const feed = firstRender?.feed as Record<string, unknown> | undefined;
      const items = (feed?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const postId = String(items[0]?.postId ?? "");
      if (postId) state.samplePostId = postId;
    },
  },
  {
    id: "feed-page",
    route: "/v2/feed/page",
    method: "GET",
    nativeSurface: "Home feed pagination",
    nativeRef: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/feed/page?limit=4",
  },
  {
    id: "feed-item-detail",
    route: "/v2/feed/items/:postId/detail",
    method: "GET",
    nativeSurface: "Liftable/feed item hydration",
    nativeRef: "Locava-Native/src/features/home/backendv2/feedDetailV2.repository.ts",
    expectations: { stagedHydration: true },
    buildPath: (state) => (state.samplePostId ? `/v2/feed/items/${encodeURIComponent(state.samplePostId)}/detail` : null),
  },
  {
    id: "post-detail",
    route: "/v2/posts/:postId/detail",
    method: "GET",
    nativeSurface: "Post detail / liftable canonical detail",
    nativeRef: "Locava-Native/src/features/liftable/backendv2/postViewerDetailV2.repository.ts",
    expectations: { stagedHydration: true },
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/detail` : null),
  },
  {
    id: "profile-bootstrap",
    route: "/v2/profiles/:userId/bootstrap",
    method: "GET",
    nativeSurface: "Profile bootstrap",
    nativeRef: "Locava-Native/src/features/profile/backendv2/profileV2.repository.ts",
    expectations: { stagedHydration: true },
    buildPath: (state) => `/v2/profiles/${encodeURIComponent(state.viewerId)}/bootstrap`,
  },
  {
    id: "profile-grid",
    route: "/v2/profiles/:userId/grid",
    method: "GET",
    nativeSurface: "Profile grid",
    nativeRef: "Locava-Native/src/features/profile/backendv2/profileV2.repository.ts",
    expectations: { pagination: true },
    buildPath: (state) => `/v2/profiles/${encodeURIComponent(state.viewerId)}/grid?limit=12`,
    afterSuccess: (state, envelope) => {
      const items = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const postId = items
        .map((item) => String(item.postId ?? ""))
        .find((id) => id.length > 0 && !id.startsWith("audit-v2-comment-target-"));
      if (postId && (!state.sampleCommentPostId || state.sampleCommentPostId.startsWith("audit-v2-comment-target-"))) {
        state.sampleCommentPostId = postId;
      }
    },
  },
  {
    id: "search-suggest",
    route: "/v2/search/suggest",
    method: "GET",
    nativeSurface: "Search autofill",
    nativeRef: "Locava-Native/src/features/search/useSearchAutofill.ts",
    buildPath: () => "/v2/search/suggest?q=hiking",
  },
  {
    id: "search-bootstrap",
    route: "/v2/search/bootstrap",
    method: "GET",
    nativeSurface: "Search bootstrap rails",
    nativeRef: "Locava-Native/src/features/search/useSearchBootstrapPosts.ts",
    buildPath: () => "/v2/search/bootstrap?q=hiking&limit=12",
  },
  {
    id: "search-results",
    route: "/v2/search/results",
    method: "GET",
    nativeSurface: "Search results posts/collections/places/mixes",
    nativeRef: "Locava-Native/src/features/search/backendv2/searchV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/search/results?q=hiking&limit=8&types=posts",
  },
  {
    id: "search-users",
    route: "/v2/search/users",
    method: "GET",
    nativeSurface: "Search users",
    nativeRef: "Locava-Native/src/features/search/backendv2/searchV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/search/users?q=jo&limit=8",
    afterSuccess: (state, envelope) => {
      const users = (envelope.data?.users as Array<Record<string, unknown>> | undefined) ?? [];
      const targetUserId = users.map((row) => String(row.userId ?? "")).find((id) => id && id !== state.viewerId) ?? null;
      if (targetUserId) state.targetUserId = targetUserId;
    },
  },
  {
    id: "users-follow",
    route: "/v2/users/:userId/follow",
    method: "POST",
    nativeSurface: "Follow user",
    nativeRef: "Locava-Native/src/data/repos/connectionsRepo.ts",
    buildPath: (state) => (state.targetUserId ? `/v2/users/${encodeURIComponent(state.targetUserId)}/follow` : null),
    buildBody: () => ({}),
  },
  {
    id: "users-unfollow",
    route: "/v2/users/:userId/unfollow",
    method: "POST",
    nativeSurface: "Unfollow user",
    nativeRef: "Locava-Native/src/data/repos/connectionsRepo.ts",
    buildPath: (state) => (state.targetUserId ? `/v2/users/${encodeURIComponent(state.targetUserId)}/unfollow` : null),
    buildBody: () => ({}),
  },
  {
    id: "social-suggested-friends",
    route: "/v2/social/suggested-friends",
    method: "GET",
    nativeSurface: "Suggested friends / contacts",
    nativeRef: "Locava-Native/src/features/findFriends/backendv2/directoryV2.repository.ts",
    buildPath: () => "/v2/social/suggested-friends?surface=onboarding&limit=8",
    afterSuccess: (state, envelope) => {
      const users = (envelope.data?.users as Array<Record<string, unknown>> | undefined) ?? [];
      const targetUserId = users.map((row) => String(row.userId ?? "")).find((id) => id && id !== state.viewerId) ?? null;
      if (targetUserId) state.targetUserId = targetUserId;
    },
  },
  {
    id: "directory-users",
    route: "/v2/directory/users",
    method: "GET",
    nativeSurface: "Find friends directory",
    nativeRef: "Locava-Native/src/features/findFriends/backendv2/directoryV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/directory/users?limit=10",
  },
  {
    id: "map-bootstrap",
    route: "/v2/map/bootstrap",
    method: "GET",
    nativeSurface: "Map bootstrap",
    nativeRef: "Locava-Native/src/features/map/backendv2/mapV2.repository.ts",
    expectations: { stagedHydration: true },
    buildPath: () => "/v2/map/bootstrap?bbox=-125,24,-66,49&limit=120",
  },
  {
    id: "map-markers",
    route: "/v2/map/markers",
    method: "GET",
    nativeSurface: "Map markers",
    nativeRef: "Locava-Native/src/features/map/backendv2/mapV2.repository.ts",
    buildPath: () => "/v2/map/markers?limit=60",
  },
  {
    id: "collections-list",
    route: "/v2/collections",
    method: "GET",
    nativeSurface: "Collections list",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionsV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/collections?limit=10",
    afterSuccess: (state, envelope) => {
      const items = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const collectionId = String(items[0]?.id ?? "");
      if (collectionId) state.sampleCollectionId = collectionId;
    },
  },
  {
    id: "collections-create",
    route: "/v2/collections",
    method: "POST",
    nativeSurface: "Create collection",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
    buildPath: () => "/v2/collections",
    buildBody: () => ({
      name: `Audit ${Date.now()}`,
      description: "full-app-v2-audit temporary collection",
      privacy: "private",
    }),
    afterSuccess: (state, envelope) => {
      const id = String(envelope.data?.collectionId ?? "");
      if (id) {
        state.tempCollectionId = id;
        state.sampleCollectionId = state.sampleCollectionId ?? id;
      }
    },
  },
  {
    id: "collections-detail",
    route: "/v2/collections/:collectionId",
    method: "GET",
    nativeSurface: "Collection detail",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionDisplayV2.repository.ts",
    buildPath: (state) => {
      const collectionId = state.sampleCollectionId ?? state.tempCollectionId;
      return collectionId ? `/v2/collections/${encodeURIComponent(collectionId)}` : null;
    },
  },
  {
    id: "collections-save-sheet",
    route: "/v2/collections/save-sheet",
    method: "GET",
    nativeSurface: "Save sheet",
    nativeRef: "Locava-Native/src/features/collections/CollectionsSheet.heavy.tsx",
    buildPath: (state) => (state.samplePostId ? `/v2/collections/save-sheet?postId=${encodeURIComponent(state.samplePostId)}` : null),
  },
  {
    id: "collections-posts",
    route: "/v2/collections/:collectionId/posts",
    method: "GET",
    nativeSurface: "Collection posts",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionDisplayV2.repository.ts",
    expectations: { pagination: true },
    buildPath: (state) => {
      const collectionId = state.sampleCollectionId ?? state.tempCollectionId;
      return collectionId ? `/v2/collections/${encodeURIComponent(collectionId)}/posts?limit=8` : null;
    },
  },
  {
    id: "collections-posts-add",
    route: "/v2/collections/:collectionId/posts",
    method: "POST",
    nativeSurface: "Add post to collection",
    nativeRef: "Locava-Native/src/sheets/data/viewerCollections.store.ts",
    buildPath: (state) =>
      state.tempCollectionId && state.samplePostId
        ? `/v2/collections/${encodeURIComponent(state.tempCollectionId)}/posts`
        : null,
    buildBody: (state) => ({ postId: state.samplePostId }),
  },
  {
    id: "collections-posts-remove",
    route: "/v2/collections/:collectionId/posts/:postId",
    method: "DELETE",
    nativeSurface: "Remove post from collection",
    nativeRef: "Locava-Native/src/sheets/data/viewerCollections.store.ts",
    buildPath: (state) =>
      state.tempCollectionId && state.samplePostId
        ? `/v2/collections/${encodeURIComponent(state.tempCollectionId)}/posts/${encodeURIComponent(state.samplePostId)}`
        : null,
  },
  {
    id: "collections-update",
    route: "/v2/collections/:collectionId",
    method: "PATCH",
    nativeSurface: "Edit collection",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
    buildPath: (state) => (state.tempCollectionId ? `/v2/collections/${encodeURIComponent(state.tempCollectionId)}` : null),
    buildBody: () => ({ name: `Audit Updated ${Date.now()}` }),
  },
  {
    id: "comments-list",
    route: "/v2/posts/:postId/comments",
    method: "GET",
    nativeSurface: "Comments list",
    nativeRef: "Locava-Native/src/features/comments/backendv2/commentsV2.repository.ts",
    expectations: { pagination: true },
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/comments?limit=8` : null),
  },
  {
    id: "comments-create",
    route: "/v2/posts/:postId/comments",
    method: "POST",
    nativeSurface: "Comment create",
    nativeRef: "Locava-Native/src/features/comments/backendv2/commentsV2.repository.ts",
    buildPath: (state) =>
      state.sampleCommentPostId ? `/v2/posts/${encodeURIComponent(state.sampleCommentPostId)}/comments` : null,
    buildBody: () => ({ text: `audit comment ${Date.now()}`, clientMutationKey: `audit-comment-${Date.now()}` }),
    afterSuccess: (state, envelope) => {
      const commentId = String((envelope.data?.comment as Record<string, unknown> | undefined)?.commentId ?? "");
      if (commentId) state.sampleCommentId = commentId;
    },
  },
  {
    id: "comments-like",
    route: "/v2/comments/:commentId/like",
    method: "POST",
    nativeSurface: "Comment like",
    nativeRef: "Locava-Native/src/features/comments/backendv2/commentsV2.repository.ts",
    buildPath: (state) => (state.sampleCommentId ? `/v2/comments/${encodeURIComponent(state.sampleCommentId)}/like` : null),
    buildBody: () => ({}),
  },
  {
    id: "comments-delete",
    route: "/v2/comments/:commentId",
    method: "DELETE",
    nativeSurface: "Comment delete",
    nativeRef: "Locava-Native/src/features/comments/backendv2/commentsV2.repository.ts",
    buildPath: (state) => (state.sampleCommentId ? `/v2/comments/${encodeURIComponent(state.sampleCommentId)}` : null),
  },
  {
    id: "notifications-list",
    route: "/v2/notifications",
    method: "GET",
    nativeSurface: "Notifications list",
    nativeRef: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
    expectations: { pagination: true },
    buildPath: () => "/v2/notifications?limit=10",
    afterSuccess: (state, envelope) => {
      const items = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const firstId = String(items[0]?.notificationId ?? "");
      const unreadId =
        items.find((row) => String(row.readState ?? "").toLowerCase() === "unread")?.notificationId ??
        items[0]?.notificationId;
      if (firstId) state.sampleNotificationId = firstId;
      if (typeof unreadId === "string" && unreadId) state.sampleUnreadNotificationId = unreadId;
    },
  },
  {
    id: "notifications-mark-read",
    route: "/v2/notifications/mark-read",
    method: "POST",
    nativeSurface: "Notifications mark read",
    nativeRef: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
    buildPath: (state) => (state.sampleUnreadNotificationId || state.sampleNotificationId ? "/v2/notifications/mark-read" : null),
    buildBody: (state) => ({ notificationIds: [state.sampleUnreadNotificationId ?? state.sampleNotificationId].filter(Boolean) }),
  },
  {
    id: "notifications-mark-all-read",
    route: "/v2/notifications/mark-all-read",
    method: "POST",
    nativeSurface: "Notifications mark all read",
    nativeRef: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
    buildPath: () => "/v2/notifications/mark-all-read",
    buildBody: () => ({}),
  },
  {
    id: "chats-create-or-get",
    route: "/v2/chats/create-or-get",
    method: "POST",
    nativeSurface: "Create or get chat",
    nativeRef: "Locava-Native/src/features/chats/data/newChat.api.ts",
    buildPath: (state) => (state.targetUserId ? "/v2/chats/create-or-get" : null),
    buildBody: (state) => ({ otherUserId: state.targetUserId }),
    afterSuccess: (state, envelope) => {
      const conversationId = String(envelope.data?.conversationId ?? "");
      if (conversationId) {
        state.tempConversationId = conversationId;
        state.sampleConversationId = state.sampleConversationId ?? conversationId;
      }
    },
  },
  {
    id: "chats-create-group",
    route: "/v2/chats/create-group",
    method: "POST",
    nativeSurface: "Create group chat",
    nativeRef: "Locava-Native/src/features/chats/data/newChat.api.ts",
    buildPath: (state) => (state.targetUserId ? "/v2/chats/create-group" : null),
    buildBody: (state) => ({
      participants: state.targetUserId ? [state.targetUserId] : [],
      groupName: `Audit ${Date.now()}`,
    }),
    afterSuccess: (state, envelope) => {
      const conversationId = String(envelope.data?.conversationId ?? "");
      if (conversationId) state.tempConversationId = conversationId;
    },
  },
  {
    id: "chats-inbox",
    route: "/v2/chats/inbox",
    method: "GET",
    nativeSurface: "Chats inbox",
    nativeRef: "Locava-Native/src/features/chats/data",
    expectations: { pagination: true },
    buildPath: () => "/v2/chats/inbox?limit=10",
    afterSuccess: (state, envelope) => {
      const items = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const conversationId = String(items[0]?.conversationId ?? "");
      if (conversationId) state.sampleConversationId = conversationId;
    },
  },
  {
    id: "chats-thread",
    route: "/v2/chats/:conversationId/messages",
    method: "GET",
    nativeSurface: "Chat thread",
    nativeRef: "Locava-Native/src/features/chatThread/data",
    expectations: { pagination: true },
    buildPath: (state) =>
      state.sampleConversationId ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/messages?limit=10` : null,
    afterSuccess: (state, envelope) => {
      const items = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const messageId = String(items[0]?.messageId ?? "");
      if (messageId) state.sampleMessageId = messageId;
    },
  },
  {
    id: "chats-send-message",
    route: "/v2/chats/:conversationId/messages",
    method: "POST",
    nativeSurface: "Chat send message",
    nativeRef: "Locava-Native/src/features/chatThread/data/thread.send.ts",
    buildPath: (state) =>
      state.sampleConversationId ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/messages` : null,
    buildBody: () => ({
      messageType: "text",
      text: `audit message ${Date.now()}`,
      clientMessageId: `audit-msg-${Date.now()}`,
    }),
    afterSuccess: (state, envelope) => {
      const message = envelope.data?.message as Record<string, unknown> | undefined;
      const messageId = String(message?.messageId ?? "");
      if (messageId) state.sampleMessageId = messageId;
    },
  },
  {
    id: "chats-mark-read",
    route: "/v2/chats/:conversationId/mark-read",
    method: "POST",
    nativeSurface: "Chat mark read",
    nativeRef: "Locava-Native/src/features/chats/data/chatMutations.repository.ts",
    buildPath: (state) =>
      state.sampleConversationId ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/mark-read` : null,
    buildBody: () => ({}),
  },
  {
    id: "chats-mark-unread",
    route: "/v2/chats/:conversationId/mark-unread",
    method: "POST",
    nativeSurface: "Chat mark unread",
    nativeRef: "Locava-Native/src/features/chats/data/chatIndex.api.ts",
    buildPath: (state) =>
      state.sampleConversationId ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/mark-unread` : null,
    buildBody: () => ({}),
  },
  {
    id: "chats-typing-status",
    route: "/v2/chats/:conversationId/typing-status",
    method: "PUT",
    nativeSurface: "Chat typing status",
    nativeRef: "Locava-Native/src/features/chatThread/data/thread.send.ts",
    buildPath: (state) =>
      state.sampleConversationId ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/typing-status` : null,
    buildBody: () => ({ isTyping: true }),
  },
  {
    id: "chats-delete-message",
    route: "/v2/chats/:conversationId/messages/:messageId",
    method: "DELETE",
    nativeSurface: "Chat delete message",
    nativeRef: "Locava-Native/src/features/chatThread/data/thread.deleteMessage.ts",
    buildPath: (state) =>
      state.sampleConversationId && state.sampleMessageId
        ? `/v2/chats/${encodeURIComponent(state.sampleConversationId)}/messages/${encodeURIComponent(state.sampleMessageId)}`
        : null,
  },
  {
    id: "chats-delete",
    route: "/v2/chats/:conversationId",
    method: "DELETE",
    nativeSurface: "Delete chat",
    nativeRef: "Locava-Native/src/features/chats/data/chatIndex.api.ts",
    buildPath: (state) =>
      state.tempConversationId ? `/v2/chats/${encodeURIComponent(state.tempConversationId)}` : null,
  },
  {
    id: "achievements-bootstrap",
    route: "/v2/achievements/bootstrap",
    method: "GET",
    nativeSurface: "Achievements bootstrap",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/bootstrap",
  },
  {
    id: "achievements-hero",
    route: "/v2/achievements/hero",
    method: "GET",
    nativeSurface: "Achievements hero",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/hero",
  },
  {
    id: "achievements-snapshot",
    route: "/v2/achievements/snapshot",
    method: "GET",
    nativeSurface: "Achievements snapshot",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/snapshot",
  },
  {
    id: "achievements-status",
    route: "/v2/achievements/status",
    method: "GET",
    nativeSurface: "Achievements status",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/status",
  },
  {
    id: "achievements-screen-opened",
    route: "/v2/achievements/screen-opened",
    method: "POST",
    nativeSurface: "Achievements screen opened",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/screen-opened",
    buildBody: () => ({ clientOpenedAtMs: Date.now() }),
  },
  {
    id: "achievements-pending-delta",
    route: "/v2/achievements/pending-delta",
    method: "GET",
    nativeSurface: "Achievements pending delta",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/pending-delta",
  },
  {
    id: "achievements-leagues",
    route: "/v2/achievements/leagues",
    method: "GET",
    nativeSurface: "Achievements leagues",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/leagues",
  },
  {
    id: "achievements-claimables",
    route: "/v2/achievements/claimables",
    method: "GET",
    nativeSurface: "Achievements claimables",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/claimables",
  },
  {
    id: "achievements-leaderboard",
    route: "/v2/achievements/leaderboard/:scope",
    method: "GET",
    nativeSurface: "Achievements leaderboard",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/leaderboard/xp_global",
  },
  {
    id: "achievements-ack-leaderboard",
    route: "/v2/achievements/ack-leaderboard-event",
    method: "POST",
    nativeSurface: "Achievements ack leaderboard event",
    nativeRef: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    buildPath: () => "/v2/achievements/ack-leaderboard-event",
    buildBody: () => ({ eventId: `audit-event-${Date.now()}` }),
  },
  {
    id: "posts-detail-batch",
    route: "/v2/posts/details:batch",
    method: "POST",
    nativeSurface: "Posts detail batch",
    nativeRef: "Locava-Native/src/data/repos/postRepo.ts",
    buildPath: () => "/v2/posts/details:batch",
    buildBody: (state) => ({ postIds: state.samplePostId ? [state.samplePostId] : [], reason: "open" }),
  },
  {
    id: "posts-like",
    route: "/v2/posts/:postId/like",
    method: "POST",
    nativeSurface: "Post like",
    nativeRef: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/like` : null),
    buildBody: () => ({}),
  },
  {
    id: "posts-unlike",
    route: "/v2/posts/:postId/unlike",
    method: "POST",
    nativeSurface: "Post unlike",
    nativeRef: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/unlike` : null),
    buildBody: () => ({}),
  },
  {
    id: "posts-save",
    route: "/v2/posts/:postId/save",
    method: "POST",
    nativeSurface: "Post save",
    nativeRef: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/save` : null),
    buildBody: () => ({}),
  },
  {
    id: "posts-unsave",
    route: "/v2/posts/:postId/unsave",
    method: "POST",
    nativeSurface: "Post unsave",
    nativeRef: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    buildPath: (state) => (state.samplePostId ? `/v2/posts/${encodeURIComponent(state.samplePostId)}/unsave` : null),
    buildBody: () => ({}),
  },
  {
    id: "posting-upload-session",
    route: "/v2/posting/upload-session",
    method: "POST",
    nativeSurface: "Posting upload session",
    nativeRef: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
    buildPath: () => "/v2/posting/upload-session",
    buildBody: () => ({
      clientSessionKey: `audit-upload-session-${Date.now()}`,
      mediaCountHint: 1,
    }),
    afterSuccess: (state, envelope) => {
      const sessionId = String((envelope.data?.uploadSession as Record<string, unknown> | undefined)?.sessionId ?? "");
      if (sessionId) state.uploadSessionId = sessionId;
    },
  },
  {
    id: "posting-media-register",
    route: "/v2/posting/media/register",
    method: "POST",
    nativeSurface: "Posting media register",
    nativeRef: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
    buildPath: () => "/v2/posting/media/register",
    buildBody: (state) => ({
      sessionId: state.uploadSessionId,
      assetIndex: 0,
      assetType: "photo",
      clientMediaKey: `audit-media-${Date.now()}`,
    }),
    afterSuccess: (state, envelope) => {
      const mediaId = String((envelope.data?.media as Record<string, unknown> | undefined)?.mediaId ?? "");
      if (mediaId) state.mediaId = mediaId;
    },
  },
  {
    id: "posting-media-mark-uploaded",
    route: "/v2/posting/media/:mediaId/mark-uploaded",
    method: "POST",
    nativeSurface: "Posting media mark uploaded",
    nativeRef: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
    buildPath: (state) => (state.mediaId ? `/v2/posting/media/${encodeURIComponent(state.mediaId)}/mark-uploaded` : null),
    buildBody: () => ({ uploadedObjectKey: `audit/uploaded/${Date.now()}.jpg` }),
  },
  {
    id: "posting-finalize",
    route: "/v2/posting/finalize",
    method: "POST",
    nativeSurface: "Posting finalize",
    nativeRef: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
    buildPath: () => "/v2/posting/finalize",
    buildBody: (state) => ({
      sessionId: state.uploadSessionId,
      idempotencyKey: `audit-finalize-${Date.now()}`,
      mediaCount: 1,
      title: "Backendv2 full-app audit",
      content: "Audit posting flow",
      activities: [],
      stagedItems: state.mediaId
        ? [{ index: 0, assetType: "photo", assetId: state.mediaId, originalKey: `audit/uploaded/${Date.now()}.jpg` }]
        : [],
    }),
    afterSuccess: (state, envelope) => {
      const operationId = String((envelope.data?.operation as Record<string, unknown> | undefined)?.operationId ?? "");
      if (operationId) state.operationId = operationId;
    },
  },
  {
    id: "posting-operation-status",
    route: "/v2/posting/operations/:operationId",
    method: "GET",
    nativeSurface: "Posting operation status",
    nativeRef: "Locava-Native/src/features/post/upload/postTask.reconcile.ts",
    buildPath: (state) => (state.operationId ? `/v2/posting/operations/${encodeURIComponent(state.operationId)}` : null),
  },
  {
    id: "collections-delete",
    route: "/v2/collections/:collectionId",
    method: "DELETE",
    nativeSurface: "Delete collection",
    nativeRef: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
    buildPath: (state) => (state.tempCollectionId ? `/v2/collections/${encodeURIComponent(state.tempCollectionId)}` : null),
  },
];

const specById = new Map(specs.map((spec) => [spec.id, spec] as const));

async function injectSpec(app: ReturnType<typeof createApp>, spec: AuditSpec, state: AuditState): Promise<{
  response: Awaited<ReturnType<typeof app.inject>>;
  envelope: Envelope | null;
  diagnostic: ReturnType<typeof findDiagnostic>;
}> {
  const resolvedPath = spec.buildPath(state);
  if (!resolvedPath) {
    throw new Error(`missing_prerequisite:${spec.id}`);
  }
  const response = await app.inject({
    method: spec.method,
    url: resolvedPath,
    headers: {
      "x-viewer-id": state.viewerId,
      "x-viewer-roles": "internal",
      accept: "application/json",
      ...(spec.buildBody ? { "content-type": "application/json" } : {}),
    },
    ...(spec.buildBody ? { payload: JSON.stringify(spec.buildBody(state)) } : {}),
  });
  const envelope = readJson(response.payload);
  const diagnostic = findDiagnostic(envelope?.meta?.requestId);
  if (envelope?.ok === true && spec.afterSuccess) {
    spec.afterSuccess(state, envelope);
  }
  return { response, envelope, diagnostic };
}

async function ensurePrerequisites(app: ReturnType<typeof createApp>, specId: string, state: AuditState): Promise<void> {
  const runPrereq = async (id: string): Promise<void> => {
    const spec = specById.get(id);
    if (!spec) return;
    try {
      await injectSpec(app, spec, state);
    } catch {
      // Let the main spec surface the failure if prerequisites cannot be discovered.
    }
  };

  if (["feed-item-detail", "post-detail"].includes(specId) && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (["users-follow", "users-unfollow", "chats-create-or-get", "chats-create-group"].includes(specId) && !state.targetUserId) {
    await runPrereq("search-users");
    if (!state.targetUserId) await runPrereq("social-suggested-friends");
  }
  if (specId === "comments-list" && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (["comments-list", "comments-create"].includes(specId) && !state.sampleCommentPostId) {
    await runPrereq("profile-grid");
    if (!state.sampleCommentPostId) await runPrereq("feed-bootstrap");
    if (!state.sampleCommentPostId) state.sampleCommentPostId = state.samplePostId;
    if (!state.sampleCommentPostId) state.sampleCommentPostId = state.auditCommentPostId;
  }
  if (specId === "comments-delete" && !state.sampleCommentId) {
    if (!state.sampleCommentPostId) {
      await runPrereq("profile-grid");
      if (!state.sampleCommentPostId) await runPrereq("feed-bootstrap");
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.samplePostId;
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.auditCommentPostId;
    }
    await runPrereq("comments-create");
  }
  if (["collections-detail", "collections-posts"].includes(specId) && !state.sampleCollectionId && !state.tempCollectionId) {
    await runPrereq("collections-list");
    if (!state.sampleCollectionId && !state.tempCollectionId) {
      await runPrereq("collections-create");
    }
  }
  if (["collections-update", "collections-delete", "collections-posts-add", "collections-posts-remove"].includes(specId) && !state.tempCollectionId) {
    await runPrereq("collections-create");
  }
  if (["collections-save-sheet", "posts-detail-batch", "posts-like", "posts-unlike", "posts-save", "posts-unsave", "collections-posts-add", "collections-posts-remove"].includes(specId) && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (["notifications-mark-read", "notifications-mark-all-read"].includes(specId) && !state.sampleNotificationId && !state.sampleUnreadNotificationId) {
    await runPrereq("notifications-list");
  }
  if (specId === "chats-thread" && !state.sampleConversationId) {
    await runPrereq("chats-inbox");
  }
  if (["chats-send-message", "chats-mark-read", "chats-mark-unread", "chats-typing-status"].includes(specId) && !state.sampleConversationId) {
    await runPrereq("chats-inbox");
    if (!state.sampleConversationId) await runPrereq("chats-create-or-get");
  }
  if (specId === "chats-delete-message" && (!state.sampleConversationId || !state.sampleMessageId)) {
    if (!state.sampleConversationId) await runPrereq("chats-create-or-get");
    await runPrereq("chats-thread");
    if (!state.sampleMessageId) await runPrereq("chats-send-message");
    if (!state.sampleMessageId) await runPrereq("chats-thread");
  }
  if (specId === "chats-delete" && !state.tempConversationId) {
    await runPrereq("chats-create-group");
  }
  if (["posting-media-register", "posting-finalize"].includes(specId) && !state.uploadSessionId) {
    await runPrereq("posting-upload-session");
  }
  if (["posting-media-mark-uploaded", "posting-finalize"].includes(specId) && !state.mediaId) {
    await runPrereq("posting-media-register");
  }
  if (specId === "posting-finalize" && state.mediaId) {
    await runPrereq("posting-media-mark-uploaded");
  }
  if (specId === "posting-operation-status" && !state.operationId) {
    await runPrereq("posting-finalize");
  }
}

async function main() {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const existingCommentAuditPostId = await findExistingCommentAuditPost(viewerId);
  const auditCommentPostId = await ensureCommentAuditFixturePost(viewerId);
  const state: AuditState = {
    viewerId,
    targetUserId: null,
    samplePostId: process.env.LOCAVA_AUDIT_POST_ID?.trim() || null,
    sampleCommentPostId:
      process.env.LOCAVA_AUDIT_COMMENT_POST_ID?.trim() ||
      existingCommentAuditPostId ||
      process.env.LOCAVA_AUDIT_POST_ID?.trim() ||
      null,
    auditCommentPostId,
    sampleCollectionId: process.env.LOCAVA_AUDIT_COLLECTION_ID?.trim() || null,
    tempCollectionId: null,
    sampleConversationId: process.env.LOCAVA_AUDIT_CONVERSATION_ID?.trim() || null,
    sampleCommentId: null,
    sampleMessageId: null,
    sampleNotificationId: null,
    sampleUnreadNotificationId: null,
    uploadSessionId: null,
    mediaId: null,
    operationId: null,
    tempConversationId: null,
  };

  const rows: AuditRow[] = [];
  const specsToRun = only ? specs.filter((spec) => spec.id === only) : specs;

  try {
    for (const spec of specsToRun) {
      await ensurePrerequisites(app, spec.id, state);
      const resolvedPath = spec.buildPath(state);
      if (!resolvedPath) {
        rows.push({
          id: spec.id,
          nativeSurface: spec.nativeSurface,
          nativeRef: spec.nativeRef,
          method: spec.method,
          path: null,
          routeName: null,
          statusCode: null,
          classification: "MISSING_TEST",
          latencyMs: null,
          budgetMs: null,
          payloadBytes: null,
          budgetBytes: null,
          firestoreReads: null,
          firestoreQueries: null,
          readBudget: null,
          cacheStatus: "unknown",
          pagination: "not_applicable",
          errorCode: "missing_prerequisite_sample_data",
          errorMessage: "No sample entity could be discovered before this check ran.",
          budgetViolations: [],
          fallbacks: [],
          timeouts: [],
          surfaceTimings: {},
          notes: ["Prerequisite entity discovery did not yield a usable id."],
        });
        continue;
      }
      const { response, envelope, diagnostic } = await injectSpec(app, spec, state);
      const routeName = String(envelope?.data?.routeName ?? diagnostic?.routeName ?? "");
      const routePolicy = routeName ? getRoutePolicy(routeName) : undefined;
      const row: AuditRow = {
        id: spec.id,
        nativeSurface: spec.nativeSurface,
        nativeRef: spec.nativeRef,
        method: spec.method,
        path: resolvedPath,
        routeName: routeName || null,
        statusCode: response.statusCode,
        classification: classify(spec, envelope, diagnostic),
        latencyMs: diagnostic?.latencyMs ?? envelope?.meta?.latencyMs ?? null,
        budgetMs: routePolicy?.budgets.latency.p95Ms ?? null,
        payloadBytes: diagnostic?.payloadBytes ?? (response.payload ? Buffer.byteLength(response.payload, "utf8") : null),
        budgetBytes: routePolicy?.budgets.payload.maxBytes ?? null,
        firestoreReads: diagnostic?.dbOps.reads ?? envelope?.meta?.db?.reads ?? null,
        firestoreQueries: diagnostic?.dbOps.queries ?? envelope?.meta?.db?.queries ?? null,
        readBudget: routePolicy?.budgets.dbOps.maxReadsCold ?? null,
        cacheStatus: detectCacheStatus(envelope ?? {}, diagnostic),
        pagination: detectPagination(envelope ?? {}),
        errorCode: envelope?.ok === false ? String(envelope.error?.code ?? "") : null,
        errorMessage: envelope?.ok === false ? String(envelope.error?.message ?? "") : null,
        budgetViolations: diagnostic?.budgetViolations ?? [],
        fallbacks: diagnostic?.fallbacks ?? [],
        timeouts: diagnostic?.timeouts ?? [],
        surfaceTimings: diagnostic?.surfaceTimings ?? {},
        notes: [],
      };

      if (spec.expectations?.pagination && row.pagination !== "cursor") {
        note(row, "Expected cursor pagination markers but response page block did not expose cursor fields.");
      }
      if (!routePolicy) {
        note(row, "No route policy metadata found for resolved routeName.");
      }
      if (spec.expectations?.intentionalLegacyProxy) {
        note(row, "Route is intentionally bridged to legacy search logic while keeping the v2 contract.");
      }
      if (spec.expectations?.stagedHydration) {
        note(row, "Route is expected to return staged hydration rather than a single fully expanded payload.");
      }
      const surfaceTimingNote = formatSurfaceTimingNote(row.surfaceTimings);
      if (surfaceTimingNote) {
        note(row, surfaceTimingNote);
      }
      rows.push(row);
    }
  } finally {
    await app.close();
    await cleanupCommentAuditFixturePost(auditCommentPostId);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    viewerId: state.viewerId,
    only: only || null,
    counts: rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.classification] = (acc[row.classification] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  const md = [
    "",
    "## Backendv2 audit runner summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Viewer: \`${summary.viewerId}\``,
    "",
    "| Surface | Route | Classification | Status | Latency ms | Budget ms | Payload bytes | Budget bytes | Reads | Queries | Read budget |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.id} | \`${row.routeName ?? row.path ?? "n/a"}\` | ${row.classification} | ${row.statusCode ?? "n/a"} | ${row.latencyMs ?? "n/a"} | ${row.budgetMs ?? "n/a"} | ${row.payloadBytes ?? "n/a"} | ${row.budgetBytes ?? "n/a"} | ${row.firestoreReads ?? "n/a"} | ${row.firestoreQueries ?? "n/a"} | ${row.readBudget ?? "n/a"} |`
    ),
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(auditDocPath), { recursive: true });
  if (!fs.existsSync(auditDocPath)) {
    fs.writeFileSync(auditDocPath, "# Full App Backendv2 System Audit - 2026-04-25\n");
  }
  fs.appendFileSync(auditDocPath, md);

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
process.exit(0);
