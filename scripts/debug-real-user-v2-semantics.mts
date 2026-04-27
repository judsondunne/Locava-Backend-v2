import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app/createApp.js";
import { diagnosticsStore } from "../src/observability/diagnostics-store.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type SemanticClassification =
  | "SEMANTIC_PASS"
  | "SEMANTIC_PASS_APPROXIMATE"
  | "SEMANTIC_PASS_STAGED"
  | "SEMANTIC_FAIL_WRONG_OWNER"
  | "SEMANTIC_FAIL_MISSING_DOC"
  | "SEMANTIC_FAIL_FAKE_DATA"
  | "SEMANTIC_FAIL_WRONG_ACTIVITY"
  | "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE"
  | "SEMANTIC_FAIL_DUPLICATE"
  | "SEMANTIC_FAIL_CURSOR"
  | "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
  | "SEMANTIC_FAIL_DEEP_LINK"
  | "SEMANTIC_UNTESTED";

type RouteCall = {
  statusCode: number;
  url: string;
  envelope: any;
  requestId: string | null;
  latencyMs: number | null;
};

type SemanticResult = {
  route: string;
  nativeSurface: string;
  scenario: string;
  classification: SemanticClassification;
  latencyMs: number | null;
  sourceFirestoreDocsChecked: string[];
  mismatchDetails: string[];
  fixRecommendation: string;
  fixed: boolean;
};

type PostingProbe = {
  attempted: boolean;
  uploadSessionOk: boolean;
  registerOk: boolean;
  markUploadedOk: boolean;
  finalizeOk: boolean;
  operationSuccess: boolean;
  publicPosterImage: boolean;
  publicVideo: boolean;
  visibleInProfile: boolean;
  visibleInFeed: boolean;
  visibleInMap: boolean;
  postId: string | null;
  operationId: string | null;
  mediaId: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  details: string[];
};

type State = {
  viewerId: string;
  viewerDoc: Record<string, unknown> | null;
  viewerPostId: string | null;
  viewerVideoPostId: string | null;
  viewerImagePostId: string | null;
  tempCommentId: string | null;
  tempCommentCleanupId: string | null;
  tempCommentPostId: string | null;
  tempCollectionId: string | null;
  tempChatId: string | null;
  tempPostId: string | null;
  tempOperationId: string | null;
  sampleFeedPostId: string | null;
  sampleCollectionId: string | null;
  sampleFeedCursor: string | null;
  sampleNotificationId: string | null;
  sampleUnreadNotificationId: string | null;
  sampleChatConversationId: string | null;
  sampleSelfChatConversationId: string | null;
  postingProbe: PostingProbe;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const reportPath = path.join(backendRoot, "tmp", "real-user-v2-semantics-report.json");
const markdownPath = path.join(workspaceRoot, "docs", "real-user-v2-semantics-report-2026-04-25.md");
const only = (() => {
  const idx = process.argv.indexOf("--only");
  return idx >= 0 ? String(process.argv[idx + 1] ?? "").trim().toLowerCase() : "";
})();
const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const app = createApp();
const db = getFirestoreSourceClient();

if (!db) {
  throw new Error("real_user_v2_semantics_requires_firestore_admin");
}

const state: State = {
  viewerId,
  viewerDoc: null,
  viewerPostId: null,
  viewerVideoPostId: null,
  viewerImagePostId: null,
  tempCommentId: null,
  tempCommentCleanupId: null,
  tempCommentPostId: null,
  tempCollectionId: null,
  tempChatId: null,
  tempPostId: null,
  tempOperationId: null,
  sampleFeedPostId: null,
  sampleCollectionId: null,
  sampleFeedCursor: null,
  sampleNotificationId: null,
  sampleUnreadNotificationId: null,
  sampleChatConversationId: null,
  sampleSelfChatConversationId: null,
  postingProbe: {
    attempted: false,
    uploadSessionOk: false,
    registerOk: false,
    markUploadedOk: false,
    finalizeOk: false,
    operationSuccess: false,
    publicPosterImage: false,
    publicVideo: false,
    visibleInProfile: false,
    visibleInFeed: false,
    visibleInMap: false,
    postId: null,
    operationId: null,
    mediaId: null,
    posterUrl: null,
    videoUrl: null,
    details: [],
  },
};

const results: SemanticResult[] = [];

function shouldRun(label: string): boolean {
  return only.length === 0 || label.toLowerCase().includes(only);
}

function diagFor(requestId: string | null) {
  if (!requestId) return null;
  return diagnosticsStore.getRecentRequests(300).find((row) => row.requestId === requestId) ?? null;
}

async function callRoute(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<RouteCall> {
  const res = await app.inject({
    method,
    url,
    headers: {
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
  let envelope: any = null;
  try {
    envelope = JSON.parse(res.body);
  } catch {
    envelope = null;
  }
  const requestId = typeof envelope?.meta?.requestId === "string" ? envelope.meta.requestId : null;
  const diag = diagFor(requestId);
  return {
    statusCode: res.statusCode,
    url,
    envelope,
    requestId,
    latencyMs: typeof diag?.latencyMs === "number" ? diag.latencyMs : null,
  };
}

function addResult(row: Omit<SemanticResult, "fixed">): void {
  results.push({
    ...row,
    fixed: row.classification.startsWith("SEMANTIC_PASS"),
  });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function arr<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter(Boolean));
}

function urlToObjectKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

function mismatchToRecommendation(classification: SemanticClassification): string {
  switch (classification) {
    case "SEMANTIC_FAIL_FAKE_DATA":
      return "Replace seeded or fallback payloads with real Firestore-backed data or fail loudly.";
    case "SEMANTIC_FAIL_MISSING_DOC":
      return "Resolve source-of-truth lookup or stop returning ids that do not exist in Firebase.";
    case "SEMANTIC_FAIL_WRONG_OWNER":
      return "Fix ownership filtering and viewer scoping at the repository/orchestrator layer.";
    case "SEMANTIC_FAIL_WRONG_ACTIVITY":
      return "Tighten search/filter normalization so returned rows actually match the requested activity/location.";
    case "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE":
      return "Return only collection entities for collection surfaces and remove mixes/foreign types.";
    case "SEMANTIC_FAIL_DUPLICATE":
      return "Deduplicate ids before serializing route payloads and enforce cursor-safe pagination.";
    case "SEMANTIC_FAIL_CURSOR":
      return "Fix cursor encoding/decoding or page-window source queries so pagination remains stable.";
    case "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED":
      return "Persist the mutation to Firestore and verify route invalidation/state projections after write.";
    case "SEMANTIC_FAIL_DEEP_LINK":
      return "Return stable target ids/metadata so Native can deterministically navigate or show a visible error.";
    case "SEMANTIC_UNTESTED":
      return "Add a stable dev-fixture or safe write path so this scenario can be exercised end-to-end.";
    default:
      return "No action needed.";
  }
}

async function getUserDoc(userId: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>) ?? {}) : null;
}

async function getPostDoc(postId: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection("posts").doc(postId).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>) ?? {}) : null;
}

async function getPostCommentDocs(postId: string): Promise<Array<Record<string, unknown>>> {
  const snap = await db.collection("posts").doc(postId).collection("comments").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
}

async function getCollectionDoc(collectionId: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection("collections").doc(collectionId).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>) ?? {}) : null;
}

async function getChatDoc(conversationId: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection("chats").doc(conversationId).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>) ?? {}) : null;
}

async function getChatMessageDocs(conversationId: string, limit = 20): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snap = await db
    .collection("chats")
    .doc(conversationId)
    .collection("messages")
    .orderBy("timestamp", "desc")
    .orderBy("__name__", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, data: (doc.data() as Record<string, unknown>) ?? {} }));
}

async function getNotificationDoc(id: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection("users").doc(viewerId).collection("notifications").doc(id).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>) ?? {}) : null;
}

async function ensureUnreadNotificationFixture(): Promise<string> {
  if (state.sampleUnreadNotificationId) return state.sampleUnreadNotificationId;
  const fixtureId = `audit_notification_${Date.now()}`;
  await db.collection("users").doc("locava_audit").set(
    {
      handle: "locava_audit",
      name: "Locava Audit",
      profilePic: null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  await db.collection("users").doc(viewerId).collection("notifications").doc(fixtureId).set({
    type: "system",
    senderUserId: "locava_audit",
    message: "Audit notification fixture",
    read: false,
    timestamp: new Date()
  });
  state.sampleUnreadNotificationId = fixtureId;
  return fixtureId;
}

async function loadViewerFollowingIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const embedded = arr<string>(state.viewerDoc?.following);
  embedded.forEach((id) => {
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  });
  const snap = await db.collection("users").doc(viewerId).collection("following").select().limit(500).get();
  for (const doc of snap.docs) ids.add(doc.id);
  return ids;
}

async function countViewerPosts(): Promise<number> {
  const count = await db.collection("posts").where("userId", "==", viewerId).count().get();
  return Number(count.data().count ?? 0);
}

function extractPostComments(postDoc: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return arr<Record<string, unknown>>(postDoc?.comments).filter((entry) => entry && typeof entry === "object");
}

async function loadMergedPostComments(postId: string, postDoc?: Record<string, unknown> | null): Promise<Array<Record<string, unknown>>> {
  const embedded = extractPostComments(postDoc ?? (await getPostDoc(postId)));
  const canonical = await getPostCommentDocs(postId);
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of canonical) {
    const id = str(row.id) ?? str(row.commentId);
    if (id) merged.set(id, row);
  }
  for (const row of embedded) {
    const id = str(row.id) ?? str(row.commentId);
    if (id && !merged.has(id)) merged.set(id, row);
  }
  return [...merged.values()];
}

function extractPostActivities(postDoc: Record<string, unknown> | null): string[] {
  return arr<string>(postDoc?.activities).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
}

function extractPostText(postDoc: Record<string, unknown> | null): string {
  const row = postDoc ?? {};
  return [
    str(row.title),
    str(row.content),
    str(row.description),
    str(row.address),
    str(obj(row.geoData).city),
    str(obj(row.geoData).state),
    str(obj(row.geoData).country),
    ...extractPostActivities(row),
    ...arr<string>(row.tags).map((value) => String(value)),
  ]
    .filter(Boolean)
    .join(" ");
}

function matchActivityQuery(postDoc: Record<string, unknown> | null, query: string): boolean {
  const queryTokens = tokenSet(query);
  if (queryTokens.size === 0) return false;
  const haystackTokens = tokenSet(extractPostText(postDoc));
  for (const token of queryTokens) {
    if (!haystackTokens.has(token)) return false;
  }
  return true;
}

async function probePublicUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

async function seedState(): Promise<void> {
  state.viewerDoc = await getUserDoc(viewerId);
  const viewerPosts = await db.collection("posts").where("userId", "==", viewerId).limit(30).get();
  for (const doc of viewerPosts.docs) {
    const data = (doc.data() as Record<string, unknown>) ?? {};
    if (!state.viewerPostId) state.viewerPostId = doc.id;
    const assets = arr<Record<string, unknown>>(data.assets);
    const firstVideo = assets.find((asset) => str(asset.type) === "video");
    const firstImage = assets.find((asset) => str(asset.type) === "image");
    if (!state.viewerVideoPostId && firstVideo) state.viewerVideoPostId = doc.id;
    if (!state.viewerImagePostId && firstImage) state.viewerImagePostId = doc.id;
  }
  const selfChatSnap = await db
    .collection("chats")
    .where("participants", "array-contains", viewerId)
    .limit(20)
    .get();
  for (const doc of selfChatSnap.docs) {
    const data = (doc.data() as Record<string, unknown>) ?? {};
    const participants = arr<string>(data.participants);
    if (!state.sampleChatConversationId) state.sampleChatConversationId = doc.id;
    if (!state.sampleSelfChatConversationId && (participants.length <= 1 || data.isGroupChat === true)) {
      state.sampleSelfChatConversationId = doc.id;
    }
  }
}

async function runAuthSessionScenario(): Promise<void> {
  const call = await callRoute("GET", "/v2/auth/session");
  const data = obj(call.envelope?.data);
  const viewer = obj(obj(data.firstRender).viewer);
  const summary = obj(obj(data.deferred).viewerSummary);
  const mismatches: string[] = [];
  if (str(viewer.id) !== viewerId) mismatches.push(`viewer id mismatch: expected ${viewerId}, received ${String(viewer.id ?? "")}`);
  if (str(summary.handle) !== str(state.viewerDoc?.handle)) {
    mismatches.push(`viewerSummary.handle mismatch: expected ${String(state.viewerDoc?.handle ?? "")}, received ${String(summary.handle ?? "")}`);
  }
  const classification =
    mismatches.length === 0
      ? "SEMANTIC_PASS"
      : str(summary.handle)?.startsWith("user_")
        ? "SEMANTIC_FAIL_FAKE_DATA"
        : "SEMANTIC_FAIL_MISSING_DOC";
  addResult({
    route: "/v2/auth/session",
    nativeSurface: "Locava-Native/src/data/auth/signedInV2Bootstrap.ts",
    scenario: "AUTH / SESSION returns the real viewer id and summary",
    classification,
    latencyMs: call.latencyMs,
    sourceFirestoreDocsChecked: [`users/${viewerId}`],
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(classification),
  });
}

async function runFeedScenarios(): Promise<void> {
  const bootstrap = await callRoute("GET", "/v2/feed/bootstrap?limit=4&tab=explore");
  const bootstrapData = obj(bootstrap.envelope?.data);
  const feed = obj(obj(bootstrapData.firstRender).feed);
  const page = obj(feed.page);
  const items = arr<Record<string, unknown>>(feed.items);
  const mismatches: string[] = [];
  const ids = items.map((item) => String(item.postId ?? ""));
  if (uniq(ids).length !== ids.length) mismatches.push("bootstrap returned duplicate post ids");
  for (const item of items) {
    const postId = str(item.postId);
    if (!postId) {
      mismatches.push("bootstrap item missing postId");
      continue;
    }
    const postDoc = await getPostDoc(postId);
    if (!postDoc) {
      mismatches.push(`feed post missing in Firestore: posts/${postId}`);
      continue;
    }
    const authorId = str(obj(item.author).userId);
    if (authorId) {
      const authorDoc = await getUserDoc(authorId);
      if (!authorDoc) mismatches.push(`feed author missing: users/${authorId}`);
    }
    const media = obj(item.media);
    if (!str(media.posterUrl) && !str(item.firstAssetUrl)) {
      mismatches.push(`feed item ${postId} missing media url strings`);
    }
  }
  state.sampleFeedPostId = ids[0] ?? null;
  state.sampleFeedCursor = str(page.nextCursor);
  addResult({
    route: "/v2/feed/bootstrap",
    nativeSurface: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
    scenario: "FEED bootstrap rows exist in Firestore, have real authors/media, and are unique",
    classification:
      mismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : mismatches.some((m) => m.includes("duplicate"))
          ? "SEMANTIC_FAIL_DUPLICATE"
          : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: bootstrap.latencyMs,
    sourceFirestoreDocsChecked: ids.map((id) => `posts/${id}`),
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(
      mismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : mismatches.some((m) => m.includes("duplicate"))
          ? "SEMANTIC_FAIL_DUPLICATE"
          : "SEMANTIC_FAIL_MISSING_DOC"
    ),
  });

  if (state.sampleFeedCursor) {
    const pageCall = await callRoute("GET", `/v2/feed/page?limit=4&cursor=${encodeURIComponent(state.sampleFeedCursor)}&tab=explore`);
    const pageData = obj(pageCall.envelope?.data);
    const pageItems = arr<Record<string, unknown>>(pageData.items);
    const pageIds = pageItems.map((item) => String(item.postId ?? ""));
    const overlap = pageIds.filter((id) => ids.includes(id));
    addResult({
      route: "/v2/feed/page",
      nativeSurface: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
      scenario: "FEED page cursor returns next rows without duplicating bootstrap ids",
      classification: overlap.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_CURSOR",
      latencyMs: pageCall.latencyMs,
      sourceFirestoreDocsChecked: pageIds.map((id) => `posts/${id}`),
      mismatchDetails: overlap.length === 0 ? [] : [`page duplicated bootstrap ids: ${overlap.join(", ")}`],
      fixRecommendation: mismatchToRecommendation(overlap.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_CURSOR"),
    });
  } else {
    addResult({
      route: "/v2/feed/page",
      nativeSurface: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
      scenario: "FEED page cursor returns next rows without duplicating bootstrap ids",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: ["bootstrap response did not provide nextCursor"],
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
  }

  const followingIds = await loadViewerFollowingIds();
  const following = await callRoute("GET", "/v2/feed/bootstrap?limit=4&tab=following");
  const followingItems = arr<Record<string, unknown>>(obj(obj(following.envelope?.data).firstRender).feed.items);
  const offending = followingItems.filter((item) => {
    const authorId = str(obj(item.author).userId);
    return authorId ? !followingIds.has(authorId) : true;
  });
  const followingClassification =
    offending.length === 0
      ? followingItems.length === 0
        ? "SEMANTIC_PASS_APPROXIMATE"
        : "SEMANTIC_PASS"
      : "SEMANTIC_FAIL_WRONG_OWNER";
  addResult({
    route: "/v2/feed/bootstrap?tab=following",
    nativeSurface: "Locava-Native/src/features/home/backendv2/feedV2.repository.ts",
    scenario: "FEED following tab only returns followed authors or truthfully returns empty",
    classification: followingClassification,
    latencyMs: following.latencyMs,
    sourceFirestoreDocsChecked: [
      `users/${viewerId}`,
      ...followingItems.map((item) => `posts/${String(item.postId ?? "")}`),
    ],
    mismatchDetails:
      offending.length === 0
        ? followingItems.length === 0
          ? [`following feed returned empty; viewer currently follows ${followingIds.size} users`]
          : []
        : offending.map((item) => `following feed included non-followed author ${String(obj(item.author).userId ?? "")}`),
    fixRecommendation: mismatchToRecommendation(followingClassification),
  });
}

async function runSearchScenarios(): Promise<void> {
  const suggest = await callRoute("GET", "/v2/search/suggest?q=hiking");
  const suggestData = obj(suggest.envelope?.data);
  const suggestions = arr<Record<string, unknown>>(suggestData.suggestions);
  const suggestHasQuery =
    suggestions.some((row) => normalizeText(str(row.text)).includes("hiking")) ||
    normalizeText(str(suggestData.detectedActivity)) === "hiking" ||
    arr<string>(suggestData.relatedActivities).some((value) => normalizeText(value) === "hiking");
  addResult({
    route: "/v2/search/suggest",
    nativeSurface: "Locava-Native/src/features/search/useSearchAutofill.ts",
    scenario: "SEARCH suggest returns real or cached hiking-derived suggestions without placeholders",
    classification: suggestHasQuery ? "SEMANTIC_PASS_APPROXIMATE" : "SEMANTIC_FAIL_WRONG_ACTIVITY",
    latencyMs: suggest.latencyMs,
    sourceFirestoreDocsChecked: ["posts/* where activities/title contain hiking"],
    mismatchDetails: suggestHasQuery ? [] : ["suggest output did not reflect the hiking query"],
    fixRecommendation: mismatchToRecommendation(suggestHasQuery ? "SEMANTIC_PASS_APPROXIMATE" : "SEMANTIC_FAIL_WRONG_ACTIVITY"),
  });

  const bootstrap = await callRoute("GET", "/v2/search/bootstrap?q=hiking&limit=8");
  const bootstrapData = obj(bootstrap.envelope?.data);
  const bootstrapPosts = arr<Record<string, unknown>>(bootstrapData.posts);
  const bootstrapMismatches: string[] = [];
  for (const row of bootstrapPosts) {
    const postId = str(row.postId) ?? str(row.id);
    if (!postId) continue;
    const postDoc = await getPostDoc(postId);
    if (!postDoc) {
      bootstrapMismatches.push(`search bootstrap returned missing post ${postId}`);
      continue;
    }
    if (!matchActivityQuery(postDoc, "hiking")) {
      bootstrapMismatches.push(`search bootstrap post ${postId} does not semantically match hiking`);
    }
  }
  addResult({
    route: "/v2/search/bootstrap",
    nativeSurface: "Locava-Native/src/features/search/useSearchBootstrapPosts.ts",
    scenario: "SEARCH bootstrap rails contain real hiking-matching posts",
    classification:
      bootstrapMismatches.length === 0 ? "SEMANTIC_PASS_APPROXIMATE" : "SEMANTIC_FAIL_WRONG_ACTIVITY",
    latencyMs: bootstrap.latencyMs,
    sourceFirestoreDocsChecked: bootstrapPosts.map((row) => `posts/${String(row.postId ?? row.id ?? "")}`),
    mismatchDetails: bootstrapMismatches,
    fixRecommendation: mismatchToRecommendation(
      bootstrapMismatches.length === 0 ? "SEMANTIC_PASS_APPROXIMATE" : "SEMANTIC_FAIL_WRONG_ACTIVITY"
    ),
  });

  const posts = await callRoute("GET", "/v2/search/results?q=hiking&types=posts&limit=8");
  const postsItems = arr<Record<string, unknown>>(obj(posts.envelope?.data).items);
  const postMismatches: string[] = [];
  for (const row of postsItems) {
    const postId = str(row.postId);
    if (!postId) continue;
    const postDoc = await getPostDoc(postId);
    if (!postDoc) {
      postMismatches.push(`search results returned missing post ${postId}`);
      continue;
    }
    if (!matchActivityQuery(postDoc, "hiking")) {
      postMismatches.push(`search results post ${postId} does not match hiking`);
    }
  }
  addResult({
    route: "/v2/search/results",
    nativeSurface: "Locava-Native/src/features/search/backendv2/searchV2.repository.ts",
    scenario: "SEARCH results for posts semantically match hiking",
    classification: postMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_ACTIVITY",
    latencyMs: posts.latencyMs,
    sourceFirestoreDocsChecked: postsItems.map((row) => `posts/${String(row.postId ?? "")}`),
    mismatchDetails: postMismatches,
    fixRecommendation: mismatchToRecommendation(postMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_ACTIVITY"),
  });

  const collections = await callRoute("GET", "/v2/search/results?q=hiking&types=collections&limit=8");
  const collectionItems = arr<Record<string, unknown>>(obj(obj(collections.envelope?.data).sections).collections?.items);
  const collectionMismatches: string[] = [];
  for (const row of collectionItems) {
    const collectionId = str(row.collectionId) ?? str(row.id);
    const title = normalizeText(str(row.title));
    const doc = collectionId ? await getCollectionDoc(collectionId) : null;
    if (!collectionId || !doc) {
      collectionMismatches.push(`collections search returned missing collection ${collectionId ?? "<missing>"}`);
      continue;
    }
    if (!title.includes("hiking") && !normalizeText(str(doc.name)).includes("hiking")) {
      collectionMismatches.push(`collection ${collectionId} does not match hiking`);
    }
  }
  addResult({
    route: "/v2/search/results?types=collections",
    nativeSurface: "Locava-Native/src/features/togo/togo.api.ts",
    scenario: "SEARCH results for collections return real collections and not mixes",
    classification:
      collectionMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE",
    latencyMs: collections.latencyMs,
    sourceFirestoreDocsChecked: collectionItems.map((row) => `collections/${String(row.collectionId ?? row.id ?? "")}`),
    mismatchDetails: collectionMismatches,
    fixRecommendation: mismatchToRecommendation(
      collectionMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE"
    ),
  });

  const users = await callRoute("GET", "/v2/search/users?q=judson&limit=10");
  const userItems = arr<Record<string, unknown>>(obj(users.envelope?.data).items);
  const userMismatches: string[] = [];
  if (users.statusCode !== 200) {
    userMismatches.push(`search users returned ${users.statusCode}`);
  }
  for (const row of userItems) {
    const userId = str(row.userId);
    const doc = userId ? await getUserDoc(userId) : null;
    if (!userId || !doc) {
      userMismatches.push(`search users returned missing user ${userId ?? "<missing>"}`);
      continue;
    }
    if (normalizeText(str(row.handle)).includes("placeholder")) {
      userMismatches.push(`search users returned placeholder handle for ${userId}`);
    }
  }
  addResult({
    route: "/v2/search/users",
    nativeSurface: "Locava-Native/src/features/search/backendv2/searchV2.repository.ts",
    scenario: "SEARCH users returns real users and no placeholder rows",
    classification: userMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: users.latencyMs,
    sourceFirestoreDocsChecked: userItems.map((row) => `users/${String(row.userId ?? "")}`),
    mismatchDetails: userMismatches,
    fixRecommendation: mismatchToRecommendation(userMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA"),
  });
}

async function runMapScenarios(): Promise<void> {
  const markers = await callRoute("GET", "/v2/map/markers?limit=20");
  const markerRows = arr<Record<string, unknown>>(obj(markers.envelope?.data).markers);
  const markerMismatches: string[] = [];
  for (const row of markerRows.slice(0, 10)) {
    const postId = str(row.postId);
    const postDoc = postId ? await getPostDoc(postId) : null;
    if (!postId || !postDoc) {
      markerMismatches.push(`map marker missing post ${postId ?? "<missing>"}`);
      continue;
    }
    const lat = num(row.lat);
    const lng = num(row.lng);
    if (lat == null || lng == null) markerMismatches.push(`map marker ${postId} missing lat/lng`);
    const sourceLat = num(postDoc.lat);
    const sourceLng = num(postDoc.long);
    if (sourceLat != null && lat != null && Math.abs(sourceLat - lat) > 0.0001) {
      markerMismatches.push(`map marker ${postId} lat does not match source post`);
    }
    if (sourceLng != null && lng != null && Math.abs(sourceLng - lng) > 0.0001) {
      markerMismatches.push(`map marker ${postId} lng does not match source post`);
    }
    const markerActivity = normalizeText(str(row.activity));
    const sourceActivities = extractPostActivities(postDoc);
    if (markerActivity && sourceActivities.length > 0 && !sourceActivities.includes(markerActivity)) {
      markerMismatches.push(`map marker ${postId} activity ${markerActivity} does not match source activities ${sourceActivities.join(", ")}`);
    }
  }
  addResult({
    route: "/v2/map/markers",
    nativeSurface: "Locava-Native/src/features/map/backendv2/mapV2.repository.ts",
    scenario: "MAP markers point at real posts with stable coordinates and matching activity",
    classification: markerMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: markers.latencyMs,
    sourceFirestoreDocsChecked: markerRows.slice(0, 10).map((row) => `posts/${String(row.postId ?? "")}`),
    mismatchDetails: markerMismatches,
    fixRecommendation: mismatchToRecommendation(markerMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC"),
  });

  const markerForBootstrap = markerRows.find((row) => num(row.lat) != null && num(row.lng) != null);
  if (!markerForBootstrap) {
    addResult({
      route: "/v2/map/bootstrap",
      nativeSurface: "No direct Native caller",
      scenario: "MAP bootstrap returns staged shell marker summaries",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: ["no marker available to derive bbox"],
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
    return;
  }
  const lat = num(markerForBootstrap.lat)!;
  const lng = num(markerForBootstrap.lng)!;
  const bbox = `${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}`;
  const bootstrap = await callRoute("GET", `/v2/map/bootstrap?bbox=${encodeURIComponent(bbox)}&limit=20`);
  const bootstrapMarkers = arr<Record<string, unknown>>(obj(bootstrap.envelope?.data).markers);
  const staged = bootstrapMarkers.every((row) => !("title" in row) && !("description" in row) && !("author" in row));
  addResult({
    route: "/v2/map/bootstrap",
    nativeSurface: "No direct Native caller",
    scenario: "MAP bootstrap stays at marker-shell detail instead of full post payloads",
    classification: staged ? "SEMANTIC_PASS_STAGED" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: bootstrap.latencyMs,
    sourceFirestoreDocsChecked: bootstrapMarkers.slice(0, 5).map((row) => `posts/${String(row.postId ?? "")}`),
    mismatchDetails: staged ? [] : ["map bootstrap returned richer-than-shell marker rows"],
    fixRecommendation: mismatchToRecommendation(staged ? "SEMANTIC_PASS_STAGED" : "SEMANTIC_FAIL_FAKE_DATA"),
  });
}

async function runProfileScenarios(): Promise<void> {
  const bootstrap = await callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=8`);
  const data = obj(bootstrap.envelope?.data);
  const firstRender = obj(data.firstRender);
  const profile = obj(firstRender.profile);
  const counts = obj(firstRender.counts);
  const gridPreviewItems = arr<Record<string, unknown>>(obj(firstRender.gridPreview).items);
  const mismatches: string[] = [];
  if (str(profile.handle) !== str(state.viewerDoc?.handle)) mismatches.push(`profile handle mismatch: expected ${String(state.viewerDoc?.handle ?? "")}, received ${String(profile.handle ?? "")}`);
  const actualPostCount = await countViewerPosts();
  if (num(counts.posts) !== actualPostCount) mismatches.push(`profile post count mismatch: expected ${actualPostCount}, received ${String(counts.posts ?? "")}`);
  for (const item of gridPreviewItems) {
    const postId = str(item.postId);
    const postDoc = postId ? await getPostDoc(postId) : null;
    if (!postId || !postDoc) {
      mismatches.push(`profile grid preview returned missing post ${postId ?? "<missing>"}`);
      continue;
    }
    if (str(postDoc.userId) !== viewerId) mismatches.push(`profile grid preview post ${postId} is owned by ${String(postDoc.userId ?? "")}`);
  }
  addResult({
    route: `/v2/profiles/${viewerId}/bootstrap`,
    nativeSurface: "Locava-Native/src/features/profile/backendv2/profileV2.repository.ts",
    scenario: "PROFILE bootstrap matches users doc and preview posts belong to the profile user",
    classification:
      mismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : mismatches.some((m) => m.includes("owned by"))
          ? "SEMANTIC_FAIL_WRONG_OWNER"
          : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: bootstrap.latencyMs,
    sourceFirestoreDocsChecked: [`users/${viewerId}`, ...gridPreviewItems.map((item) => `posts/${String(item.postId ?? "")}`)],
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(
      mismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : mismatches.some((m) => m.includes("owned by"))
          ? "SEMANTIC_FAIL_WRONG_OWNER"
          : "SEMANTIC_FAIL_MISSING_DOC"
    ),
  });

  const grid = await callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/grid?limit=8`);
  const gridData = obj(grid.envelope?.data);
  const page = obj(gridData.page);
  const items = arr<Record<string, unknown>>(gridData.items);
  const gridMismatches: string[] = [];
  for (const item of items) {
    const postId = str(item.postId);
    const postDoc = postId ? await getPostDoc(postId) : null;
    if (!postId || !postDoc) {
      gridMismatches.push(`profile grid returned missing post ${postId ?? "<missing>"}`);
      continue;
    }
    if (str(postDoc.userId) !== viewerId) gridMismatches.push(`profile grid returned foreign post ${postId}`);
  }
  const nextCursor = str(page.nextCursor);
  if (nextCursor) {
    const nextPage = await callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/grid?limit=8&cursor=${encodeURIComponent(nextCursor)}`);
    const nextItems = arr<Record<string, unknown>>(obj(nextPage.envelope?.data).items);
    const overlap = nextItems
      .map((item) => str(item.postId))
      .filter((id): id is string => Boolean(id))
      .filter((id) => items.some((item) => str(item.postId) === id));
    if (overlap.length > 0) gridMismatches.push(`profile grid next page duplicated ids ${overlap.join(", ")}`);
  }
  addResult({
    route: `/v2/profiles/${viewerId}/grid`,
    nativeSurface: "Locava-Native/src/features/profile/backendv2/profileV2.repository.ts",
    scenario: "PROFILE grid cursor works and only returns profile-owned posts",
    classification:
      gridMismatches.length === 0
        ? "SEMANTIC_PASS"
        : gridMismatches.some((m) => m.includes("duplicated"))
          ? "SEMANTIC_FAIL_CURSOR"
          : "SEMANTIC_FAIL_WRONG_OWNER",
    latencyMs: grid.latencyMs,
    sourceFirestoreDocsChecked: items.map((item) => `posts/${String(item.postId ?? "")}`),
    mismatchDetails: gridMismatches,
    fixRecommendation: mismatchToRecommendation(
      gridMismatches.length === 0
        ? "SEMANTIC_PASS"
        : gridMismatches.some((m) => m.includes("duplicated"))
          ? "SEMANTIC_FAIL_CURSOR"
          : "SEMANTIC_FAIL_WRONG_OWNER"
    ),
  });

  const detailPostId = state.viewerVideoPostId ?? state.viewerPostId;
  if (!detailPostId) return;
  const detail = await callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/posts/${encodeURIComponent(detailPostId)}/detail`);
  const detailData = obj(detail.envelope?.data);
  const post = obj(obj(detailData.firstRender).post);
  const author = obj(obj(detailData.firstRender).author);
  const postDoc = await getPostDoc(detailPostId);
  const detailMismatches: string[] = [];
  if (!postDoc) detailMismatches.push(`post doc missing for ${detailPostId}`);
  if (str(post.postId) !== detailPostId) detailMismatches.push(`profile post detail returned wrong post id ${String(post.postId ?? "")}`);
  if (str(post.userId) !== viewerId) detailMismatches.push(`profile post detail returned wrong owner ${String(post.userId ?? "")}`);
  if (str(author.userId) !== viewerId) detailMismatches.push(`profile post detail author mismatch ${String(author.userId ?? "")}`);
  addResult({
    route: `/v2/profiles/${viewerId}/posts/:postId/detail`,
    nativeSurface: "Locava-Native/src/features/profile/backendv2/profileV2.repository.ts",
    scenario: "PROFILE post detail matches the selected Firestore post",
    classification:
      detailMismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : detailMismatches.some((m) => m.includes("wrong owner"))
          ? "SEMANTIC_FAIL_WRONG_OWNER"
          : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: detail.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${detailPostId}`, `users/${viewerId}`],
    mismatchDetails: detailMismatches,
    fixRecommendation: mismatchToRecommendation(
      detailMismatches.length === 0
        ? "SEMANTIC_PASS_STAGED"
        : detailMismatches.some((m) => m.includes("wrong owner"))
          ? "SEMANTIC_FAIL_WRONG_OWNER"
          : "SEMANTIC_FAIL_MISSING_DOC"
    ),
  });
}

async function runPostsDetailScenario(): Promise<void> {
  const postId = state.viewerVideoPostId ?? state.viewerPostId ?? state.sampleFeedPostId;
  if (!postId) return;
  const call = await callRoute("GET", `/v2/posts/${encodeURIComponent(postId)}/detail`);
  const data = obj(call.envelope?.data);
  const post = obj(obj(data.firstRender).post);
  const author = obj(obj(data.firstRender).author);
  const social = obj(obj(data.firstRender).social);
  const postDoc = await getPostDoc(postId);
  const authorId = str(post.userId);
  const authorDoc = authorId ? await getUserDoc(authorId) : null;
  const mismatches: string[] = [];
  if (!postDoc) mismatches.push(`post missing in Firestore: posts/${postId}`);
  if (!authorDoc) mismatches.push(`author missing in Firestore: users/${authorId ?? ""}`);
  if (str(post.postId) !== postId) mismatches.push(`posts.detail returned wrong post id ${String(post.postId ?? "")}`);
  if (authorId && str(author.userId) !== authorId) mismatches.push(`posts.detail author summary mismatch ${String(author.userId ?? "")}`);
  const commentCountRaw = (await loadMergedPostComments(postId, postDoc)).length;
  const likeCountDoc = arr<string>(postDoc?.likedBy).length;
  if (num(social.commentCount) != null && Math.abs(Number(social.commentCount) - commentCountRaw) > 0) {
    mismatches.push(`posts.detail comment count mismatch: expected ${commentCountRaw}, received ${String(social.commentCount)}`);
  }
  if (num(social.likeCount) != null && likeCountDoc > 0 && Math.abs(Number(social.likeCount) - likeCountDoc) > 0) {
    mismatches.push(`posts.detail like count mismatch: expected ${likeCountDoc}, received ${String(social.likeCount)}`);
  }
  addResult({
    route: "/v2/posts/:postId/detail",
    nativeSurface: "Locava-Native/src/features/liftable/backendv2/postViewerDetailV2.repository.ts",
    scenario: "POST DETAIL returns a real post with stable author/social semantics",
    classification:
      mismatches.length === 0 ? "SEMANTIC_PASS_STAGED" : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: call.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${postId}`, ...(authorId ? [`users/${authorId}`] : [])],
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(mismatches.length === 0 ? "SEMANTIC_PASS_STAGED" : "SEMANTIC_FAIL_MISSING_DOC"),
  });
}

async function runCommentsScenarios(): Promise<void> {
  const postId = state.viewerVideoPostId ?? state.viewerPostId;
  if (!postId) return;

  const list = await callRoute("GET", `/v2/posts/${encodeURIComponent(postId)}/comments?limit=10`);
  const listItems = arr<Record<string, unknown>>(obj(list.envelope?.data).items);
  const stableDeepLinkCommentId = str(listItems[0]?.commentId);
  const postDocBefore = await getPostDoc(postId);
  const sourceComments = await loadMergedPostComments(postId, postDocBefore);
  const listMismatches: string[] = [];
  for (const row of listItems) {
    const commentId = str(row.commentId);
    if (!commentId) continue;
    if (!sourceComments.some((entry) => str(entry.id) === commentId)) {
      listMismatches.push(`comments list returned missing canonical comment ${commentId}`);
    }
  }
  addResult({
    route: "/v2/posts/:postId/comments",
    nativeSurface: "Locava-Native/src/features/comments/backendv2/commentsV2.repository.ts",
    scenario: "COMMENTS list returns real comments for the post",
    classification: listMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: list.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${postId}`, `posts/${postId}/comments/*`],
    mismatchDetails: listMismatches,
    fixRecommendation: mismatchToRecommendation(listMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC"),
  });

  const commentText = `semantic-harness-${Date.now()}`;
  const commentKey = `semantic-${Date.now()}`;
  const create = await callRoute("POST", `/v2/posts/${encodeURIComponent(postId)}/comments`, {
    text: commentText,
    clientMutationKey: commentKey,
  });
  const createData = obj(create.envelope?.data);
  const createdComment = obj(createData.comment);
  const createdCommentId = str(createdComment.commentId);
  state.tempCommentId = stableDeepLinkCommentId;
  state.tempCommentPostId = stableDeepLinkCommentId ? postId : null;
  const postDocAfterCreate = await getPostDoc(postId);
  const persistedComment = (await loadMergedPostComments(postId, postDocAfterCreate)).find((entry) => str(entry.id) === createdCommentId);
  addResult({
    route: "/v2/posts/:postId/comments",
    nativeSurface: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    scenario: "COMMENTS create writes a real comment doc/embedded row",
    classification:
      create.statusCode === 200 && createdCommentId && persistedComment && str(persistedComment.content) === commentText
        ? "SEMANTIC_PASS"
        : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: create.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${postId}`, `posts/${postId}/comments/${createdCommentId ?? "<missing>"}`],
    mismatchDetails:
      create.statusCode === 200 && createdCommentId && persistedComment && str(persistedComment.content) === commentText
        ? []
        : [`created comment ${createdCommentId ?? "<missing>"} did not persist with expected text`],
    fixRecommendation: mismatchToRecommendation(
      create.statusCode === 200 && createdCommentId && persistedComment && str(persistedComment.content) === commentText
        ? "SEMANTIC_PASS"
        : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
    ),
  });

  if (!createdCommentId) return;

  const like = await callRoute("POST", `/v2/comments/${encodeURIComponent(createdCommentId)}/like`, {});
  const postDocAfterLike = await getPostDoc(postId);
  const likedComment = (await loadMergedPostComments(postId, postDocAfterLike)).find((entry) => str(entry.id) === createdCommentId);
  const likedBy = arr<string>(likedComment?.likedBy);
  addResult({
    route: "/v2/comments/:commentId/like",
    nativeSurface: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    scenario: "COMMENTS like updates persisted likedBy state",
    classification:
      like.statusCode === 200 && likedBy.includes(viewerId) ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: like.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${postId}`, `posts/${postId}/comments/${createdCommentId}`],
    mismatchDetails:
      like.statusCode === 200 && likedBy.includes(viewerId)
        ? []
        : [`likedBy for comment ${createdCommentId} does not include viewer ${viewerId}`],
    fixRecommendation: mismatchToRecommendation(
      like.statusCode === 200 && likedBy.includes(viewerId) ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
    ),
  });

  const del = await callRoute("DELETE", `/v2/comments/${encodeURIComponent(createdCommentId)}`);
  const postDocAfterDelete = await getPostDoc(postId);
  const deletedStillPresent = (await loadMergedPostComments(postId, postDocAfterDelete)).some((entry) => str(entry.id) === createdCommentId);
  addResult({
    route: "/v2/comments/:commentId",
    nativeSurface: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
    scenario: "COMMENTS delete removes or tombstones consistently",
    classification:
      del.statusCode === 200 && !deletedStillPresent ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: del.latencyMs,
    sourceFirestoreDocsChecked: [`posts/${postId}`, `posts/${postId}/comments/${createdCommentId}`],
    mismatchDetails:
      del.statusCode === 200 && !deletedStillPresent
        ? []
        : [`comment ${createdCommentId} is still present in canonical Firestore comment storage after delete`],
    fixRecommendation: mismatchToRecommendation(
      del.statusCode === 200 && !deletedStillPresent ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
    ),
  });

  if (!stableDeepLinkCommentId) {
    const deepLinkSeed = `semantic-deeplink-${Date.now()}`;
    const deepLinkCreate = await callRoute("POST", `/v2/posts/${encodeURIComponent(postId)}/comments`, {
      text: deepLinkSeed,
      clientMutationKey: `${deepLinkSeed}-key`,
    });
    const deepLinkCommentId = str(obj(obj(deepLinkCreate.envelope?.data).comment).commentId);
    if (deepLinkCreate.statusCode === 200 && deepLinkCommentId) {
      state.tempCommentId = deepLinkCommentId;
      state.tempCommentCleanupId = deepLinkCommentId;
      state.tempCommentPostId = postId;
    }
  }
}

async function runCollectionsScenarios(): Promise<void> {
  const list = await callRoute("GET", "/v2/collections?limit=10");
  const items = arr<Record<string, unknown>>(obj(list.envelope?.data).items);
  state.sampleCollectionId = str(items[0]?.id) ?? state.sampleCollectionId;
  const listMismatches: string[] = [];
  for (const row of items) {
    const collectionId = str(row.id);
    const doc = collectionId ? await getCollectionDoc(collectionId) : null;
    if (!collectionId || !doc) {
      listMismatches.push(`collections list returned missing collection ${collectionId ?? "<missing>"}`);
      continue;
    }
    const ownerId = str(doc.ownerId ?? doc.userId);
    const collaborators = new Set(arr<string>(doc.collaborators));
    if (ownerId !== viewerId && !collaborators.has(viewerId)) {
      listMismatches.push(`collections list returned foreign collection ${collectionId}`);
    }
  }
  addResult({
    route: "/v2/collections",
    nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionsV2.repository.ts",
    scenario: "COLLECTIONS list returns only viewer collections/collaborations and not mixes",
    classification:
      listMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE",
    latencyMs: list.latencyMs,
    sourceFirestoreDocsChecked: items.map((row) => `collections/${String(row.id ?? "")}`),
    mismatchDetails: listMismatches,
    fixRecommendation: mismatchToRecommendation(
      listMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE"
    ),
  });

  const tempName = `Semantic ${Date.now()}`;
  const create = await callRoute("POST", "/v2/collections", {
    name: tempName,
    description: "real-user semantic harness",
    privacy: "private",
    collaborators: [],
    items: [],
  });
  const tempCollectionId = str(obj(create.envelope?.data).collectionId);
  state.tempCollectionId = tempCollectionId;
  const tempCollectionDoc = tempCollectionId ? await getCollectionDoc(tempCollectionId) : null;
  addResult({
    route: "/v2/collections",
    nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
    scenario: "COLLECTIONS create persists a real collection doc",
    classification:
      create.statusCode === 200 && tempCollectionId && tempCollectionDoc ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: create.latencyMs,
    sourceFirestoreDocsChecked: tempCollectionId ? [`collections/${tempCollectionId}`] : [],
    mismatchDetails:
      create.statusCode === 200 && tempCollectionId && tempCollectionDoc
        ? []
        : ["create collection did not persist a Firestore collection doc"],
    fixRecommendation: mismatchToRecommendation(
      create.statusCode === 200 && tempCollectionId && tempCollectionDoc ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
    ),
  });

  if (tempCollectionId) {
    const edit = await callRoute("PATCH", `/v2/collections/${encodeURIComponent(tempCollectionId)}`, {
      name: `${tempName} Updated`,
      description: "updated by semantic harness",
    });
    const editedDoc = await getCollectionDoc(tempCollectionId);
    addResult({
      route: "/v2/collections/:id",
      nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
      scenario: "COLLECTIONS edit mutates the correct Firestore doc",
      classification:
        edit.statusCode === 200 && str(editedDoc?.name) === `${tempName} Updated`
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
      latencyMs: edit.latencyMs,
      sourceFirestoreDocsChecked: [`collections/${tempCollectionId}`],
      mismatchDetails:
        edit.statusCode === 200 && str(editedDoc?.name) === `${tempName} Updated`
          ? []
          : [`collection ${tempCollectionId} name was not updated in Firestore`],
      fixRecommendation: mismatchToRecommendation(
        edit.statusCode === 200 && str(editedDoc?.name) === `${tempName} Updated`
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
      ),
    });

    const detail = await callRoute("GET", `/v2/collections/${encodeURIComponent(tempCollectionId)}`);
    const detailItem = obj(obj(detail.envelope?.data).item);
    addResult({
      route: "/v2/collections/:id",
      nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionDisplayV2.repository.ts",
      scenario: "COLLECTIONS detail matches the collection doc",
      classification:
        str(detailItem.id) === tempCollectionId && str(detailItem.ownerId) === viewerId
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MISSING_DOC",
      latencyMs: detail.latencyMs,
      sourceFirestoreDocsChecked: [`collections/${tempCollectionId}`],
      mismatchDetails:
        str(detailItem.id) === tempCollectionId && str(detailItem.ownerId) === viewerId
          ? []
          : [`collection detail mismatch for ${tempCollectionId}`],
      fixRecommendation: mismatchToRecommendation(
        str(detailItem.id) === tempCollectionId && str(detailItem.ownerId) === viewerId
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MISSING_DOC"
      ),
    });

    const samplePostId = state.viewerVideoPostId ?? state.viewerPostId ?? state.sampleFeedPostId;
    if (samplePostId) {
      const addPost = await callRoute("POST", `/v2/collections/${encodeURIComponent(tempCollectionId)}/posts`, { postId: samplePostId });
      const collectionAfterAdd = await getCollectionDoc(tempCollectionId);
      const postsCall = await callRoute("GET", `/v2/collections/${encodeURIComponent(tempCollectionId)}/posts?limit=10`);
      const postsItems = arr<Record<string, unknown>>(obj(postsCall.envelope?.data).items);
      const containsPost = arr<string>(collectionAfterAdd?.items).includes(samplePostId);
      const postsContains = postsItems.some((row) => str(row.postId) === samplePostId);
      addResult({
        route: "/v2/collections/:id/posts",
        nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionDisplayV2.repository.ts",
        scenario: "COLLECTIONS posts returns posts actually in the collection",
        classification:
          addPost.statusCode === 200 && containsPost && postsContains ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
        latencyMs: postsCall.latencyMs,
        sourceFirestoreDocsChecked: [`collections/${tempCollectionId}`, `posts/${samplePostId}`],
        mismatchDetails:
          addPost.statusCode === 200 && containsPost && postsContains
            ? []
            : [`collection ${tempCollectionId} did not expose saved post ${samplePostId}`],
        fixRecommendation: mismatchToRecommendation(
          addPost.statusCode === 200 && containsPost && postsContains ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
        ),
      });

      const save = await callRoute("POST", `/v2/posts/${encodeURIComponent(samplePostId)}/save`, {});
      const saveState = await callRoute("GET", `/v2/posts/${encodeURIComponent(samplePostId)}/save-state`);
      const saved = obj(saveState.envelope?.data);
      const savedIds = arr<string>(saved.collectionIds);
      const saveCollectionId = str(obj(save.envelope?.data).collectionId);
      const targetSaveCollectionId = saveCollectionId ?? `saved-${viewerId}`;
      addResult({
        route: "/v2/posts/:postId/save",
        nativeSurface: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
        scenario: "COLLECTIONS save updates viewer save-state and collection membership",
        classification:
          save.statusCode === 200 && saved.saved === true && savedIds.includes(targetSaveCollectionId)
            ? "SEMANTIC_PASS"
            : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
        latencyMs: save.latencyMs,
        sourceFirestoreDocsChecked: [`collections/${targetSaveCollectionId}`, `posts/${samplePostId}`],
        mismatchDetails:
          save.statusCode === 200 && saved.saved === true && savedIds.includes(targetSaveCollectionId)
            ? []
            : [`save-state did not reflect default saved collection ${targetSaveCollectionId} for post ${samplePostId}`],
        fixRecommendation: mismatchToRecommendation(
          save.statusCode === 200 && saved.saved === true && savedIds.includes(targetSaveCollectionId)
            ? "SEMANTIC_PASS"
            : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
        ),
      });

      const unsave = await callRoute("POST", `/v2/posts/${encodeURIComponent(samplePostId)}/unsave`, {});
      const unsaveState = await callRoute("GET", `/v2/posts/${encodeURIComponent(samplePostId)}/save-state`);
      const unsaveStateData = obj(unsaveState.envelope?.data);
      const unsaveIds = arr<string>(unsaveStateData.collectionIds);
      const defaultCollectionAfterUnsave = await getCollectionDoc(targetSaveCollectionId);
      const defaultStillContainsPost = arr<string>(defaultCollectionAfterUnsave?.items).includes(samplePostId);
      const unsavePassed =
        unsave.statusCode === 200 &&
        !defaultStillContainsPost &&
        !unsaveIds.includes(targetSaveCollectionId) &&
        (Boolean(unsaveStateData.saved) === (unsaveIds.length > 0));
      addResult({
        route: "/v2/posts/:postId/unsave",
        nativeSurface: "Locava-Native/src/features/liftable/backendv2/viewerMutationsV2.repository.ts",
        scenario: "COLLECTIONS unsave removes default save membership and preserves truthful save-state",
        classification: unsavePassed ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
        latencyMs: unsave.latencyMs,
        sourceFirestoreDocsChecked: [`collections/${targetSaveCollectionId}`, `posts/${samplePostId}`],
        mismatchDetails: unsavePassed
          ? []
          : [
              defaultStillContainsPost
                ? `default saved collection ${targetSaveCollectionId} still contains post ${samplePostId} after unsave`
                : "",
              unsaveIds.includes(targetSaveCollectionId)
                ? `save-state still includes default saved collection ${targetSaveCollectionId} after unsave`
                : "",
              Boolean(unsaveStateData.saved) !== (unsaveIds.length > 0)
                ? `save-state.saved (${String(unsaveStateData.saved)}) does not match remaining collectionIds length ${unsaveIds.length}`
                : "",
            ].filter(Boolean),
        fixRecommendation: mismatchToRecommendation(unsavePassed ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"),
      });
    }

    const del = await callRoute("DELETE", `/v2/collections/${encodeURIComponent(tempCollectionId)}`);
    const deletedDoc = await getCollectionDoc(tempCollectionId);
    addResult({
      route: "/v2/collections/:id",
      nativeSurface: "Locava-Native/src/features/togo/backendv2/collectionsMutationsV2.repository.ts",
      scenario: "COLLECTIONS delete removes the correct collection doc",
      classification:
        del.statusCode === 200 && !deletedDoc ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
      latencyMs: del.latencyMs,
      sourceFirestoreDocsChecked: [`collections/${tempCollectionId}`],
      mismatchDetails:
        del.statusCode === 200 && !deletedDoc ? [] : [`collection ${tempCollectionId} still exists after delete`],
      fixRecommendation: mismatchToRecommendation(
        del.statusCode === 200 && !deletedDoc ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
      ),
    });
  }
}

async function runDirectoryScenarios(): Promise<void> {
  const suggested = await callRoute("GET", "/v2/social/suggested-friends?surface=generic&limit=10");
  const suggestedUsers = arr<Record<string, unknown>>(obj(suggested.envelope?.data).users);
  const followingIds = await loadViewerFollowingIds();
  const suggestedMismatches: string[] = [];
  for (const row of suggestedUsers) {
    const userId = str(row.userId);
    const doc = userId ? await getUserDoc(userId) : null;
    if (!userId || !doc) suggestedMismatches.push(`suggested friends returned missing user ${userId ?? "<missing>"}`);
    if (userId === viewerId) suggestedMismatches.push("suggested friends included the current viewer");
    if (userId && followingIds.has(userId)) suggestedMismatches.push(`suggested friends included already-followed user ${userId}`);
    if (normalizeText(str(row.handle)).includes("seed")) suggestedMismatches.push(`suggested friends returned seeded handle ${String(row.handle ?? "")}`);
  }
  addResult({
    route: "/v2/social/suggested-friends",
    nativeSurface: "Locava-Native/src/data/repos/connectionsRepo.ts",
    scenario: "SUGGESTED FRIENDS returns real users, excludes self, and excludes already-followed users",
    classification: suggestedMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: suggested.latencyMs,
    sourceFirestoreDocsChecked: suggestedUsers.map((row) => `users/${String(row.userId ?? "")}`),
    mismatchDetails: suggestedMismatches,
    fixRecommendation: mismatchToRecommendation(
      suggestedMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA"
    ),
  });

  const directory = await callRoute("GET", "/v2/directory/users?limit=8");
  const directoryItems = arr<Record<string, unknown>>(obj(directory.envelope?.data).items);
  const directoryMismatches: string[] = [];
  for (const row of directoryItems) {
    const userId = str(row.userId);
    const doc = userId ? await getUserDoc(userId) : null;
    if (!userId || !doc) directoryMismatches.push(`directory returned missing user ${userId ?? "<missing>"}`);
  }
  addResult({
    route: "/v2/directory/users",
    nativeSurface: "Locava-Native/src/features/findFriends/backendv2/directoryV2.repository.ts",
    scenario: "DIRECTORY returns real users and stable following state",
    classification: directoryMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: directory.latencyMs,
    sourceFirestoreDocsChecked: directoryItems.map((row) => `users/${String(row.userId ?? "")}`),
    mismatchDetails: directoryMismatches,
    fixRecommendation: mismatchToRecommendation(
      directoryMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC"
    ),
  });
}

function resolveNotificationExpectation(row: Record<string, unknown>): { ok: boolean; docs: string[]; details: string[] } {
  const type = str(row.type);
  const targetId = str(row.targetId) ?? str(row.postId) ?? str(row.collectionId) ?? str(row.targetUserId);
  const actorId = str(row.actorId) ?? str(row.senderUserId);
  const metadata = obj(row.metadata);
  const docs: string[] = [];
  const details: string[] = [];
  if (actorId) docs.push(`users/${actorId}`);
  if (type === "follow" || type === "contact_joined") {
    return { ok: Boolean(actorId), docs, details: actorId ? [] : ["follow/contact notification missing actorId"] };
  }
  if (type === "like" || type === "post" || type === "mention") {
    if (targetId) docs.push(`posts/${targetId}`);
    return { ok: Boolean(targetId), docs, details: targetId ? [] : [`notification ${type} missing post target`] };
  }
  if (type === "comment") {
    const commentId = str(metadata.commentId) ?? str(row.commentId);
    if (!targetId || !commentId) return { ok: false, docs, details: ["comment notification missing target post or commentId"] };
    docs.push(`posts/${targetId}`);
    docs.push(`comment:${commentId}`);
    return { ok: true, docs, details: [] };
  }
  if (type === "collection_shared" || type === "invite") {
    if (targetId) docs.push(`collections/${targetId}`);
    return { ok: Boolean(targetId), docs, details: targetId ? [] : ["collection notification missing collection target"] };
  }
  if (type === "chat") {
    const chatId = str(metadata.chatId) ?? str(metadata.conversationId) ?? targetId;
    if (chatId) docs.push(`chats/${chatId}`);
    return { ok: Boolean(chatId), docs, details: chatId ? [] : ["chat notification missing chat target"] };
  }
  return { ok: true, docs, details: [] };
}

async function runNotificationsScenarios(): Promise<void> {
  await ensureUnreadNotificationFixture();
  const list = await callRoute("GET", "/v2/notifications?limit=10");
  const items = arr<Record<string, unknown>>(obj(list.envelope?.data).items);
  const mismatches: string[] = [];
  for (const row of items) {
    const notificationId = str(row.notificationId);
    if (notificationId) {
      const doc = await getNotificationDoc(notificationId);
      if (!doc) mismatches.push(`notification ${notificationId} missing in Firestore`);
    }
    const actorId = str(row.actorId);
    if (actorId) {
      const doc = await getUserDoc(actorId);
      if (!doc) mismatches.push(`notification actor missing user ${actorId}`);
    }
    const pic = str(obj(row.actor).pic);
    if (pic && pic.toLowerCase().includes("placeholder")) {
      mismatches.push(`notification ${notificationId ?? "<unknown>"} returned placeholder avatar ${pic}`);
    }
    const deepLink = resolveNotificationExpectation(row);
    if (!deepLink.ok) mismatches.push(...deepLink.details);
  }
  state.sampleNotificationId = str(items[0]?.notificationId);
  state.sampleUnreadNotificationId = str(items.find((row) => str(row.readState) === "unread")?.notificationId);
  addResult({
    route: "/v2/notifications",
    nativeSurface: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
    scenario: "NOTIFICATIONS returns real docs with valid actors/targets and no placeholder avatars",
    classification:
      mismatches.length === 0
        ? "SEMANTIC_PASS"
        : mismatches.some((m) => m.includes("placeholder") || m.includes("missing chat target"))
          ? "SEMANTIC_FAIL_DEEP_LINK"
          : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: list.latencyMs,
    sourceFirestoreDocsChecked: items.slice(0, 10).flatMap((row) => {
      const notificationId = str(row.notificationId);
      const docs = notificationId ? [`users/${viewerId}/notifications/${notificationId}`] : [];
      const deepLink = resolveNotificationExpectation(row);
      return [...docs, ...deepLink.docs];
    }),
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(
      mismatches.length === 0
        ? "SEMANTIC_PASS"
        : mismatches.some((m) => m.includes("placeholder") || m.includes("missing chat target"))
          ? "SEMANTIC_FAIL_DEEP_LINK"
          : "SEMANTIC_FAIL_MISSING_DOC"
    ),
  });

  if (!state.sampleUnreadNotificationId) {
    state.sampleUnreadNotificationId = await ensureUnreadNotificationFixture();
  }
  if (state.sampleUnreadNotificationId) {
    const markRead = await callRoute("POST", "/v2/notifications/mark-read", {
      notificationIds: [state.sampleUnreadNotificationId],
    });
    const notificationDoc = await getNotificationDoc(state.sampleUnreadNotificationId);
    addResult({
      route: "/v2/notifications/mark-read",
      nativeSurface: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
      scenario: "NOTIFICATIONS mark-read persists real read state",
      classification:
        markRead.statusCode === 200 && notificationDoc?.read === true
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
      latencyMs: markRead.latencyMs,
      sourceFirestoreDocsChecked: [`users/${viewerId}/notifications/${state.sampleUnreadNotificationId}`],
      mismatchDetails:
        markRead.statusCode === 200 && notificationDoc?.read === true
          ? []
          : [`notification ${state.sampleUnreadNotificationId} is still unread in Firestore after mark-read`],
      fixRecommendation: mismatchToRecommendation(
        markRead.statusCode === 200 && notificationDoc?.read === true
          ? "SEMANTIC_PASS"
          : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
      ),
    });
  } else {
    addResult({
      route: "/v2/notifications/mark-read",
      nativeSurface: "Locava-Native/src/features/notifications/backendv2/notificationsV2.repository.ts",
      scenario: "NOTIFICATIONS mark-read persists real read state",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: ["viewer did not have an unread notification to mark read"],
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
  }
}

async function runChatsScenarios(): Promise<void> {
  const inbox = await callRoute("GET", "/v2/chats/inbox?limit=10");
  const items = arr<Record<string, unknown>>(obj(inbox.envelope?.data).items);
  const mismatches: string[] = [];
  for (const row of items.slice(0, 5)) {
    const conversationId = str(row.conversationId);
    const chatDoc = conversationId ? await getChatDoc(conversationId) : null;
    if (!conversationId || !chatDoc) {
      mismatches.push(`chat inbox returned missing conversation ${conversationId ?? "<missing>"}`);
      continue;
    }
    const participants = arr<string>(chatDoc.participants);
    if (!participants.includes(viewerId)) mismatches.push(`conversation ${conversationId} does not include viewer`);
    const lastSenderId = str(obj(row.lastSender).userId);
    if (lastSenderId) {
      const doc = await getUserDoc(lastSenderId);
      if (!doc) mismatches.push(`conversation ${conversationId} last sender ${lastSenderId} missing user doc`);
    }
  }
  state.sampleChatConversationId = str(items[0]?.conversationId) ?? state.sampleChatConversationId;
  addResult({
    route: "/v2/chats/inbox",
    nativeSurface: "Locava-Native/src/features/chats/data/chatIndex.repository.ts",
    scenario: "CHATS inbox returns real conversations involving the viewer",
    classification: mismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC",
    latencyMs: inbox.latencyMs,
    sourceFirestoreDocsChecked: items.slice(0, 5).map((row) => `chats/${String(row.conversationId ?? "")}`),
    mismatchDetails: mismatches,
    fixRecommendation: mismatchToRecommendation(mismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC"),
  });

  if (state.sampleChatConversationId) {
    const thread = await callRoute("GET", `/v2/chats/${encodeURIComponent(state.sampleChatConversationId)}/messages?limit=10`);
    const threadItems = arr<Record<string, unknown>>(obj(thread.envelope?.data).items);
    const messageDocs = await getChatMessageDocs(state.sampleChatConversationId, 30);
    const messageIdSet = new Set(messageDocs.map((row) => row.id));
    const threadMismatches: string[] = [];
    for (const row of threadItems) {
      const messageId = str(row.messageId);
      if (!messageId || !messageIdSet.has(messageId)) {
        threadMismatches.push(`thread returned missing message ${messageId ?? "<missing>"}`);
      }
      const senderId = str(obj(row.sender).userId);
      if (senderId) {
        const doc = await getUserDoc(senderId);
        if (!doc) threadMismatches.push(`thread message sender ${senderId} missing user doc`);
      }
    }
    addResult({
      route: "/v2/chats/:conversationId/messages",
      nativeSurface: "Locava-Native/src/features/chatThread/data/thread.repository.ts",
      scenario: "CHATS thread messages belong to the conversation and have real senders",
      classification: threadMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC",
      latencyMs: thread.latencyMs,
      sourceFirestoreDocsChecked: [
        `chats/${state.sampleChatConversationId}`,
        ...threadItems.map((row) => `chats/${state.sampleChatConversationId}/messages/${String(row.messageId ?? "")}`),
      ],
      mismatchDetails: threadMismatches,
      fixRecommendation: mismatchToRecommendation(
        threadMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MISSING_DOC"
      ),
    });
  }

  const sendConversationId = state.sampleSelfChatConversationId ?? state.sampleChatConversationId;
  if (!sendConversationId) {
    addResult({
      route: "/v2/chats/:conversationId/messages",
      nativeSurface: "Locava-Native/src/features/chatThread/data/thread.send.ts",
      scenario: "CHATS send message writes a real message and updates inbox ordering",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: ["no conversation available for safe send-message verification"],
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
    return;
  }
  const sendText = `semantic-harness ${Date.now()}`;
  const send = await callRoute("POST", `/v2/chats/${encodeURIComponent(sendConversationId)}/messages`, {
    messageType: "text",
    text: sendText,
    clientMessageId: `semantic-${Date.now()}-chat`,
  });
  const sentMessageId = str(obj(obj(send.envelope?.data).message).messageId);
  const sentDoc = sentMessageId
    ? await db.collection("chats").doc(sendConversationId).collection("messages").doc(sentMessageId).get()
    : null;
  const conversationAfterSend = await getChatDoc(sendConversationId);
  const inboxAfterSend = await callRoute("GET", "/v2/chats/inbox?limit=20");
  const inboxAfterItems = arr<Record<string, unknown>>(obj(inboxAfterSend.envelope?.data).items);
  const updatedRow = inboxAfterItems.find((row) => str(row.conversationId) === sendConversationId);
  const sendPassed =
    send.statusCode === 200 &&
    sentDoc?.exists &&
    normalizeText(str((sentDoc.data() as Record<string, unknown>)?.content)).includes(normalizeText(sendText)) &&
    normalizeText(str(obj(conversationAfterSend?.lastMessage).content)).includes(normalizeText(sendText)) &&
    Boolean(updatedRow) &&
    normalizeText(str(updatedRow?.lastMessagePreview)).includes(normalizeText(sendText));
  addResult({
    route: "/v2/chats/:conversationId/messages",
    nativeSurface: "Locava-Native/src/features/chatThread/data/thread.send.ts",
    scenario: "CHATS send message writes a real message and updates inbox ordering",
    classification: sendPassed ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: send.latencyMs,
    sourceFirestoreDocsChecked: sentMessageId
      ? [`chats/${sendConversationId}/messages/${sentMessageId}`, `chats/${sendConversationId}`]
      : [`chats/${sendConversationId}`],
    mismatchDetails: sendPassed ? [] : [`send-message did not persist or reflect updated preview for conversation ${sendConversationId}`],
    fixRecommendation: mismatchToRecommendation(sendPassed ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"),
  });
}

async function runAchievementsScenarios(): Promise<void> {
  const status = await callRoute("GET", "/v2/achievements/status");
  const statusData = obj(status.envelope?.data);
  const statusRow = obj(statusData.status);
  const actualPosts = await countViewerPosts();
  const statusMismatches: string[] = [];
  if (num(statusRow.totalPosts) !== actualPosts) {
    statusMismatches.push(`status totalPosts mismatch: expected ${actualPosts}, received ${String(statusRow.totalPosts ?? "")}`);
  }
  addResult({
    route: "/v2/achievements/status",
    nativeSurface: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    scenario: "ACHIEVEMENTS status reflects real viewer progression counters",
    classification: statusMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: status.latencyMs,
    sourceFirestoreDocsChecked: [`users/${viewerId}`, `users/${viewerId}/achievements/state`, `posts/* where userId=${viewerId}`],
    mismatchDetails: statusMismatches,
    fixRecommendation: mismatchToRecommendation(statusMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA"),
  });

  const snapshot = await callRoute("GET", "/v2/achievements/snapshot");
  const snapshotData = obj(snapshot.envelope?.data);
  const snap = obj(snapshotData.snapshot);
  const snapshotMismatches: string[] = [];
  if (str(obj(snap.pendingLeaderboardEvent).eventId)?.includes("-fallback")) {
    snapshotMismatches.push(`snapshot pendingLeaderboardEvent is synthetic: ${String(obj(snap.pendingLeaderboardEvent).eventId ?? "")}`);
  }
  if (num(snap.totalPosts) !== actualPosts) {
    snapshotMismatches.push(`snapshot totalPosts mismatch: expected ${actualPosts}, received ${String(snap.totalPosts ?? "")}`);
  }
  addResult({
    route: "/v2/achievements/snapshot",
    nativeSurface: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    scenario: "ACHIEVEMENTS snapshot reflects real viewer data instead of seeded values",
    classification: snapshotMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: snapshot.latencyMs,
    sourceFirestoreDocsChecked: [`users/${viewerId}`, `posts/* where userId=${viewerId}`],
    mismatchDetails: snapshotMismatches,
    fixRecommendation: mismatchToRecommendation(
      snapshotMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA"
    ),
  });

  const leaderboard = await callRoute("GET", "/v2/achievements/leaderboard/xp_global");
  const leaderboardRows = arr<Record<string, unknown>>(obj(leaderboard.envelope?.data).leaderboard);
  const leaderboardMismatches: string[] = [];
  for (const row of leaderboardRows) {
    const userId = str(row.userId);
    const doc = userId ? await getUserDoc(userId) : null;
    if (!userId || !doc) leaderboardMismatches.push(`leaderboard returned non-existent user ${userId ?? "<missing>"}`);
  }
  addResult({
    route: "/v2/achievements/leaderboard/:scope",
    nativeSurface: "Locava-Native/src/features/achievements/backendv2/achievementsV2.repository.ts",
    scenario: "ACHIEVEMENTS leaderboard users exist and are not synthetic ids",
    classification: leaderboardMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA",
    latencyMs: leaderboard.latencyMs,
    sourceFirestoreDocsChecked: leaderboardRows.map((row) => `users/${String(row.userId ?? "")}`),
    mismatchDetails: leaderboardMismatches,
    fixRecommendation: mismatchToRecommendation(
      leaderboardMismatches.length === 0 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_FAKE_DATA"
    ),
  });
}

async function runPostingScenario(): Promise<void> {
  state.postingProbe.attempted = true;
  const videoPostId = state.viewerVideoPostId;
  if (!videoPostId) {
    state.postingProbe.details.push("no owned video post available to reuse public media urls");
    addResult({
      route: "/v2/posting/*",
      nativeSurface: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
      scenario: "POSTING / MEDIA PUBLIC ACCESS safe-mode temp post flow",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: state.postingProbe.details,
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
    return;
  }
  const sourcePost = await getPostDoc(videoPostId);
  const videoAsset = arr<Record<string, unknown>>(sourcePost?.assets).find((asset) => str(asset.type) === "video");
  const originalUrl = str(videoAsset?.original);
  const posterUrl = str(videoAsset?.poster) ?? str(obj(videoAsset?.variants).poster);
  const originalKey = urlToObjectKey(originalUrl);
  const posterKey = urlToObjectKey(posterUrl);
  if (!originalUrl || !posterUrl || !originalKey || !posterKey) {
    state.postingProbe.details.push("unable to derive reusable original/poster urls from owned video post");
    addResult({
      route: "/v2/posting/*",
      nativeSurface: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
      scenario: "POSTING / MEDIA PUBLIC ACCESS safe-mode temp post flow",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [`posts/${videoPostId}`],
      mismatchDetails: state.postingProbe.details,
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
    return;
  }

  const unique = Date.now();
  const clientSessionKey = `semantic-post-${unique}`;
  const uploadSession = await callRoute("POST", "/v2/posting/upload-session", {
    clientSessionKey,
    mediaCountHint: 1,
  });
  const sessionId = str(obj(obj(uploadSession.envelope?.data).uploadSession).sessionId);
  state.postingProbe.uploadSessionOk = uploadSession.statusCode === 200 && Boolean(sessionId);
  if (!state.postingProbe.uploadSessionOk || !sessionId) {
    state.postingProbe.details.push("upload-session failed");
  }

  const register = sessionId
    ? await callRoute("POST", "/v2/posting/media/register", {
        sessionId,
        assetIndex: 0,
        assetType: "video",
        clientMediaKey: `semantic-media-${unique}`,
      })
    : null;
  const mediaId = str(obj(obj(register?.envelope?.data).media).mediaId);
  state.postingProbe.mediaId = mediaId;
  state.postingProbe.registerOk = Boolean(register && register.statusCode === 200 && mediaId);
  if (!state.postingProbe.registerOk) {
    state.postingProbe.details.push("media register failed");
  }

  const markUploaded =
    mediaId && originalKey
      ? await callRoute("POST", `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`, {
          uploadedObjectKey: originalKey,
        })
      : null;
  state.postingProbe.markUploadedOk = Boolean(markUploaded && markUploaded.statusCode === 200);
  if (!state.postingProbe.markUploadedOk) {
    state.postingProbe.details.push("mark-uploaded failed");
  }

  const finalize =
    sessionId
      ? await callRoute("POST", "/v2/posting/finalize", {
          sessionId,
          stagedItems: [
            {
              index: 0,
              assetType: "video",
              originalKey,
              originalUrl,
              posterKey,
              posterUrl,
            },
          ],
          idempotencyKey: `semantic-finalize-${unique}`,
          mediaCount: 1,
          userId: viewerId,
          title: `Semantic Post ${unique}`,
          content: "real-user semantic harness",
          activities: ["hiking"],
          lat: String(sourcePost?.lat ?? 42.0),
          long: String(sourcePost?.long ?? -72.0),
          address: str(sourcePost?.address) ?? "Semantic Harness",
          privacy: "Public Spot",
          tags: [],
          texts: [],
          recordings: [],
        })
      : null;
  const finalizeData = obj(finalize?.envelope?.data);
  const postId = str(finalizeData.postId);
  const operationId = str(obj(finalizeData.operation).operationId);
  state.tempPostId = postId;
  state.tempOperationId = operationId;
  state.postingProbe.postId = postId;
  state.postingProbe.operationId = operationId;
  state.postingProbe.finalizeOk = Boolean(finalize && finalize.statusCode === 200 && postId && operationId);
  if (!state.postingProbe.finalizeOk) {
    state.postingProbe.details.push("finalize failed");
  }

  if (operationId) {
    for (let i = 0; i < 5; i += 1) {
      const status = await callRoute("GET", `/v2/posting/operations/${encodeURIComponent(operationId)}`);
      const op = obj(obj(status.envelope?.data).operation);
      if (str(op.state) === "completed") {
        state.postingProbe.operationSuccess = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  state.postingProbe.posterUrl = posterUrl;
  state.postingProbe.videoUrl = originalUrl;
  state.postingProbe.publicPosterImage = await probePublicUrl(posterUrl);
  state.postingProbe.publicVideo = await probePublicUrl(originalUrl);

  if (postId) {
    const createdPost = await getPostDoc(postId);
    if (!createdPost) state.postingProbe.details.push(`created post missing at posts/${postId}`);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [profileGrid, feed, markers] = await Promise.all([
        callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/grid?limit=24`),
        callRoute("GET", "/v2/feed/bootstrap?limit=8&tab=explore"),
        callRoute("GET", "/v2/map/markers?limit=60"),
      ]);
      const profileIds = arr<Record<string, unknown>>(obj(profileGrid.envelope?.data).items).map((row) => str(row.postId));
      const feedIds = arr<Record<string, unknown>>(obj(obj(feed.envelope?.data).firstRender).feed.items).map((row) => str(row.postId));
      const markerIds = arr<Record<string, unknown>>(obj(markers.envelope?.data).markers).map((row) => str(row.postId));
      state.postingProbe.visibleInProfile = profileIds.includes(postId);
      state.postingProbe.visibleInFeed = feedIds.includes(postId);
      state.postingProbe.visibleInMap = markerIds.includes(postId);
      if (state.postingProbe.visibleInProfile && state.postingProbe.visibleInFeed && state.postingProbe.visibleInMap) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!state.postingProbe.visibleInProfile) {
      state.postingProbe.details.push(`new post ${postId} was not visible in profile grid after finalize`);
    }
    if (!state.postingProbe.visibleInFeed) {
      state.postingProbe.details.push(`new post ${postId} was not visible in explore feed after finalize`);
    }
    if (!state.postingProbe.visibleInMap) {
      state.postingProbe.details.push(`new post ${postId} was not visible in map markers after finalize`);
    }
  }

  const postingPass =
    state.postingProbe.uploadSessionOk &&
    state.postingProbe.registerOk &&
    state.postingProbe.markUploadedOk &&
    state.postingProbe.finalizeOk &&
    state.postingProbe.operationSuccess &&
    state.postingProbe.publicPosterImage &&
    state.postingProbe.publicVideo &&
    state.postingProbe.visibleInProfile &&
    state.postingProbe.visibleInFeed &&
    state.postingProbe.visibleInMap &&
    Boolean(state.postingProbe.postId);

  addResult({
    route: "/v2/posting/*",
    nativeSurface: "Locava-Native/src/features/post/upload/directPostUploadClient.ts",
    scenario: "POSTING / MEDIA PUBLIC ACCESS safe-mode temp post flow",
    classification: postingPass ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED",
    latencyMs: finalize?.latencyMs ?? null,
    sourceFirestoreDocsChecked: [
      ...(state.postingProbe.postId ? [`posts/${state.postingProbe.postId}`] : []),
      ...(state.postingProbe.operationId ? [`postingOperation:${state.postingProbe.operationId}`] : []),
    ],
    mismatchDetails: state.postingProbe.details,
    fixRecommendation: mismatchToRecommendation(
      postingPass ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
    ),
  });
}

async function runDeepLinkScenarios(): Promise<void> {
  const postTargetId = state.tempPostId ?? state.viewerVideoPostId ?? state.sampleFeedPostId;
  if (postTargetId) {
    const post = await callRoute("GET", `/v2/posts/${encodeURIComponent(postTargetId)}/detail`);
    addResult({
      route: "/v2/posts/:postId/detail",
      nativeSurface: "Deep link: post",
      scenario: "DEEP LINK post target resolves to a stable post route",
      classification: post.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
      latencyMs: post.latencyMs,
      sourceFirestoreDocsChecked: [`posts/${postTargetId}`],
      mismatchDetails: post.statusCode === 200 ? [] : [`post deep link failed for ${postTargetId}`],
      fixRecommendation: mismatchToRecommendation(post.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"),
    });
  }

  const user = await callRoute("GET", `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=6`);
  addResult({
    route: "/v2/profiles/:userId/bootstrap",
    nativeSurface: "Deep link: user",
    scenario: "DEEP LINK user target resolves to a stable profile route",
    classification: user.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
    latencyMs: user.latencyMs,
    sourceFirestoreDocsChecked: [`users/${viewerId}`],
    mismatchDetails: user.statusCode === 200 ? [] : [`user deep link failed for ${viewerId}`],
    fixRecommendation: mismatchToRecommendation(user.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"),
  });

  const commentTargetPostId = state.tempCommentPostId ?? postTargetId;
  if (state.tempCommentId && commentTargetPostId) {
    const comments = await callRoute("GET", `/v2/posts/${encodeURIComponent(commentTargetPostId)}/comments?limit=20`);
    const ids = arr<Record<string, unknown>>(obj(comments.envelope?.data).items).map((row) => str(row.commentId));
    addResult({
      route: "/v2/posts/:postId/comments",
      nativeSurface: "Deep link: comment",
      scenario: "DEEP LINK comment target can be resolved through canonical post/comments payloads",
      classification: ids.includes(state.tempCommentId) ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
      latencyMs: comments.latencyMs,
      sourceFirestoreDocsChecked: [`posts/${commentTargetPostId}`],
      mismatchDetails: ids.includes(state.tempCommentId) ? [] : [`comment deep link target ${state.tempCommentId} was not present in canonical comments payload`],
      fixRecommendation: mismatchToRecommendation(ids.includes(state.tempCommentId) ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"),
    });
  } else {
    addResult({
      route: "/v2/posts/:postId/comments",
      nativeSurface: "Deep link: comment",
      scenario: "DEEP LINK comment target can be resolved through canonical post/comments payloads",
      classification: "SEMANTIC_UNTESTED",
      latencyMs: null,
      sourceFirestoreDocsChecked: [],
      mismatchDetails: ["no stable comment id available for deep-link verification"],
      fixRecommendation: mismatchToRecommendation("SEMANTIC_UNTESTED"),
    });
  }
  if (state.tempCommentCleanupId) {
    await callRoute("DELETE", `/v2/comments/${encodeURIComponent(state.tempCommentCleanupId)}`);
    state.tempCommentCleanupId = null;
  }

  if (state.sampleChatConversationId) {
    const chat = await callRoute("GET", `/v2/chats/${encodeURIComponent(state.sampleChatConversationId)}/messages?limit=10`);
    addResult({
      route: "/v2/chats/:conversationId/messages",
      nativeSurface: "Deep link: chat",
      scenario: "DEEP LINK chat target resolves to a stable thread route",
      classification: chat.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
      latencyMs: chat.latencyMs,
      sourceFirestoreDocsChecked: [`chats/${state.sampleChatConversationId}`],
      mismatchDetails: chat.statusCode === 200 ? [] : [`chat deep link failed for ${state.sampleChatConversationId}`],
      fixRecommendation: mismatchToRecommendation(chat.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"),
    });
  }

  const collectionTargetId = state.sampleCollectionId ?? state.tempCollectionId;
  if (collectionTargetId) {
    const collection = await callRoute("GET", `/v2/collections/${encodeURIComponent(collectionTargetId)}`);
    addResult({
      route: "/v2/collections/:id",
      nativeSurface: "Deep link: collection",
      scenario: "DEEP LINK collection target resolves to a stable collection route",
      classification: collection.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
      latencyMs: collection.latencyMs,
      sourceFirestoreDocsChecked: [`collections/${collectionTargetId}`],
      mismatchDetails: collection.statusCode === 200 ? [] : [`collection deep link failed for ${collectionTargetId}`],
      fixRecommendation: mismatchToRecommendation(
        collection.statusCode === 200 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"
      ),
    });
  }

  if (state.sampleNotificationId) {
    const notificationDoc = await getNotificationDoc(state.sampleNotificationId);
    const route = notificationDoc ? { ...notificationDoc, notificationId: state.sampleNotificationId } : null;
    const resolution = route ? resolveNotificationExpectation(route) : { ok: false, docs: [], details: ["notification target doc missing"] };
    addResult({
      route: "/v2/notifications",
      nativeSurface: "Deep link: notification target",
      scenario: "DEEP LINK notification target has enough data for Native route resolution",
      classification: resolution.ok ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
      latencyMs: null,
      sourceFirestoreDocsChecked: [`users/${viewerId}/notifications/${state.sampleNotificationId}`, ...resolution.docs],
      mismatchDetails: resolution.details,
      fixRecommendation: mismatchToRecommendation(resolution.ok ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"),
    });
  }

  const invalid = await callRoute("GET", "/v2/posts/semantic-invalid-target/detail");
  addResult({
    route: "/v2/posts/:postId/detail",
    nativeSurface: "Deep link: invalid target",
    scenario: "DEEP LINK invalid target returns deterministic visible failure",
    classification: invalid.statusCode === 404 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK",
    latencyMs: invalid.latencyMs,
    sourceFirestoreDocsChecked: ["posts/semantic-invalid-target"],
    mismatchDetails: invalid.statusCode === 404 ? [] : [`invalid post target returned status ${invalid.statusCode}`],
    fixRecommendation: mismatchToRecommendation(
      invalid.statusCode === 404 ? "SEMANTIC_PASS" : "SEMANTIC_FAIL_DEEP_LINK"
    ),
  });
}

async function writeReports(): Promise<void> {
  const summary = results.reduce<Record<SemanticClassification, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {} as Record<SemanticClassification, number>);

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        viewerId,
        summary,
        postingProbe: state.postingProbe,
        results,
      },
      null,
      2
    )
  );

  const lines: string[] = [];
  lines.push("# Real-User Backendv2 Semantics Report - 2026-04-24");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [key, value] of Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Posting Probe");
  lines.push("");
  lines.push(`- Attempted: ${state.postingProbe.attempted}`);
  lines.push(`- Upload session: ${state.postingProbe.uploadSessionOk}`);
  lines.push(`- Register: ${state.postingProbe.registerOk}`);
  lines.push(`- Mark uploaded: ${state.postingProbe.markUploadedOk}`);
  lines.push(`- Finalize: ${state.postingProbe.finalizeOk}`);
  lines.push(`- Operation success: ${state.postingProbe.operationSuccess}`);
  lines.push(`- Public poster image: ${state.postingProbe.publicPosterImage}`);
  lines.push(`- Public video: ${state.postingProbe.publicVideo}`);
  lines.push(`- Visible in profile: ${state.postingProbe.visibleInProfile}`);
  lines.push(`- Visible in feed: ${state.postingProbe.visibleInFeed}`);
  lines.push(`- Visible in map: ${state.postingProbe.visibleInMap}`);
  if (state.postingProbe.details.length > 0) {
    lines.push(`- Details: ${state.postingProbe.details.join("; ")}`);
  }
  lines.push("");
  lines.push("## Route Matrix");
  lines.push("");
  lines.push("| Route | Native Surface | Scenario | Classification | Latency (ms) | Firestore Docs Checked | Mismatch Details | Fix Recommendation | Fixed |");
  lines.push("| --- | --- | --- | --- | ---: | --- | --- | --- | --- |");
  for (const row of results) {
    lines.push(
      `| \`${row.route}\` | \`${row.nativeSurface}\` | ${row.scenario} | \`${row.classification}\` | ${row.latencyMs ?? ""} | ${row.sourceFirestoreDocsChecked.join(", ") || "-"} | ${row.mismatchDetails.join("; ") || "-"} | ${row.fixRecommendation} | ${row.fixed ? "yes" : "no"} |`
    );
  }
  lines.push("");
  await fs.writeFile(markdownPath, lines.join("\n"));
}

try {
  await seedState();
  if (shouldRun("auth")) await runAuthSessionScenario();
  if (shouldRun("feed")) await runFeedScenarios();
  if (shouldRun("search")) await runSearchScenarios();
  if (shouldRun("map")) await runMapScenarios();
  if (shouldRun("profile")) await runProfileScenarios();
  if (shouldRun("posts.detail")) await runPostsDetailScenario();
  if (shouldRun("comments")) await runCommentsScenarios();
  if (shouldRun("collections")) await runCollectionsScenarios();
  if (shouldRun("directory") || shouldRun("suggested")) await runDirectoryScenarios();
  if (shouldRun("notifications")) await runNotificationsScenarios();
  if (shouldRun("chats")) await runChatsScenarios();
  if (shouldRun("achievements")) await runAchievementsScenarios();
  if (shouldRun("posting")) await runPostingScenario();
  if (shouldRun("deep")) await runDeepLinkScenarios();
  await writeReports();
} finally {
  await app.close();
}
