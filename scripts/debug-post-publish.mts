import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const VIEWER_ROLES = process.env.DEBUG_VIEWER_ROLES ?? "internal";
const AUTH_TOKEN = process.env.DEBUG_AUTH_TOKEN ?? "";

function runCurl(path: string, payload: Record<string, unknown>): { status: number; body: any } {
  const raw = execFileSync(
    "curl",
    [
      "-sS",
      "-X",
      "POST",
      "-H",
      `x-viewer-id: ${VIEWER_ID}`,
      "-H",
      `x-viewer-roles: ${VIEWER_ROLES}`,
      "-H",
      "content-type: application/json",
      ...(AUTH_TOKEN ? ["-H", `authorization: Bearer ${AUTH_TOKEN}`] : []),
      "-d",
      JSON.stringify(payload),
      "-w",
      "\n%{http_code}",
      `${BASE_URL}${path}`
    ],
    { encoding: "utf8" }
  );
  const idx = raw.lastIndexOf("\n");
  const body = JSON.parse((idx >= 0 ? raw.slice(0, idx) : raw) || "{}");
  const status = Number((idx >= 0 ? raw.slice(idx + 1) : "0").trim()) || 0;
  return { status, body };
}

function main(): void {
  const unique = Date.now().toString(36);
  const clientMutationId = `debug-post-publish-${unique}`;
  const stage = runCurl("/v2/posts/stage", {
    clientMutationId,
    title: "Debug publish only",
    assets: [{ assetIndex: 0, assetType: "photo" }]
  });
  if (stage.status !== 200 || stage.body?.ok !== true) {
    throw new Error(`stage failed (${stage.status}): ${JSON.stringify(stage.body)}`);
  }
  const stageId = stage.body.data.stage.stageId as string;
  const sign = runCurl("/v2/posts/media/sign-upload", {
    stageId,
    items: [{ assetIndex: 0, assetType: "photo" }]
  });
  if (sign.status !== 200 || sign.body?.ok !== true) {
    throw new Error(`sign-upload failed (${sign.status}): ${JSON.stringify(sign.body)}`);
  }
  const uploadUrl = sign.body?.data?.urls?.[0]?.uploadUrl as string | undefined;
  const stagedObjectKey = sign.body?.data?.urls?.[0]?.key as string | undefined;
  if (!uploadUrl) {
    throw new Error("sign-upload missing uploadUrl");
  }
  const tempFile = join(tmpdir(), `locava-debug-post-publish-${unique}.jpg`);
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
  const complete = runCurl("/v2/posts/media/complete", {
    stageId,
    items: [{ assetIndex: 0, assetType: "photo", objectKey: stagedObjectKey }]
  });
  if (complete.status !== 200 || complete.body?.ok !== true || complete.body?.data?.ready !== true) {
    throw new Error(`complete failed (${complete.status}): ${JSON.stringify(complete.body)}`);
  }
  const publish = runCurl("/v2/posts/publish", {
    stageId,
    clientMutationId,
    activities: [],
    tags: []
  });
  console.log(JSON.stringify({ event: "debug_post_publish", stageId, status: publish.status, body: publish.body }, null, 2));
}

main();
