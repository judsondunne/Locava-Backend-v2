import { execFileSync } from "node:child_process";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";

type CurlResult = { status: number; body: any };

function curl(path: string): CurlResult {
  const raw = execFileSync(
    "curl",
    [
      "-sS",
      "-H",
      `x-viewer-id: ${VIEWER_ID}`,
      "-H",
      "x-viewer-roles: internal",
      "-w",
      "\n%{http_code}",
      `${BASE_URL}${path}`
    ],
    { encoding: "utf8" }
  );
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const statusText = idx >= 0 ? raw.slice(idx + 1).trim() : "0";
  const status = Number(statusText) || 0;
  const body = JSON.parse(bodyText || "{}");
  return { status, body };
}

function classify(result: CurlResult): "backendv2_firestore" | "unavailable_503" | "fake_fallback_detected" {
  if (result.status === 503) return "unavailable_503";
  const source = String(result.body?.data?.debugFeedSource ?? "").toLowerCase();
  if (source === "backendv2_firestore") return "backendv2_firestore";

  const items = Array.isArray(result.body?.data?.items)
    ? result.body.data.items
    : Array.isArray(result.body?.data?.firstRender?.feed?.items)
      ? result.body.data.firstRender.feed.items
      : [];
  const hasForbiddenId = items.some((item: Record<string, unknown>) =>
    /fake|fallback|demo|placeholder|synthetic|seed|internal-viewer-feed-post/i.test(String(item?.postId ?? ""))
  );
  const hasForbiddenSource = /fake|fallback|demo|placeholder|synthetic|seed|local/i.test(source);
  if (hasForbiddenId || hasForbiddenSource) return "fake_fallback_detected";
  return "unavailable_503";
}

function printResult(kind: ReturnType<typeof classify>): void {
  if (kind === "backendv2_firestore") console.log("PASS backendv2_firestore");
  else if (kind === "fake_fallback_detected") console.log("FAIL fake_fallback_detected");
  else console.log("FAIL unavailable_503");
}

function main(): void {
  const bootstrap = curl("/v2/feed/bootstrap?limit=5");
  const page = curl("/v2/feed/page?cursor=cursor%3A5&limit=5");
  const b = classify(bootstrap);
  const p = classify(page);
  printResult(b);
  printResult(p);
  if (b === "backendv2_firestore") {
    if (p === "backendv2_firestore") {
      process.exit(0);
    }
  }
  process.exit(1);
}

main();
