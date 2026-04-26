import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const VIEWER_ROLES = process.env.DEBUG_VIEWER_ROLES ?? "internal";
const AUTH_TOKEN = process.env.DEBUG_AUTH_TOKEN ?? "";

type CurlResult = { status: number; body: any };

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
    "content-type: application/json"
  ];
  if (AUTH_TOKEN) {
    args.push("-H", `authorization: Bearer ${AUTH_TOKEN}`);
  }
  if (payload !== undefined) {
    args.push("-d", JSON.stringify(payload));
  }
  args.push("-w", "\n%{http_code}", `${BASE_URL}${path}`);
  const raw = execFileSync("curl", args, { encoding: "utf8" });
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const status = Number((idx >= 0 ? raw.slice(idx + 1) : "0").trim()) || 0;
  return { status, body: JSON.parse(bodyText || "{}") };
}

function assertOk(label: string, result: CurlResult): void {
  if (result.status < 200 || result.status >= 300 || result.body?.ok !== true) {
    throw new Error(`${label} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
}

function main(): void {
  const unique = Date.now().toString(36);
  const clientMutationId = `debug-post-flow-${unique}`;

  const stage = curl("POST", "/v2/posts/stage", {
    clientMutationId,
    title: "Debug staged post",
    caption: "Debug staged post from script",
    activities: ["Hiking"],
    privacy: "Public Spot",
    lat: 40.71,
    long: -74.0,
    address: "Debug Address",
    tags: [],
    assets: [{ assetIndex: 0, assetType: "photo" }]
  });
  assertOk("stage", stage);
  const stageId = stage.body.data.stage.stageId as string;

  const sign = curl("POST", "/v2/posts/media/sign-upload", {
    stageId,
    items: [{ assetIndex: 0, assetType: "photo" }]
  });
  assertOk("sign-upload", sign);
  const uploadUrl = sign.body?.data?.urls?.[0]?.uploadUrl as string | undefined;
  const stagedObjectKey = sign.body?.data?.urls?.[0]?.key as string | undefined;
  if (!uploadUrl) {
    throw new Error(`sign-upload returned no uploadUrl: ${JSON.stringify(sign.body)}`);
  }
  const tempFile = join(tmpdir(), `locava-debug-post-${unique}.jpg`);
  writeFileSync(tempFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    execFileSync(
      "curl",
      ["-sS", "-X", "PUT", "-H", "content-type: image/jpeg", "--data-binary", `@${tempFile}`, uploadUrl],
      { encoding: "utf8" }
    );
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // no-op
    }
  }

  const complete = curl("POST", "/v2/posts/media/complete", {
    stageId,
    items: [{ assetIndex: 0, assetType: "photo", objectKey: stagedObjectKey }]
  });
  if (!(complete.status >= 200 && complete.status < 300 && complete.body?.data?.ready === true)) {
    throw new Error(`complete failed (${complete.status}): ${JSON.stringify(complete.body)}`);
  }

  const publish = curl("POST", "/v2/posts/publish", {
    stageId,
    clientMutationId,
    title: "Debug staged post",
    caption: "Debug staged post from script",
    activities: ["Hiking"],
    privacy: "Public Spot",
    lat: 40.71,
    long: -74.0,
    address: "Debug Address",
    tags: []
  });
  if (!(publish.status >= 200 && publish.status < 300 && publish.body?.ok === true)) {
    throw new Error(`publish failed (${publish.status}): ${JSON.stringify(publish.body)}`);
  }
  const postId = publish.body.data.postId as string;

  const detail = curl("GET", `/v2/posts/${encodeURIComponent(postId)}/detail`);
  const card = curl("GET", `/v2/posts/${encodeURIComponent(postId)}/card`);
  const profile = curl("GET", `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/grid?limit=12`);
  const markers = curl("GET", "/v2/map/markers");

  const publishReplay = curl("POST", "/v2/posts/publish", {
    stageId,
    clientMutationId,
    activities: ["Hiking"],
    tags: []
  });

  console.log(
    JSON.stringify(
      {
        event: "debug_post_flow",
        stageId,
        postId,
        statuses: {
          stage: stage.status,
          sign: sign.status,
          complete: complete.status,
          publish: publish.status,
          detail: detail.status,
          card: card.status,
          profile: profile.status,
          markers: markers.status,
          publishReplay: publishReplay.status
        },
        idempotentReplay: publishReplay.body?.data?.idempotency?.replayed ?? null
      },
      null,
      2
    )
  );
}

main();
