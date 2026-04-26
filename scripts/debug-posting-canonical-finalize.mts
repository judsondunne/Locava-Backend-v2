import { execFileSync } from "node:child_process";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const VIEWER_ROLES = process.env.DEBUG_VIEWER_ROLES ?? "internal";
const AUTH_TOKEN = process.env.DEBUG_AUTH_TOKEN ?? "";
const STAGED_SESSION_ID = process.env.DEBUG_STAGED_SESSION_ID ?? "";
const IDEMPOTENCY_KEY = process.env.DEBUG_IDEMPOTENCY_KEY ?? `debug-post-${Date.now()}`;

type CurlResult = { status: number; body: unknown };

function curl(method: "GET" | "POST", path: string, payload?: unknown): CurlResult {
  const args = [
    "-sS",
    "-X",
    method,
    "-H",
    `x-viewer-id: ${VIEWER_ID}`,
    "-H",
    `x-viewer-roles: ${VIEWER_ROLES}`,
    "-H",
    "content-type: application/json",
  ];
  if (AUTH_TOKEN) args.push("-H", `authorization: Bearer ${AUTH_TOKEN}`);
  if (payload !== undefined) args.push("-d", JSON.stringify(payload));
  args.push("-w", "\n%{http_code}", `${BASE_URL}${path}`);
  const out = execFileSync("curl", args, { encoding: "utf8" });
  const lines = out.trimEnd().split("\n");
  const status = Number(lines.pop() ?? "0");
  const text = lines.join("\n");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status, body };
}

function assertOk(status: number, body: unknown, label: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`${label} failed (${status}): ${JSON.stringify(body)}`);
  }
}

function main(): void {
  const create = curl("POST", "/v2/posting/upload-session", {
    clientSessionKey: IDEMPOTENCY_KEY,
    mediaCountHint: 1,
  });
  assertOk(create.status, create.body, "upload-session");
  const sessionId = String((create.body as any)?.data?.uploadSession?.sessionId ?? "");
  if (!sessionId) throw new Error("missing upload session id");

  const register = curl("POST", "/v2/posting/media/register", {
    sessionId,
    assetIndex: 0,
    assetType: "photo",
    clientMediaKey: "debug-asset-0",
  });
  assertOk(register.status, register.body, "media-register");
  const mediaId = String((register.body as any)?.data?.media?.mediaId ?? "");
  const expectedObjectKey = String((register.body as any)?.data?.media?.expectedObjectKey ?? "");
  if (!mediaId) throw new Error("missing media id");

  const mark = curl("POST", `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`, {
    uploadedObjectKey: expectedObjectKey || `postSessionStaging/${VIEWER_ID}/${sessionId}/0.jpg`,
  });
  assertOk(mark.status, mark.body, "mark-uploaded");

  const finalize = curl("POST", "/v2/posting/finalize", {
    sessionId: STAGED_SESSION_ID || sessionId,
    idempotencyKey: IDEMPOTENCY_KEY,
    mediaCount: 1,
    userId: VIEWER_ID,
    title: "Debug canonical finalize",
    content: "debug post",
    activities: ["walking"],
    lat: 42.35,
    long: -71.06,
    address: "Boston",
    privacy: "Public Spot",
  });
  assertOk(finalize.status, finalize.body, "finalize");
  const postId = String((finalize.body as any)?.data?.postId ?? "");
  if (!postId) throw new Error("missing postId");

  const byId = curl("GET", `/api/posts/${encodeURIComponent(postId)}`);
  assertOk(byId.status, byId.body, "api/posts by id");

  const profile = curl("GET", `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/bootstrap`);
  assertOk(profile.status, profile.body, "profile bootstrap");
  const profileHasPost = JSON.stringify(profile.body).includes(postId);

  const markers = curl("GET", "/v2/map/markers");
  assertOk(markers.status, markers.body, "map markers");
  const markersHasPost = JSON.stringify(markers.body).includes(postId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId,
        profileHasPost,
        markersHasPost,
        note:
          "If markersHasPost=false immediately after publish, wait for map dataset refresh and recheck.",
      },
      null,
      2,
    ),
  );
}

main();
