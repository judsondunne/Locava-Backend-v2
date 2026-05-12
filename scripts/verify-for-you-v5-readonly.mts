/**
 * Read-only smoke harness for For You V5 against a running local Backendv2.
 *
 * Prerequisites:
 * - Server running, e.g. `npm run dev`
 * - No server `.env` is required for V5 itself (defaults are on). This client sends `dryRunSeen=1`
 *   and `x-locava-readonly: 1` so the server skips compact seen writes for this run.
 *
 * HTTP GET only — no Firestore writes from this script.
 *
 * What this validates:
 * - Cursor-chain dedupe: no duplicate post IDs across ~40 paginated requests with a single cursor chain.
 * - Durable fresh-session dedupe is NOT tested here because seen writes are disabled / dry-run.
 * - Repeated no-cursor first-page requests MAY return overlapping posts in readonly mode (expected).
 *
 * Usage:
 *   FOR_YOU_V5_VERIFY_BASE_URL=http://127.0.0.1:8080 npm run verify:for-you-v5:readonly
 */
const baseUrl = (process.env.FOR_YOU_V5_VERIFY_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const viewerId =
  process.env.FOR_YOU_V5_VERIFY_VIEWER_ID ?? `readonly-for-you-v5-smoke-${Date.now()}`;

type Row = {
  page: number;
  elapsedMs: number;
  returnedCount: number;
  phase: string;
  reelCount: number;
  regularCount: number;
  duplicateCount: number;
  dbReadEstimate: number;
  cacheStatus: string;
  nextCursorPresent: boolean;
};

function extractPostId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  if (typeof r.postId === "string") return r.postId;
  return null;
}

function hasNativeCardShape(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const r = item as Record<string, unknown>;
  if (r.appPostV2 && typeof r.appPostV2 === "object") return true;
  if (r.appPost && typeof r.appPost === "object") return true;
  if (typeof r.posterUrl === "string" && r.posterUrl.length > 0) return true;
  return false;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  const allIds: string[] = [];
  const latencies: number[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 40; page += 1) {
    const qs = new URLSearchParams({ limit: "5", debug: "1", dryRunSeen: "1", viewerId });
    if (cursor) qs.set("cursor", cursor);
    const url = `${baseUrl}/v2/feed/for-you/simple?${qs.toString()}`;
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: {
        "x-locava-readonly": "1",
        "x-viewer-id": viewerId,
      },
    });
    const elapsedMs = Date.now() - t0;
    latencies.push(elapsedMs);
    const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown> };
    if (!res.ok || body?.ok !== true) {
      console.error("Request failed", res.status, body);
      process.exit(1);
    }
    const data = body.data ?? {};
    const items = (data.items as unknown[]) ?? [];
    const debug = (data.debug as Record<string, unknown>) ?? {};
    const ids = items.map(extractPostId).filter((x): x is string => Boolean(x));
    const seenBefore = new Set(allIds);
    let pageDupes = 0;
    for (const id of ids) {
      if (seenBefore.has(id)) pageDupes += 1;
      allIds.push(id);
    }
    const reelCount = Number(debug.reelReturnedCount ?? 0);
    const regularCount = Number(debug.fallbackReturnedCount ?? 0);
    rows.push({
      page: page + 1,
      elapsedMs,
      returnedCount: items.length,
      phase: String(debug.activePhase ?? ""),
      reelCount,
      regularCount,
      duplicateCount: pageDupes,
      dbReadEstimate: Number(debug.dbReadEstimate ?? debug.dbReads ?? 0),
      cacheStatus: String(debug.deckSource ?? ""),
      nextCursorPresent: Boolean(data.nextCursor),
    });
    if (items.length > 0 && !hasNativeCardShape(items[0])) {
      console.error("Missing native card media shape on first item");
      process.exit(1);
    }
    cursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
    if (!cursor) break;
  }

  const uniq = new Set(allIds);
  const dupes = allIds.length - uniq.size;
  const warm = latencies.slice(5);
  const sortedLat = [...warm].sort((a, b) => a - b);
  const p95 = sortedLat.length ? sortedLat[Math.min(sortedLat.length - 1, Math.floor(sortedLat.length * 0.95))] : 0;

  console.log("For You V5 read-only harness");
  console.log("baseUrl", baseUrl, "viewerId", viewerId);
  console.log("totalPosts", allIds.length, "unique", uniq.size, "globalDupes", dupes);
  console.log("p95LatencyMs (pages 6+, warm)", p95);
  console.table(rows);
  if (dupes > 0) {
    console.error("Duplicate post IDs across run");
    process.exit(1);
  }
  if (p95 > 500) {
    console.warn("WARN: warm p95 latency > 500ms");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
