import { execFileSync } from "node:child_process";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const FORBIDDEN = [/fake/i, /fallback/i, /demo/i, /placeholder/i, /synthetic/i, /seed/i, /internal-viewer-feed-post/i];

type CurlResult = { status: number; body: Record<string, unknown> };

function curl(path: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>): CurlResult {
  const args = [
    "-sS",
    "-X",
    method,
    "-H",
    `x-viewer-id: ${VIEWER_ID}`,
    "-H",
    "x-viewer-roles: internal",
    "-w",
    "\n%{http_code}"
  ];
  if (body) {
    args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  }
  args.push(`${BASE_URL}${path}`);
  const raw = execFileSync("curl", args, { encoding: "utf8" });
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const statusText = idx >= 0 ? raw.slice(idx + 1).trim() : "0";
  return {
    status: Number(statusText) || 0,
    body: JSON.parse(bodyText || "{}") as Record<string, unknown>
  };
}

function getV2Items(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  const firstRender = (data.firstRender as Record<string, unknown> | undefined) ?? {};
  const feed = (firstRender.feed as Record<string, unknown> | undefined) ?? {};
  return ((feed.items as Array<Record<string, unknown>> | undefined) ?? []).filter(Boolean);
}

function getV2NextCursor(payload: Record<string, unknown>): string | null {
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  const firstRender = (data.firstRender as Record<string, unknown> | undefined) ?? {};
  const feed = (firstRender.feed as Record<string, unknown> | undefined) ?? {};
  const page = (feed.page as Record<string, unknown> | undefined) ?? {};
  return (page.nextCursor as string | null | undefined) ?? null;
}

function getPageItems(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  return ((data.items as Array<Record<string, unknown>> | undefined) ?? []).filter(Boolean);
}

function detectFake(items: Array<Record<string, unknown>>): boolean {
  return items.some((item) => FORBIDDEN.some((re) => re.test(String(item.postId ?? ""))));
}

function assertMediaAndShape(items: Array<Record<string, unknown>>, label: string): void {
  for (const item of items) {
    const postId = String(item.postId ?? "").trim();
    const author = (item.author as Record<string, unknown> | undefined) ?? {};
    const media = (item.media as Record<string, unknown> | undefined) ?? {};
    const userId = String(author.userId ?? "").trim();
    const posterUrl = String(media.posterUrl ?? "").trim();
    if (!postId || !userId || !posterUrl) {
      throw new Error(`${label}:missing_required_fields postId=${postId} userId=${userId} poster=${posterUrl}`);
    }
  }
}

function main(): void {
  const bootstrap = curl("/v2/feed/bootstrap?limit=5");
  if (bootstrap.status !== 200) {
    throw new Error(`bootstrap_status_${bootstrap.status}`);
  }
  const debugSource = String((bootstrap.body.data as Record<string, unknown> | undefined)?.debugFeedSource ?? "unknown");
  const bootstrapItems = getV2Items(bootstrap.body);
  const bootstrapCursor = getV2NextCursor(bootstrap.body);
  const first = bootstrapItems[0] ?? {};
  console.log("[reels-parity] bootstrap", {
    status: bootstrap.status,
    debugFeedSource: debugSource,
    count: bootstrapItems.length,
    samplePostIds: bootstrapItems.slice(0, 5).map((i) => i.postId),
    firstMediaUrl: (first.media as Record<string, unknown> | undefined)?.posterUrl ?? null,
    firstUserId: (first.author as Record<string, unknown> | undefined)?.userId ?? null
  });
  if (detectFake(bootstrapItems)) throw new Error("bootstrap_fake_fallback_detected");
  assertMediaAndShape(bootstrapItems, "bootstrap");

  let pageItems: Array<Record<string, unknown>> = [];
  if (bootstrapCursor) {
    const page = curl(`/v2/feed/page?limit=5&cursor=${encodeURIComponent(bootstrapCursor)}`);
    if (page.status !== 200) throw new Error(`page_status_${page.status}`);
    pageItems = getPageItems(page.body);
    console.log("[reels-parity] page", {
      status: page.status,
      count: pageItems.length,
      samplePostIds: pageItems.slice(0, 5).map((i) => i.postId)
    });
    if (detectFake(pageItems)) throw new Error("page_fake_fallback_detected");
    assertMediaAndShape(pageItems, "page");
  } else {
    console.log("[reels-parity] page", { skipped: true, reason: "no_cursor" });
  }

  const oldBootstrap = curl("/api/v1/product/reels/bootstrap?limit=5");
  const oldItems = ((oldBootstrap.body.posts ?? oldBootstrap.body.items ?? []) as Array<Record<string, unknown>>).filter(Boolean);
  console.log("[reels-parity] old-bootstrap", {
    status: oldBootstrap.status,
    count: oldItems.length,
    samplePostIds: oldItems.slice(0, 5).map((i) => i.postId ?? i.id)
  });

  if (bootstrapItems.length === 0 && oldBootstrap.status === 200 && oldItems.length > 0) {
    throw new Error("v2_empty_but_old_backend_has_posts");
  }
  if (bootstrapItems.length === 0 && oldBootstrap.status !== 200) {
    throw new Error("v2_empty_without_old_backend_parity");
  }
}

main();
