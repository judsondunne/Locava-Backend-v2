import { execFileSync } from "node:child_process";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const INVALID_SOURCE = ["monolith_proxy", "legacy", "fallback", "fake", "demo", "unavailable"];

type CurlResult = { status: number; body: Record<string, unknown> };

function curl(path: string): CurlResult {
  const raw = execFileSync(
    "curl",
    ["-sS", "-H", `x-viewer-id: ${VIEWER_ID}`, "-H", "x-viewer-roles: internal", "-w", "\n%{http_code}", `${BASE_URL}${path}`],
    { encoding: "utf8" }
  );
  const idx = raw.lastIndexOf("\n");
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  const status = Number((idx >= 0 ? raw.slice(idx + 1) : "0").trim()) || 0;
  return { status, body: JSON.parse(bodyText || "{}") as Record<string, unknown> };
}

function assertSource(label: string, data: Record<string, unknown>): void {
  const source = String(data.debugFeedSource ?? "").toLowerCase();
  if (source !== "backendv2_firestore") {
    throw new Error(`${label}:invalid_source:${source || "missing"}`);
  }
  if (INVALID_SOURCE.some((token) => source.includes(token))) {
    throw new Error(`${label}:forbidden_source:${source}`);
  }
}

function extractBootstrap(data: Record<string, unknown>) {
  const firstRender = (data.firstRender as Record<string, unknown> | undefined) ?? {};
  const feed = (firstRender.feed as Record<string, unknown> | undefined) ?? {};
  const page = (feed.page as Record<string, unknown> | undefined) ?? {};
  const items = ((feed.items as Array<Record<string, unknown>> | undefined) ?? []).filter(Boolean);
  return { items, nextCursor: (page.nextCursor as string | null | undefined) ?? null };
}

function extractPage(data: Record<string, unknown>) {
  const page = (data.page as Record<string, unknown> | undefined) ?? {};
  const items = ((data.items as Array<Record<string, unknown>> | undefined) ?? []).filter(Boolean);
  return { items, nextCursor: (page.nextCursor as string | null | undefined) ?? null };
}

function assertItems(label: string, items: Array<Record<string, unknown>>): void {
  for (const row of items) {
    const postId = String(row.postId ?? "");
    const author = (row.author as Record<string, unknown> | undefined) ?? {};
    const media = (row.media as Record<string, unknown> | undefined) ?? {};
    if (!postId || !String(author.userId ?? "") || !String(media.posterUrl ?? "")) {
      throw new Error(`${label}:missing_required_fields:${postId || "unknown"}`);
    }
  }
}

function main(): void {
  const bootstrap = curl("/v2/feed/bootstrap?limit=5");
  if (bootstrap.status !== 200) throw new Error(`bootstrap_status_${bootstrap.status}`);
  const bData = (bootstrap.body.data as Record<string, unknown> | undefined) ?? {};
  assertSource("bootstrap", bData);
  const b = extractBootstrap(bData);
  assertItems("bootstrap", b.items);
  if (b.items.length === 0) throw new Error("bootstrap_zero_items_firestore");
  console.log("[feed-v2-only] bootstrap", {
    source: bData.debugFeedSource,
    count: b.items.length,
    sampleIds: b.items.slice(0, 5).map((i) => i.postId),
    firstMediaUrl: ((b.items[0]?.media as Record<string, unknown> | undefined)?.posterUrl ?? null),
    reads: bData.debugCandidateReads ?? null,
    dropReasons: bData.debugFilterDropReasons ?? null
  });

  if (b.nextCursor) {
    const page = curl(`/v2/feed/page?limit=5&cursor=${encodeURIComponent(b.nextCursor)}`);
    if (page.status !== 200) throw new Error(`page_status_${page.status}`);
    const pData = (page.body.data as Record<string, unknown> | undefined) ?? {};
    assertSource("page", pData);
    const p = extractPage(pData);
    assertItems("page", p.items);
    console.log("[feed-v2-only] page", {
      source: pData.debugFeedSource,
      count: p.items.length,
      sampleIds: p.items.slice(0, 5).map((i) => i.postId),
      reads: pData.debugCandidateReads ?? null,
      dropReasons: pData.debugFilterDropReasons ?? null
    });
  }

  const following = curl("/v2/feed/bootstrap?tab=following&limit=5");
  if (following.status !== 200 && following.status !== 503) {
    throw new Error(`following_status_${following.status}`);
  }
  if (following.status === 200) {
    const fData = (following.body.data as Record<string, unknown> | undefined) ?? {};
    assertSource("following", fData);
    const f = extractBootstrap(fData);
    assertItems("following", f.items);
    console.log("[feed-v2-only] following", {
      source: fData.debugFeedSource,
      count: f.items.length,
      sampleIds: f.items.slice(0, 5).map((i) => i.postId)
    });
  } else {
    console.log("[feed-v2-only] following", { status: 503, reason: "no_eligible_posts_or_firestore_unavailable" });
  }

  const radius = curl("/v2/feed/bootstrap?limit=5&lat=37.7749&lng=-122.4194&radiusKm=8");
  if (radius.status === 200) {
    const rData = (radius.body.data as Record<string, unknown> | undefined) ?? {};
    assertSource("radius", rData);
    const r = extractBootstrap(rData);
    assertItems("radius", r.items);
    console.log("[feed-v2-only] radius", { source: rData.debugFeedSource, count: r.items.length, sampleIds: r.items.slice(0, 3).map((i) => i.postId) });
  } else if (radius.status === 501 || radius.status === 503) {
    console.log("[feed-v2-only] radius", { status: radius.status, reason: "geo_not_ready_or_no_eligible_posts" });
  } else {
    throw new Error(`radius_status_${radius.status}`);
  }
}

main();
