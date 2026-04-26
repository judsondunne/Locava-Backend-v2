import { resolveLocalDebugViewerId } from "../src/lib/local-dev-identity.ts";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8083";
const VIEWER_ID = resolveLocalDebugViewerId(process.env.DEBUG_VIEWER_ID);

type Row = {
  key: string;
  status: number;
  elapsedMs: number;
  ok: boolean;
  errorCode: string | null;
  routeName: string | null;
  firestoreReached: boolean | null;
  dbReads: number;
  dbQueries: number;
  payloadCount: number | null;
};

const probeRows: Row[] = [];
const canonicalRows: Row[] = [];

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; payload: Record<string, unknown>; elapsedMs: number }> {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const elapsedMs = Date.now() - started;
  const payload = (await response.json()) as Record<string, unknown>;
  return { status: response.status, payload, elapsedMs };
}

function toRow(key: string, status: number, elapsedMs: number, payload: Record<string, unknown>): Row {
  const payloadSummary = (payload.payloadSummary ?? payload.responseData ?? null) as Record<string, unknown> | null;
  const payloadCount = typeof payloadSummary?.count === "number" ? Number(payloadSummary.count) : null;
  const error = payload.error ?? payload.responseError;
  const errorCode = error && typeof error === "object" && "code" in error ? String((error as Record<string, unknown>).code ?? "") : null;
  return {
    key,
    status,
    elapsedMs,
    ok: Boolean(payload.ok),
    errorCode,
    routeName: typeof payload.routeName === "string" ? payload.routeName : typeof payload.canonicalRoute === "string" ? payload.canonicalRoute : null,
    firestoreReached: typeof payload.firestoreReached === "boolean" ? payload.firestoreReached : typeof payload.usedRealFirestoreData === "boolean" ? payload.usedRealFirestoreData : null,
    dbReads: Number(payload.dbReads ?? ((payload.envelopeMeta as Record<string, unknown> | undefined)?.db as Record<string, unknown> | undefined)?.reads ?? 0),
    dbQueries: Number(payload.dbQueries ?? ((payload.envelopeMeta as Record<string, unknown> | undefined)?.db as Record<string, unknown> | undefined)?.queries ?? 0),
    payloadCount
  };
}

function print(kind: "probe" | "canonical", row: Row): void {
  console.log(JSON.stringify({ kind, ...row }));
}

async function main(): Promise<void> {
  const readProbePaths = [
    `/debug/public-firestore/feed/bootstrap`,
    `/debug/public-firestore/feed/page`,
    `/debug/public-firestore/profile/bootstrap/${encodeURIComponent(VIEWER_ID)}`,
    `/debug/public-firestore/profile/grid/${encodeURIComponent(VIEWER_ID)}`,
    `/debug/public-firestore/search/users?q=jo`,
    `/debug/public-firestore/search/results?q=food`,
    `/debug/public-firestore/directory/users`,
    `/debug/public-firestore/chats/inbox?limit=10`,
    `/debug/public-firestore/collections/list/${encodeURIComponent(VIEWER_ID)}`,
    `/debug/public-firestore/map/bootstrap`,
    `/debug/public-firestore/notifications/list/${encodeURIComponent(VIEWER_ID)}`,
    `/debug/public-firestore/achievements/snapshot/${encodeURIComponent(VIEWER_ID)}`
  ];

  for (const path of readProbePaths) {
    const result = await call("GET", path);
    const row = toRow(`GET ${path}`, result.status, result.elapsedMs, result.payload);
    probeRows.push(row);
    print("probe", row);
  }

  const createDirect = await call("POST", "/debug/public-firestore/chats/create-direct", {
    viewerId: VIEWER_ID,
    otherUserId: "qQkjhy6OBvOJaNpn0ZSuj1s9oUl1"
  });
  const createDirectRow = toRow("POST /debug/public-firestore/chats/create-direct", createDirect.status, createDirect.elapsedMs, createDirect.payload);
  probeRows.push(createDirectRow);
  print("probe", createDirectRow);
  const conversationId = typeof (createDirect.payload.payloadSummary as Record<string, unknown> | undefined)?.conversationId === "string"
    ? String((createDirect.payload.payloadSummary as Record<string, unknown>).conversationId)
    : null;

  if (conversationId) {
    const thread = await call("GET", `/debug/public-firestore/chats/thread/${encodeURIComponent(conversationId)}?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=15`);
    const row = toRow(`GET /debug/public-firestore/chats/thread/${conversationId}`, thread.status, thread.elapsedMs, thread.payload);
    probeRows.push(row);
    print("probe", row);

    const send = await call("POST", "/debug/public-firestore/chats/send", {
      viewerId: VIEWER_ID,
      conversationId,
      text: `probe ${new Date().toISOString()}`
    });
    const sendRow = toRow("POST /debug/public-firestore/chats/send", send.status, send.elapsedMs, send.payload);
    probeRows.push(sendRow);
    print("probe", sendRow);
  }

  const collectionCreate = await call("POST", "/debug/public-firestore/collections/create", { viewerId: VIEWER_ID, name: `Probe ${Date.now()}` });
  const collectionCreateRow = toRow("POST /debug/public-firestore/collections/create", collectionCreate.status, collectionCreate.elapsedMs, collectionCreate.payload);
  probeRows.push(collectionCreateRow);
  print("probe", collectionCreateRow);
  const collectionId = typeof (collectionCreate.payload.payloadSummary as Record<string, unknown> | undefined)?.collectionId === "string"
    ? String((collectionCreate.payload.payloadSummary as Record<string, unknown>).collectionId)
    : null;
  if (collectionId) {
    const detail = await call("GET", `/debug/public-firestore/collections/detail/${encodeURIComponent(collectionId)}`);
    const detailRow = toRow(`GET /debug/public-firestore/collections/detail/${collectionId}`, detail.status, detail.elapsedMs, detail.payload);
    probeRows.push(detailRow);
    print("probe", detailRow);
    const update = await call("POST", "/debug/public-firestore/collections/update", { collectionId, description: `updated-${Date.now()}` });
    const updateRow = toRow("POST /debug/public-firestore/collections/update", update.status, update.elapsedMs, update.payload);
    probeRows.push(updateRow);
    print("probe", updateRow);
  }

  const postLike = await call("POST", "/debug/public-firestore/posts/like", { viewerId: VIEWER_ID, postId: "probe-post-id" });
  const postLikeRow = toRow("POST /debug/public-firestore/posts/like", postLike.status, postLike.elapsedMs, postLike.payload);
  probeRows.push(postLikeRow);
  print("probe", postLikeRow);

  const postSave = await call("POST", "/debug/public-firestore/posts/save", { viewerId: VIEWER_ID, postId: "probe-post-id" });
  const postSaveRow = toRow("POST /debug/public-firestore/posts/save", postSave.status, postSave.elapsedMs, postSave.payload);
  probeRows.push(postSaveRow);
  print("probe", postSaveRow);

  const commentCreate = await call("POST", "/debug/public-firestore/comments/create", { viewerId: VIEWER_ID, postId: "probe-post-id", text: "probe" });
  const commentCreateRow = toRow("POST /debug/public-firestore/comments/create", commentCreate.status, commentCreate.elapsedMs, commentCreate.payload);
  probeRows.push(commentCreateRow);
  print("probe", commentCreateRow);

  const finalizeCheck = await call("POST", "/debug/public-firestore/posting/finalize-check");
  const finalizeCheckRow = toRow("POST /debug/public-firestore/posting/finalize-check", finalizeCheck.status, finalizeCheck.elapsedMs, finalizeCheck.payload);
  probeRows.push(finalizeCheckRow);
  print("probe", finalizeCheckRow);

  const canonicalPaths = [
    `/debug/local/feed/bootstrap?viewerId=${encodeURIComponent(VIEWER_ID)}`,
    `/debug/local/feed/page?viewerId=${encodeURIComponent(VIEWER_ID)}`,
    `/debug/local/profile/bootstrap?viewerId=${encodeURIComponent(VIEWER_ID)}`,
    `/debug/local/profile/grid/${encodeURIComponent(VIEWER_ID)}?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=12`,
    `/debug/local/search/users?viewerId=${encodeURIComponent(VIEWER_ID)}&q=jo`,
    `/debug/local/search/results?viewerId=${encodeURIComponent(VIEWER_ID)}&q=food`,
    `/debug/local/directory/users?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`,
    `/debug/local/chats/inbox?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=10`
  ];
  for (const path of canonicalPaths) {
    const result = await call("GET", path);
    const row = toRow(`GET ${path}`, result.status, result.elapsedMs, result.payload);
    canonicalRows.push(row);
    print("canonical", row);
  }

  const summary = {
    probeTotal: probeRows.length,
    probeSuccess: probeRows.filter((r) => r.ok).length,
    canonicalTotal: canonicalRows.length,
    canonicalSuccess: canonicalRows.filter((r) => r.ok).length
  };
  console.log(JSON.stringify({ kind: "summary", ...summary }));
}

await main();
