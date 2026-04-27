import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createApp } from "../src/app/createApp.js";
import {
  cloneAuditState,
  getAuditIsolationPolicy,
  resetAuditProcessState,
  settleAuditSpecState,
  type AuditExecutionContext,
  type AuditState
} from "../src/debug/full-app-v2-audit-support.js";
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
  auditRunId: string;
  auditSpecId: string;
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
  fixtures: Record<string, string>;
  notes: string[];
};

type PersistedAuditFixtures = {
  targetUserId?: string;
  samplePostId?: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const reportPath = path.join(repoRoot, "tmp", "full-app-v2-audit-report.json");
const reportHistoryDir = path.join(repoRoot, "tmp", "full-app-v2-audit-runs");
const fixtureCachePath = path.join(repoRoot, "tmp", "full-app-v2-audit-fixtures.json");
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
      data: doc.data() as Record<string, unknown>,
    }))
    .filter(
      (row) =>
        row.id &&
        !row.id.startsWith("audit-v2-comment-target-") &&
        row.showComments !== false &&
        !isAuditGeneratedPost(row.data)
    );
  return candidates[0]?.id ?? null;
}

async function cleanupCommentAuditFixturePost(fixtureId: string | null): Promise<void> {
  if (!fixtureId) return;
  if (process.env.LOCAVA_AUDIT_COMMENT_POST_ID?.trim()) return;
  const db = getAuditFirestore();
  await db.collection("posts").doc(fixtureId).delete();
}

async function normalizeViewerPostCounters(viewerIdToUse: string): Promise<void> {
  const db = getAuditFirestore();
  const countSnap = await db.collection("posts").where("userId", "==", viewerIdToUse).count().get();
  const count = Number(countSnap.data().count ?? 0);
  await Promise.all([
    db.collection("users").doc(viewerIdToUse).set(
      {
        numPosts: count,
        postCount: count,
        postsCount: count,
        postCountVerifiedAtMs: Date.now(),
        postCountVerifiedValue: count
      },
      { merge: true }
    ),
    db.collection("users").doc(viewerIdToUse).collection("achievements").doc("state").set(
      {
        totalPosts: count,
        updatedAt: Date.now()
      },
      { merge: true }
    )
  ]);
}

async function resetCommentAuditFixturePost(postId: string | null): Promise<void> {
  if (!postId) return;
  const db = getAuditFirestore();
  const snap = await db.collection("posts").doc(postId).collection("comments").get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.set(
    db.collection("posts").doc(postId),
    {
      comments: [],
      commentCount: 0,
      commentsCount: 0,
      updatedAtMs: Date.now(),
      lastUpdated: Timestamp.now()
    },
    { merge: true }
  );
  await batch.commit();
}

function pickTargetUserId(state: AuditState, rows: Array<Record<string, unknown>>): string | null {
  return (
    rows
      .map((row) => String(row.userId ?? row.id ?? ""))
      .filter((id) => id.length > 0 && id !== state.viewerId)
      .sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

async function findFallbackTargetUserId(viewerIdToUse: string): Promise<string | null> {
  const db = getAuditFirestore();
  const usersSnap = await db.collection("users").limit(25).get();
  return (
    usersSnap.docs
      .map((doc) => doc.id)
      .filter((id) => id && id !== viewerIdToUse)
      .sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

async function findExistingFollowedUserId(viewerIdToUse: string): Promise<string | null> {
  const db = getAuditFirestore();
  const snap = await db.collection("users").doc(viewerIdToUse).collection("following").limit(10).get();
  return (
    snap.docs
      .map((doc) => doc.id)
      .filter((id) => id && id !== viewerIdToUse)
      .sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

async function findExistingLikedPostId(viewerIdToUse: string): Promise<string | null> {
  const db = getAuditFirestore();
  const snap = await db.collection("users").doc(viewerIdToUse).collection("likedPosts").limit(10).get();
  return snap.docs.map((doc) => doc.id).filter(Boolean).sort((a, b) => a.localeCompare(b))[0] ?? null;
}

async function findStableSamplePostId(viewerIdToUse: string): Promise<string | null> {
  const db = getAuditFirestore();
  const snap = await db.collection("posts").where("userId", "==", viewerIdToUse).orderBy("time", "desc").limit(200).get();
  return (
    snap.docs
      .find((doc) => doc.id.length > 0 && !doc.id.startsWith("audit-v2-comment-target-") && !isAuditGeneratedPost(doc.data()))
      ?.id ?? null
  );
}

async function findFallbackStablePostId(): Promise<string | null> {
  const db = getAuditFirestore();
  const snap = await db.collection("posts").orderBy("time", "desc").limit(200).get();
  return (
    snap.docs
      .find((doc) => doc.id.length > 0 && !doc.id.startsWith("audit-v2-comment-target-") && !isAuditGeneratedPost(doc.data()))
      ?.id ?? null
  );
}

async function postExists(postId: string): Promise<boolean> {
  const db = getAuditFirestore();
  const snap = await db.collection("posts").doc(postId).get();
  return snap.exists && !isAuditGeneratedPost((snap.data() ?? {}) as Record<string, unknown>);
}

async function userExists(userId: string): Promise<boolean> {
  const db = getAuditFirestore();
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists;
}

function loadPersistedAuditFixtures(): PersistedAuditFixtures {
  if (!fs.existsSync(fixtureCachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(fixtureCachePath, "utf8")) as PersistedAuditFixtures;
  } catch {
    return {};
  }
}

function persistAuditFixtures(fixtures: PersistedAuditFixtures): void {
  fs.mkdirSync(path.dirname(fixtureCachePath), { recursive: true });
  fs.writeFileSync(fixtureCachePath, JSON.stringify(fixtures, null, 2));
}

function isAuditGeneratedPost(input: Record<string, unknown>): boolean {
  const text = [input.caption, input.title, input.description, input.content]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .join(" ");
  return text.includes("backendv2 full-app audit") || text.includes("audit posting flow");
}

async function seedCollectionPostEdge(input: { viewerId: string; collectionId: string; postId: string }): Promise<void> {
  const db = getAuditFirestore();
  await Promise.all([
    db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId).set(
      {
        postId: input.postId,
        addedAt: Timestamp.now()
      },
      { merge: true }
    ),
    db.collection("collections").doc(input.collectionId).set(
      {
        items: [input.postId],
        itemsCount: 1,
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: input.viewerId,
        updatedAt: Timestamp.now()
      },
      { merge: true }
    )
  ]);
}

async function createFixtureCollection(viewerIdToUse: string): Promise<string> {
  const db = getAuditFirestore();
  const ref = db.collection("collections").doc();
  const now = Date.now();
  await ref.set({
    ownerId: viewerIdToUse,
    userId: viewerIdToUse,
    name: `Audit Fixture ${now}`,
    description: "full-app-v2-audit fixture collection",
    privacy: "private",
    collaborators: [viewerIdToUse],
    permissions: {
      isOwner: true,
      isCollaborator: true,
      canEdit: true
    },
    items: [],
    itemsCount: 0,
    isPublic: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    lastContentActivityAtMs: now
  });
  return ref.id;
}

async function cleanupFixtureCollection(collectionId: string | null): Promise<void> {
  if (!collectionId) return;
  const db = getAuditFirestore();
  const postsSnap = await db.collection("collections").doc(collectionId).collection("posts").get();
  const batch = db.batch();
  postsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(db.collection("collections").doc(collectionId));
  await batch.commit();
}

async function cleanupFixtureConversation(input: {
  viewerId: string;
  targetUserId: string | null;
  conversationId: string | null;
}): Promise<void> {
  if (!input.conversationId) return;
  const db = getAuditFirestore();
  const messagesSnap = await db.collection("chats").doc(input.conversationId).collection("messages").get();
  const batch = db.batch();
  messagesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(db.collection("chats").doc(input.conversationId));
  if (input.targetUserId) {
    const pairKey = [input.viewerId, input.targetUserId].sort().join(":").replace(/[^\w.-]/g, "_");
    batch.delete(db.collection("chat_direct_pairs").doc(pairKey));
  }
  await batch.commit();
}

async function settleFixture(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleAfterSpec(spec: AuditSpec, audit: AuditExecutionContext): Promise<void> {
  if (spec.method !== "GET") {
    await settleFixture();
  }
  await settleAuditSpecState(audit, { clearMutationWarmState: spec.method !== "GET" });
}

async function ensureAchievementAckFixtureEvent(viewerIdToUse: string): Promise<string> {
  const db = getAuditFirestore();
  const eventId = `audit-leaderboard-event-${Date.now()}`;
  await db.collection("users").doc(viewerIdToUse).collection("achievements").doc("state").set(
    {
      pendingLeaderboardPassedEvents: [
        {
          eventId,
          kind: "global",
          prevRank: 5,
          newRank: 4,
          crossedCount: 1,
          cityName: null
        }
      ],
      updatedAt: new Date()
    },
    { merge: true }
  );
  return eventId;
}

function readJson(payload: string): Envelope | null {
  try {
    return JSON.parse(payload) as Envelope;
  } catch {
    return null;
  }
}

function findDiagnostic(input: { requestId?: string; auditRunId: string; auditSpecId: string }) {
  if (!input.requestId) return null;
  return diagnosticsStore.findRequest({
    requestId: input.requestId,
    auditRunId: input.auditRunId,
    auditSpecId: input.auditSpecId
  });
}

function captureFixtureContext(state: AuditState): Record<string, string> {
  const fixtures: Record<string, string> = {};
  const maybeEntries: Array<[string, string | null]> = [
    ["viewerId", state.viewerId],
    ["targetUserId", state.targetUserId],
    ["unfollowTargetUserId", state.unfollowTargetUserId],
    ["samplePostId", state.samplePostId],
    ["unlikePostId", state.unlikePostId],
    ["sampleCommentPostId", state.sampleCommentPostId],
    ["auditCommentPostId", state.auditCommentPostId],
    ["sampleCollectionId", state.sampleCollectionId],
    ["tempCollectionId", state.tempCollectionId],
    ["sampleConversationId", state.sampleConversationId],
    ["tempConversationId", state.tempConversationId],
    ["sampleCommentId", state.sampleCommentId],
    ["sampleMessageId", state.sampleMessageId],
    ["sampleNotificationId", state.sampleNotificationId],
    ["sampleUnreadNotificationId", state.sampleUnreadNotificationId],
    ["uploadSessionId", state.uploadSessionId],
    ["mediaId", state.mediaId],
    ["operationId", state.operationId],
    ["sampleAchievementEventId", state.sampleAchievementEventId]
  ];
  for (const [key, value] of maybeEntries) {
    if (value) fixtures[key] = value;
  }
  return fixtures;
}

function buildAuditRequestId(audit: AuditExecutionContext, phase: "prereq" | "target", sequence: number): string {
  return `${audit.auditRunId}:${audit.auditSpecName}:${phase}:${sequence}`;
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

function isNearLatencyBudgetMiss(diagnostic: ReturnType<typeof findDiagnostic>): boolean {
  const latencyMs = diagnostic?.latencyMs;
  const budgetMs = diagnostic?.routePolicy?.budgets.latency.p95Ms;
  if (typeof latencyMs !== "number" || typeof budgetMs !== "number" || latencyMs <= budgetMs) {
    return false;
  }
  const allowedJitterMs = Math.min(20, Math.max(6, Math.round(budgetMs * 0.1)));
  return latencyMs - budgetMs <= allowedJitterMs;
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
  if (diagnostic?.budgetViolations.includes("latency_p95_exceeded") && !isNearLatencyBudgetMiss(diagnostic)) {
    return "BROKEN_LATENCY_BUDGET";
  }
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
      const data = envelope.data as Record<string, unknown> | undefined;
      const firstRender = data?.firstRender as Record<string, unknown> | undefined;
      const feed = firstRender?.feed as Record<string, unknown> | undefined;
      const directFeed = data?.feed as Record<string, unknown> | undefined;
      const page = data?.page as Record<string, unknown> | undefined;
      const items =
        (feed?.items as Array<Record<string, unknown>> | undefined) ??
        (directFeed?.items as Array<Record<string, unknown>> | undefined) ??
        (data?.items as Array<Record<string, unknown>> | undefined) ??
        (page?.items as Array<Record<string, unknown>> | undefined) ??
        [];
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
      const users = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const targetUserId = pickTargetUserId(state, users);
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
    buildPath: (state) =>
      state.unfollowTargetUserId ? `/v2/users/${encodeURIComponent(state.unfollowTargetUserId)}/unfollow` : null,
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
    afterSuccess: (state, envelope) => {
      const users = (envelope.data?.items as Array<Record<string, unknown>> | undefined) ?? [];
      const targetUserId = pickTargetUserId(state, users);
      if (targetUserId) state.targetUserId = targetUserId;
    },
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
    buildBody: (state) => ({
      name: `Audit ${Date.now()}`,
      description: "full-app-v2-audit temporary collection",
      privacy: "private",
      items: state.seedCollectionItemIds ?? undefined,
    }),
    afterSuccess: (state, envelope) => {
      const id = String(envelope.data?.collectionId ?? "");
      if (id) {
        state.tempCollectionId = id;
        state.sampleCollectionId = state.sampleCollectionId ?? id;
      }
      state.seedCollectionItemIds = null;
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
    buildBody: () => ({ privacy: "friends" }),
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
    afterSuccess: (state, envelope) => {
      const snapshot = envelope.data?.snapshot as Record<string, unknown> | undefined;
      const pending = snapshot?.pendingLeaderboardEvent as Record<string, unknown> | undefined;
      const eventId = String(pending?.eventId ?? "");
      if (eventId) state.sampleAchievementEventId = eventId;
    },
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
    buildBody: (state) => ({ eventId: state.sampleAchievementEventId ?? `audit-event-${Date.now()}` }),
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
    buildPath: (state) => (state.unlikePostId ? `/v2/posts/${encodeURIComponent(state.unlikePostId)}/unlike` : null),
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

async function injectSpec(
  app: ReturnType<typeof createApp>,
  spec: AuditSpec,
  state: AuditState,
  audit: AuditExecutionContext,
  requestSequence: number,
  phase: "prereq" | "target"
): Promise<{
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
      "x-request-id": buildAuditRequestId(audit, phase, requestSequence),
      "x-audit-run-id": audit.auditRunId,
      "x-audit-spec-id": audit.auditSpecId,
      "x-audit-spec-name": audit.auditSpecName,
      "x-viewer-id": state.viewerId,
      "x-viewer-roles": "internal",
      accept: "application/json",
      ...(spec.buildBody ? { "content-type": "application/json" } : {}),
    },
    ...(spec.buildBody ? { payload: JSON.stringify(spec.buildBody(state)) } : {}),
  });
  const envelope = readJson(response.payload);
  const diagnostic = findDiagnostic({
    requestId: envelope?.meta?.requestId,
    auditRunId: audit.auditRunId,
    auditSpecId: audit.auditSpecId
  });
  if (envelope?.ok === true && spec.afterSuccess) {
    spec.afterSuccess(state, envelope);
  }
  return { response, envelope, diagnostic };
}

async function ensurePrerequisites(
  app: ReturnType<typeof createApp>,
  specId: string,
  state: AuditState,
  audit: AuditExecutionContext,
  requestSequenceRef: { current: number }
): Promise<void> {
  const isolation = getAuditIsolationPolicy(specId);
  const runPrereq = async (id: string): Promise<void> => {
    const spec = specById.get(id);
    if (!spec) return;
    try {
      requestSequenceRef.current += 1;
      await injectSpec(app, spec, state, audit, requestSequenceRef.current, "prereq");
    } catch {
      // Let the main spec surface the failure if prerequisites cannot be discovered.
    }
  };

  if (
    [
      "comments-create",
      "comments-like",
      "comments-delete",
      "users-follow",
      "users-unfollow",
      "chats-create-or-get",
      "chats-delete-message",
      "collections-create",
      "collections-update",
      "collections-posts-add",
      "collections-posts-remove",
      "posting-media-mark-uploaded",
      "posts-unsave"
    ].includes(specId)
  ) {
    await runPrereq("auth-session");
  }

  if (["feed-item-detail", "post-detail"].includes(specId) && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (["users-follow", "users-unfollow", "chats-create-or-get", "chats-create-group", "chats-delete"].includes(specId) && !state.targetUserId) {
    await runPrereq("search-users");
    if (!state.targetUserId) await runPrereq("social-suggested-friends");
    if (!state.targetUserId) await runPrereq("directory-users");
    if (!state.targetUserId) state.targetUserId = await findFallbackTargetUserId(state.viewerId);
  }
  if (isolation.useFreshConversationFixture && !state.targetUserId) {
    await runPrereq("search-users");
    if (!state.targetUserId) await runPrereq("social-suggested-friends");
    if (!state.targetUserId) await runPrereq("directory-users");
    if (!state.targetUserId) state.targetUserId = await findFallbackTargetUserId(state.viewerId);
  }
  if (specId === "users-unfollow" && !state.unfollowTargetUserId) {
    if (isolation.useFreshFollowState) {
      if (!state.targetUserId) {
        await runPrereq("search-users");
        if (!state.targetUserId) await runPrereq("social-suggested-friends");
        if (!state.targetUserId) await runPrereq("directory-users");
        if (!state.targetUserId) state.targetUserId = await findFallbackTargetUserId(state.viewerId);
      }
      if (state.targetUserId) {
        state.unfollowTargetUserId = state.targetUserId;
        await runPrereq("users-follow");
      }
    } else {
      state.unfollowTargetUserId = await findExistingFollowedUserId(state.viewerId);
      if (!state.unfollowTargetUserId) {
        if (!state.targetUserId) {
          await runPrereq("search-users");
          if (!state.targetUserId) await runPrereq("social-suggested-friends");
          if (!state.targetUserId) await runPrereq("directory-users");
          if (!state.targetUserId) state.targetUserId = await findFallbackTargetUserId(state.viewerId);
        }
        if (state.targetUserId) {
          await runPrereq("users-follow");
          state.unfollowTargetUserId = state.targetUserId;
        }
      }
      if (state.unfollowTargetUserId) {
        const priorTargetUserId = state.targetUserId;
        state.targetUserId = state.unfollowTargetUserId;
        await runPrereq("users-follow");
        state.targetUserId = priorTargetUserId;
      }
    }
  }
  if (specId === "comments-list" && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (["comments-list", "comments-create"].includes(specId) && !state.sampleCommentPostId) {
    if (isolation.useDedicatedCommentFixturePost) {
      state.sampleCommentPostId = state.auditCommentPostId;
    } else {
      await runPrereq("profile-grid");
      if (!state.sampleCommentPostId) await runPrereq("feed-bootstrap");
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.samplePostId;
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.auditCommentPostId;
    }
  }
  if (["comments-create", "comments-like", "comments-delete"].includes(specId)) {
    await runPrereq("comments-list");
  }
  if (specId === "comments-like") {
    state.sampleCommentId = null;
    if (isolation.useDedicatedCommentFixturePost) {
      state.sampleCommentPostId = state.auditCommentPostId;
    }
    if (!state.sampleCommentPostId) {
      await runPrereq("profile-grid");
      if (!state.sampleCommentPostId) await runPrereq("feed-bootstrap");
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.samplePostId;
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.auditCommentPostId;
    }
    await runPrereq("comments-create");
  }
  if (specId === "comments-delete") {
    if (isolation.useDedicatedCommentFixturePost) {
      state.sampleCommentPostId = state.auditCommentPostId;
    }
    if (!state.sampleCommentPostId) {
      await runPrereq("profile-grid");
      if (!state.sampleCommentPostId) await runPrereq("feed-bootstrap");
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.samplePostId;
      if (!state.sampleCommentPostId) state.sampleCommentPostId = state.auditCommentPostId;
    }
    state.sampleCommentId = null;
    await runPrereq("comments-create");
  }
  if (["collections-detail", "collections-posts"].includes(specId) && !state.sampleCollectionId && !state.tempCollectionId) {
    await runPrereq("collections-list");
    if (!state.sampleCollectionId && !state.tempCollectionId) {
      await runPrereq("collections-create");
    }
  }
  if (isolation.useFreshCollectionFixture) {
    if (specId === "collections-posts-remove" && !state.samplePostId) {
      await runPrereq("feed-bootstrap");
    }
    state.tempCollectionId = null;
    if (specId === "collections-update") {
      state.tempCollectionId = await createFixtureCollection(state.viewerId);
      if (state.tempCollectionId) {
        requestSequenceRef.current += 1;
        await app.inject({
          method: "GET",
          url: `/v2/collections/${encodeURIComponent(state.tempCollectionId)}`,
          headers: {
            "x-request-id": buildAuditRequestId(audit, "prereq", requestSequenceRef.current),
            "x-audit-run-id": audit.auditRunId,
            "x-audit-spec-id": audit.auditSpecId,
            "x-audit-spec-name": audit.auditSpecName,
            "x-viewer-id": state.viewerId,
            "x-viewer-roles": "internal",
            accept: "application/json"
          }
        });
      }
      await settleFixture();
      state.seedCollectionItemIds = null;
      return;
    }
    state.seedCollectionItemIds =
      specId === "collections-posts-remove" && state.samplePostId ? [state.samplePostId] : null;
    await runPrereq("collections-create");
  }
  if (["collections-save-sheet", "posts-detail-batch", "posts-like", "posts-unlike", "posts-save", "posts-unsave", "collections-posts-add", "collections-posts-remove"].includes(specId) && !state.samplePostId) {
    await runPrereq("feed-bootstrap");
  }
  if (specId === "posts-unlike" && !state.unlikePostId) {
    if (!state.samplePostId) await runPrereq("feed-bootstrap");
    if (isolation.useFreshLikedPostState) {
      if (state.samplePostId) {
        state.unlikePostId = state.samplePostId;
        await runPrereq("posts-like");
      }
    } else {
      state.unlikePostId = await findExistingLikedPostId(state.viewerId);
      if (!state.unlikePostId && state.samplePostId) {
        await runPrereq("posts-like");
        state.unlikePostId = state.samplePostId;
      }
    }
  }
  if (specId === "posts-unsave" && isolation.useFreshSavedPostState && state.samplePostId) {
    await runPrereq("posts-save");
  }
  if (["notifications-mark-read", "notifications-mark-all-read"].includes(specId) && !state.sampleNotificationId && !state.sampleUnreadNotificationId) {
    await runPrereq("notifications-list");
  }
  if (specId === "chats-thread" && !state.sampleConversationId) {
    await runPrereq("chats-inbox");
  }
  if (["chats-send-message", "chats-mark-read", "chats-mark-unread", "chats-typing-status"].includes(specId) && !state.sampleConversationId) {
    if (isolation.useFreshConversationFixture) {
      await runPrereq("chats-create-or-get");
      if (state.tempConversationId) state.sampleConversationId = state.tempConversationId;
    } else {
      await runPrereq("chats-inbox");
      if (!state.sampleConversationId) await runPrereq("chats-create-or-get");
    }
  }
  if (specId === "chats-delete-message" && (!state.sampleConversationId || !state.sampleMessageId)) {
    if (!state.sampleConversationId) await runPrereq("chats-create-or-get");
    if (state.tempConversationId) state.sampleConversationId = state.tempConversationId;
    await runPrereq("chats-thread");
    if (!state.sampleMessageId) await runPrereq("chats-send-message");
    if (!state.sampleMessageId) await runPrereq("chats-thread");
  }
  if (specId === "chats-delete" && !state.tempConversationId) {
    await runPrereq("chats-create-group");
  }
  if (specId === "achievements-ack-leaderboard" && !state.sampleAchievementEventId) {
    await runPrereq("achievements-snapshot");
    if (!state.sampleAchievementEventId) {
      state.sampleAchievementEventId = await ensureAchievementAckFixtureEvent(state.viewerId);
    }
  }
  if (["posting-media-register", "posting-media-mark-uploaded", "posting-finalize", "posting-operation-status"].includes(specId) && !state.uploadSessionId) {
    await runPrereq("posting-upload-session");
  }
  if (["posting-media-mark-uploaded", "posting-finalize", "posting-operation-status"].includes(specId) && !state.mediaId) {
    await runPrereq("posting-media-register");
  }
  if (["posting-finalize", "posting-operation-status"].includes(specId) && state.mediaId) {
    await runPrereq("posting-media-mark-uploaded");
  }
  if (specId === "posting-operation-status" && !state.operationId) {
    await runPrereq("posting-finalize");
  }
}

async function executeAuditSpec(
  app: ReturnType<typeof createApp>,
  spec: AuditSpec,
  state: AuditState,
  rows: AuditRow[],
  audit: AuditExecutionContext
): Promise<void> {
  const requestSequenceRef = { current: 0 };
  await ensurePrerequisites(app, spec.id, state, audit, requestSequenceRef);
  const resolvedPath = spec.buildPath(state);
  if (!resolvedPath) {
    rows.push({
      id: spec.id,
      auditRunId: audit.auditRunId,
      auditSpecId: audit.auditSpecId,
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
      fixtures: captureFixtureContext(state),
      notes: ["Prerequisite entity discovery did not yield a usable id."],
    });
    return;
  }
  requestSequenceRef.current += 1;
  const { response, envelope, diagnostic } = await injectSpec(
    app,
    spec,
    state,
    audit,
    requestSequenceRef.current,
    "target"
  );
  const routeName = String(envelope?.data?.routeName ?? diagnostic?.routeName ?? "");
  const routePolicy = routeName ? getRoutePolicy(routeName) : undefined;
  const row: AuditRow = {
    id: spec.id,
    auditRunId: audit.auditRunId,
    auditSpecId: audit.auditSpecId,
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
    fixtures: captureFixtureContext(state),
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

async function main() {
  const existingCommentAuditPostId = await findExistingCommentAuditPost(viewerId);
  const auditCommentPostId = await ensureCommentAuditFixturePost(viewerId);
  const auditRunId = randomUUID();
  const persistedFixtures = loadPersistedAuditFixtures();
  const stableTargetUserId =
    process.env.LOCAVA_AUDIT_TARGET_USER_ID?.trim() ||
    (persistedFixtures.targetUserId && (await userExists(persistedFixtures.targetUserId))
      ? persistedFixtures.targetUserId
      : await findFallbackTargetUserId(viewerId));
  const stableSamplePostId =
    process.env.LOCAVA_AUDIT_POST_ID?.trim() ||
    (persistedFixtures.samplePostId && (await postExists(persistedFixtures.samplePostId))
      ? persistedFixtures.samplePostId
      : (await findStableSamplePostId(viewerId)) || (await findFallbackStablePostId()));
  if (!only) {
    persistAuditFixtures({
      targetUserId: stableTargetUserId ?? undefined,
      samplePostId: stableSamplePostId ?? undefined
    });
  }
  const baseState: AuditState = {
    viewerId,
    targetUserId: stableTargetUserId,
    unfollowTargetUserId: null,
    samplePostId: stableSamplePostId,
    unlikePostId: null,
    sampleCommentPostId:
      process.env.LOCAVA_AUDIT_COMMENT_POST_ID?.trim() ||
      existingCommentAuditPostId ||
      stableSamplePostId ||
      auditCommentPostId ||
      null,
    auditCommentPostId,
    sampleCollectionId: process.env.LOCAVA_AUDIT_COLLECTION_ID?.trim() || null,
    tempCollectionId: null,
    seedCollectionItemIds: null,
    sampleConversationId: process.env.LOCAVA_AUDIT_CONVERSATION_ID?.trim() || null,
    sampleCommentId: null,
    sampleMessageId: null,
    sampleNotificationId: null,
    sampleUnreadNotificationId: null,
    uploadSessionId: null,
    mediaId: null,
    operationId: null,
    tempConversationId: null,
    sampleAchievementEventId: null,
  };

  const rows: AuditRow[] = [];
  const specsToRun = only ? specs.filter((spec) => spec.id === only) : specs;
  await resetAuditProcessState();
  let sharedApp: ReturnType<typeof createApp> | null = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  try {
    for (const spec of specsToRun) {
      const state = cloneAuditState(baseState);
      const audit: AuditExecutionContext = {
        auditRunId,
        auditSpecId: `${spec.id}:${randomUUID()}`,
        auditSpecName: spec.id
      };
      const isolation = getAuditIsolationPolicy(spec.id);
      if (isolation.useDedicatedCommentFixturePost) {
        state.sampleCommentPostId = state.auditCommentPostId;
      }
      if (!isolation.useFreshApp) {
        if (!sharedApp) {
          await resetAuditProcessState();
          sharedApp = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
        }
        await executeAuditSpec(sharedApp, spec, state, rows, audit);
        await settleAfterSpec(spec, audit);
        continue;
      }

      if (sharedApp) {
        await sharedApp.close();
        sharedApp = null;
      }
      await resetAuditProcessState();
      const isolatedApp = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
      try {
        await executeAuditSpec(isolatedApp, spec, state, rows, audit);
        await settleAfterSpec(spec, audit);
      } finally {
        await isolatedApp.close();
        if (isolation.useDedicatedCommentFixturePost) {
          await resetCommentAuditFixturePost(state.auditCommentPostId);
        }
        if (isolation.useFreshCollectionFixture) {
          await cleanupFixtureCollection(state.tempCollectionId);
        }
        if (isolation.useFreshConversationFixture) {
          await cleanupFixtureConversation({
            viewerId: state.viewerId,
            targetUserId: state.targetUserId,
            conversationId: state.tempConversationId ?? state.sampleConversationId
          });
        }
        await resetAuditProcessState();
        sharedApp = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
      }
    }
  } finally {
    if (sharedApp) {
      await sharedApp.close();
    }
    await cleanupCommentAuditFixturePost(auditCommentPostId);
    await normalizeViewerPostCounters(baseState.viewerId);
    await resetAuditProcessState();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    auditRunId,
    viewerId: baseState.viewerId,
    only: only || null,
    baselineFixtures: captureFixtureContext(baseState),
    counts: rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.classification] = (acc[row.classification] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  fs.mkdirSync(reportHistoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportHistoryDir, `${summary.generatedAt.replace(/[:.]/g, "-")}--${auditRunId}.json`),
    JSON.stringify(summary, null, 2)
  );

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
