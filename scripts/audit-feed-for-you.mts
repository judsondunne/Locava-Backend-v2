const port = Number(process.env.PORT ?? 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const viewerId = process.env.DEBUG_VIEWER_ID ?? "debug-feed-for-you-audit";
const endpoint = "/v2/feed/for-you";

type Row = {
  page: string;
  status: number;
  latencyMs: number;
  reads: number;
  writes: number;
  queries: number;
  returnedCount: number;
  reelCount: number;
  regularCount: number;
  recycledRegularCount: number;
  reelQueueIndex: number;
  reelQueueCount: number;
  remainingReels: number;
  exhausted: boolean;
  engineVersion: string;
};

function print(rows: Row[]) {
  const cols: Array<keyof Row> = [
    "page",
    "status",
    "latencyMs",
    "reads",
    "writes",
    "queries",
    "returnedCount",
    "reelCount",
    "regularCount",
    "recycledRegularCount",
    "reelQueueIndex",
    "reelQueueCount",
    "remainingReels",
    "exhausted",
    "engineVersion"
  ];
  const widths = cols.map((col) => Math.max(String(col).length, ...rows.map((row) => String(row[col]).length)) + 2);
  console.log(cols.map((col, index) => String(col).padEnd(widths[index])).join(""));
  for (const row of rows) console.log(cols.map((col, index) => String(row[col]).padEnd(widths[index])).join(""));
}

async function hit(cursor: string | null, page: string) {
  const params = new URLSearchParams({ viewerId, limit: "5", debug: "1" });
  if (cursor) params.set("cursor", cursor);
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}${endpoint}?${params.toString()}`, {
    headers: { "x-viewer-id": viewerId, "x-viewer-roles": "internal" }
  });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  const meta = body?.meta?.db ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    ids: items.map((item: { postId?: string }) => String(item.postId ?? "")).filter(Boolean),
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
    exhausted: Boolean(data.exhausted),
    row: {
      page,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      reads: Number(meta.reads ?? 0),
      writes: Number(meta.writes ?? 0),
      queries: Number(meta.queries ?? 0),
      returnedCount: items.length,
      reelCount: Number(data.debug?.reelCount ?? 0),
      regularCount: Number(data.debug?.regularCount ?? 0),
      recycledRegularCount: Number(data.debug?.recycledRegularCount ?? 0),
      reelQueueIndex: Number(data.feedState?.reelQueueIndex ?? 0),
      reelQueueCount: Number(data.feedState?.reelQueueCount ?? 0),
      remainingReels: Number(data.feedState?.remainingReels ?? 0),
      exhausted: Boolean(data.exhausted),
      engineVersion: String(data.debug?.engineVersion ?? "")
    }
  };
}

async function main(): Promise<void> {
  await hit(null, "warmup");
  const first = await hit(null, "first");
  const second = await hit(first.nextCursor, "second");
  const restart = await hit(null, "restart");

  print([first.row, second.row, restart.row]);

  const errors: string[] = [];
  if (first.row.engineVersion !== "queue-reels-v1") errors.push(`unexpected_engine_version:${first.row.engineVersion}`);
  if (first.row.returnedCount === 0) errors.push("first_page_zero_items");
  if (first.row.reads > 80) errors.push(`reads_exceeded:${first.row.reads}`);
  if (first.row.queries > 6) errors.push(`queries_exceeded:${first.row.queries}`);
  if (first.row.remainingReels > 0) {
    const overlap = second.ids.filter((id) => first.ids.includes(id));
    if (overlap.length > 0) errors.push(`duplicate_ids_across_pages:${overlap.join(",")}`);
    const restartOverlap = restart.ids.filter((id) => first.ids.includes(id));
    if (restartOverlap.length > 0) errors.push(`restart_repeated_first_page:${restartOverlap.join(",")}`);
  }

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
