const port = Number(process.env.PORT ?? 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const viewerId = process.env.DEBUG_VIEWER_ID ?? "debug-feed-for-you-audit";
const endpoint = "/v2/feed/for-you";

type Row = {
  page: string;
  status: number;
  latencyMs: number;
  returnedCount: number;
  reelCount: number;
  regularCount: number;
  recycledCount: number;
  servedWriteCount: number;
  servedWriteOk: boolean;
  queries: number;
  readEstimate: number;
  budgetCapped: boolean;
  rankingVersion: string;
};

function hasFakeFallback(items: Array<{ postId?: string }>): boolean {
  const tokens = ["fake", "fallback", "demo", "placeholder", "synthetic", "seed", "internal-viewer-feed-post"];
  return items.some((item) => tokens.some((token) => String(item.postId ?? "").toLowerCase().includes(token)));
}

async function hit(cursor: string | null, page: string): Promise<{ row: Row; ids: string[]; nextCursor: string | null; ok: boolean }> {
  const params = new URLSearchParams({ viewerId, limit: "5", debug: "1" });
  if (cursor) params.set("cursor", cursor);
  const url = `${baseUrl}${endpoint}?${params.toString()}`;
  const started = Date.now();
  const res = await fetch(url, { headers: { "x-viewer-id": viewerId, "x-viewer-roles": "internal" } });
  const text = await res.text();
  const latencyMs = Date.now() - started;
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const data = json?.data ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const ids = items.map((item: { postId?: string }) => String(item.postId ?? "")).filter(Boolean);
  const dedupedIds = new Set(ids);
  const reelCount = items.filter((item: { media?: { type?: string } }) => item.media?.type === "video").length;
  const regularCount = items.length - reelCount;
  const nextCursor = typeof data.nextCursor === "string" && data.nextCursor ? data.nextCursor : null;
  const row: Row = {
    page,
    status: res.status,
    latencyMs,
    returnedCount: items.length,
    reelCount: Number(data.debug?.reelCount ?? reelCount),
    regularCount: Number(data.debug?.regularCount ?? regularCount),
    recycledCount: Number(data.debug?.recycledCount ?? 0),
    servedWriteCount: Number(data.debug?.servedWriteCount ?? 0),
    servedWriteOk: Boolean(data.debug?.servedWriteOk ?? false),
    queries: Number(data.debug?.queryCountEstimate ?? 0),
    readEstimate: Number(data.debug?.readEstimate ?? 0),
    budgetCapped: Boolean(data.debug?.budgetCapped ?? false),
    rankingVersion: String(data.debug?.rankingVersion ?? "")
  };

  const hasDebugEssentials = Boolean(data?.debug?.requestId) && Boolean(data?.debug?.rankingVersion);
  const ok = res.ok && !hasFakeFallback(items) && hasDebugEssentials && dedupedIds.size === ids.length;
  return { row, ids, nextCursor, ok };
}

function printTable(rows: Row[]): void {
  const cols: Array<keyof Row> = [
    "page",
    "status",
    "latencyMs",
    "returnedCount",
    "reelCount",
    "regularCount",
    "recycledCount",
    "servedWriteCount",
    "servedWriteOk",
    "queries",
    "readEstimate",
    "budgetCapped",
    "rankingVersion"
  ];
  const widths = new Map<keyof Row, number>();
  for (const col of cols) {
    const maxVal = Math.max(String(col).length, ...rows.map((row) => String(row[col]).length));
    widths.set(col, maxVal + 2);
  }
  const line = cols.map((col) => String(col).padEnd(widths.get(col)!)).join("");
  console.log(line);
  for (const row of rows) {
    console.log(cols.map((col) => String(row[col]).padEnd(widths.get(col)!)).join(""));
  }
}

async function main(): Promise<void> {
  // Warm request (ignored thresholds).
  await hit(null, "warmup");
  const first = await hit(null, "1");
  const second = await hit(first.nextCursor, "2");
  const restart = await hit(null, "restart");

  const rows = [first.row, second.row, restart.row];
  printTable(rows);

  const errors: string[] = [];
  if (!first.ok) errors.push("page1_failed_validation");
  if (!second.ok) errors.push("page2_failed_validation");
  if (first.row.latencyMs > 500) errors.push(`page1_latency_exceeded:${first.row.latencyMs}`);
  if (first.row.readEstimate > 120) errors.push(`page1_reads_exceeded:${first.row.readEstimate}`);
  if (first.row.queries > 8) errors.push(`page1_queries_exceeded:${first.row.queries}`);
  if (first.row.returnedCount === 0) errors.push("page1_zero_items_with_inventory");
  if (first.row.rankingVersion !== "fast-reel-first-v2") errors.push(`unexpected_ranking_version:${first.row.rankingVersion}`);
  for (const row of rows) {
    if (row.readEstimate > 200) errors.push(`reads_exceeded_${row.page}:${row.readEstimate}`);
  }
  const overlap = second.ids.filter((id) => first.ids.includes(id));
  if (overlap.length > 0 && second.row.returnedCount > 0) errors.push(`duplicate_post_ids_across_pages:${overlap.join(",")}`);

  if (errors.length > 0) {
    console.error(`[budget:feed-for-you] FAILED ${errors.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[budget:feed-for-you] PASS endpoint=${baseUrl}${endpoint}`);
}

main().catch((error) => {
  console.error(`[budget:feed-for-you] ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
