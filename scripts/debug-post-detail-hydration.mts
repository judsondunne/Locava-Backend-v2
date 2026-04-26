import { execFileSync } from "node:child_process";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";

type CurlResult = { status: number; body: any };

function curlGet(path: string): CurlResult {
  const raw = execFileSync(
    "curl",
    ["-sS", "-H", `x-viewer-id: ${VIEWER_ID}`, "-H", "x-viewer-roles: internal", "-w", "\n%{http_code}", `${BASE_URL}${path}`],
    { encoding: "utf8" }
  );
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const status = Number((idx >= 0 ? raw.slice(idx + 1) : "0").trim()) || 0;
  return { status, body: JSON.parse(bodyText || "{}") };
}

function curlPost(path: string, payload: unknown): CurlResult {
  const raw = execFileSync(
    "curl",
    [
      "-sS",
      "-X",
      "POST",
      "-H",
      `x-viewer-id: ${VIEWER_ID}`,
      "-H",
      "x-viewer-roles: internal",
      "-H",
      "content-type: application/json",
      "-d",
      JSON.stringify(payload),
      "-w",
      "\n%{http_code}",
      `${BASE_URL}${path}`
    ],
    { encoding: "utf8" }
  );
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const status = Number((idx >= 0 ? raw.slice(idx + 1) : "0").trim()) || 0;
  return { status, body: JSON.parse(bodyText || "{}") };
}

function requiredMissing(post: any): string[] {
  const required = ["postId", "userId", "caption", "createdAtMs", "thumbUrl", "assets"];
  return required.filter((key) => post?.[key] == null);
}

function main(): void {
  const bootstrap = curlGet("/v2/feed/bootstrap?limit=5");
  if (bootstrap.status !== 200) throw new Error(`feed bootstrap failed ${bootstrap.status}`);
  const items = bootstrap.body?.data?.firstRender?.feed?.items ?? bootstrap.body?.data?.items ?? [];
  const postIds = items.map((i: any) => String(i?.postId ?? "")).filter(Boolean).slice(0, 5);
  if (postIds.length === 0) throw new Error("no_post_ids_from_bootstrap");

  const batch = curlPost("/v2/posts/details:batch", { postIds, reason: "prefetch" });
  if (batch.status !== 200) throw new Error(`batch failed ${batch.status}`);
  const found = Array.isArray(batch.body?.data?.found) ? batch.body.data.found : [];
  const fieldErrors: Array<{ postId: string; missing: string[] }> = [];
  for (const row of found) {
    const post = row?.detail?.firstRender?.post;
    const missing = requiredMissing(post);
    if (missing.length) fieldErrors.push({ postId: String(row?.postId ?? "unknown"), missing });
  }

  const one = postIds[0];
  const detail1 = curlGet(`/v2/posts/${encodeURIComponent(one)}/detail`);
  const detail2 = curlGet(`/v2/posts/${encodeURIComponent(one)}/detail`);
  if (detail1.status !== 200 || detail2.status !== 200) throw new Error("single_detail_failed");

  console.log(
    JSON.stringify(
      {
        event: "post_detail_hydration_debug",
        postIds,
        batchFound: found.length,
        batchMissing: batch.body?.data?.missing ?? [],
        requiredFieldErrors: fieldErrors,
        firstDetailSource: detail1.body?.data?.debugHydrationSource ?? null,
        secondDetailSource: detail2.body?.data?.debugHydrationSource ?? null,
        firstReads: detail1.body?.meta?.db?.reads ?? null,
        secondReads: detail2.body?.meta?.db?.reads ?? null,
        firstDurationMs: detail1.body?.data?.debugDurationMs ?? null,
        secondDurationMs: detail2.body?.data?.debugDurationMs ?? null
      },
      null,
      2
    )
  );
}

main();
