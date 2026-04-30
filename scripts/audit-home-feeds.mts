const port = Number(process.env.PORT ?? 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const viewerId = process.env.DEBUG_VIEWER_ID ?? "debug-home-feeds-audit";

type Row = {
  feed: "for_you" | "following";
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

function headers() {
  return { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };
}

function print(rows: Row[]) {
  const cols: Array<keyof Row> = [
    "feed",
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

async function hitForYou(page: string, cursor: string | null) {
  const params = new URLSearchParams({ viewerId, limit: "5", debug: "1" });
  if (cursor) params.set("cursor", cursor);
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/v2/feed/for-you?${params.toString()}`, { headers: headers() });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  const meta = body?.meta?.db ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const ids = items.map((item: { postId?: string }) => String(item.postId ?? "")).filter(Boolean);
  return {
    ids,
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
    exhausted: Boolean(data.exhausted),
    emptyReason: typeof data.debug?.emptyReason === "string" ? data.debug.emptyReason : null,
    row: {
      feed: "for_you" as const,
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

async function hitFollowing(page: string, cursor: string | null) {
  const path = cursor
    ? `/v2/feed/page?tab=following&limit=5&cursor=${encodeURIComponent(cursor)}`
    : `/v2/feed/bootstrap?tab=following&limit=5`;
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}${path}`, { headers: headers() });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  const meta = body?.meta?.db ?? {};
  const items = cursor ? (Array.isArray(data.items) ? data.items : []) : (Array.isArray(data.firstRender?.feed?.items) ? data.firstRender.feed.items : []);
  const pageNode = cursor ? data.page ?? {} : data.firstRender?.feed?.page ?? {};
  return {
    ids: items.map((item: { postId?: string }) => String(item.postId ?? "")).filter(Boolean),
    nextCursor: typeof pageNode.nextCursor === "string" ? pageNode.nextCursor : null,
    exhausted: !pageNode.nextCursor,
    row: {
      feed: "following" as const,
      page,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      reads: Number(meta.reads ?? 0),
      writes: Number(meta.writes ?? 0),
      queries: Number(meta.queries ?? 0),
      returnedCount: items.length,
      reelCount: items.filter((item: any) => item?.media?.type === "video").length,
      regularCount: items.filter((item: any) => item?.media?.type !== "video").length,
      recycledRegularCount: 0,
      reelQueueIndex: 0,
      reelQueueCount: 0,
      remainingReels: 0,
      exhausted: !pageNode.nextCursor,
      engineVersion: "following-v2"
    }
  };
}

function assertNoWithinPageDuplicates(ids: string[], label: string, errors: string[]) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate_ids:${label}:${id}`);
    seen.add(id);
  }
}

async function main() {
  await hitForYou("warmup1", null);
  await hitForYou("warmup2", null);
  await hitForYou("warmup3", null);
  const warm = await hitForYou("warm", null);
  const first = await hitForYou("first", null);
  const second = await hitForYou("second", first.nextCursor);
  const restart = await hitForYou("restart", null);
  const followingFirst = await hitFollowing("first", null);
  const followingSecond = await hitFollowing("second", followingFirst.nextCursor);

  const rows = [warm.row, first.row, second.row, restart.row, followingFirst.row, followingSecond.row];
  print(rows);

  const errors: string[] = [];
  assertNoWithinPageDuplicates(first.ids, "for_you:first", errors);
  assertNoWithinPageDuplicates(second.ids, "for_you:second", errors);
  assertNoWithinPageDuplicates(restart.ids, "for_you:restart", errors);

  if (warm.row.latencyMs > 500) errors.push(`latency_warm_gt_500:${warm.row.latencyMs}`);
  if (first.row.engineVersion !== "queue-reels-v1") errors.push(`engine_version_bad:${first.row.engineVersion}`);
  if (first.row.reads > 80) errors.push(`reads_gt_80:${first.row.reads}`);
  if (first.row.queries > 6) errors.push(`queries_gt_6:${first.row.queries}`);
  if (first.row.returnedCount === 0) errors.push("returnedCount_eq_0_while_posts_exist");
  if (first.row.exhausted && (first.row.remainingReels > 0 || first.row.regularCount > 0 || first.row.recycledRegularCount > 0)) {
    errors.push("exhausted_true_after_first_page_while_posts_remain");
  }
  if (first.row.remainingReels > 0) {
    const overlap = second.ids.filter((id) => first.ids.includes(id));
    if (overlap.length > 0) errors.push(`first_equals_second_with_remaining_reels:${overlap.join(",")}`);
    const restartOverlap = restart.ids.filter((id) => first.ids.includes(id));
    if (restartOverlap.length > 0) errors.push(`restart_repeated_first_page_with_remaining_reels:${restartOverlap.join(",")}`);
  }
  if (!first.nextCursor && !first.row.exhausted) errors.push("next_cursor_missing_while_not_exhausted");
  if (second.row.returnedCount === 0 && !second.row.exhausted && second.emptyReason !== "no_eligible_posts") {
    errors.push("page2_zero_without_meaningful_empty_reason");
  }

  if (errors.length > 0) {
    console.error(`[budget:home-feeds] FAILED ${errors.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("[budget:home-feeds] PASS");
}

main().catch((error) => {
  console.error(`[budget:home-feeds] ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
