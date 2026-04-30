import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

const port = Number(process.env.PORT ?? 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const viewerId = process.env.DEBUG_VIEWER_ID ?? "debug-home-feeds-audit";

type ForYouRow = {
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
  reelQueueIndexBefore: number;
  reelQueueIndexAfter: number;
  reelQueueCount: number;
  regularQueueIndexBefore: number;
  regularQueueIndexAfter: number;
  regularQueueCount: number;
  remainingReels: number;
  remainingRegular: number;
  exhausted: boolean;
  engineVersion: string;
  nextCursorPresent: boolean;
  postIdsReturned: string[];
};

function headers() {
  return { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };
}

async function resetFeedState(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  await db.collection("users").doc(viewerId).collection("feedState").doc("home_for_you").delete().catch(() => undefined);
}

function printRows(rows: ForYouRow[]) {
  console.table(
    rows.map((row) => ({
      page: row.page,
      status: row.status,
      latencyMs: row.latencyMs,
      reads: row.reads,
      writes: row.writes,
      queries: row.queries,
      returnedCount: row.returnedCount,
      reelCount: row.reelCount,
      regularCount: row.regularCount,
      recycledRegularCount: row.recycledRegularCount,
      reelQueueIndexBefore: row.reelQueueIndexBefore,
      reelQueueIndexAfter: row.reelQueueIndexAfter,
      regularQueueIndexBefore: row.regularQueueIndexBefore,
      regularQueueIndexAfter: row.regularQueueIndexAfter,
      remainingReels: row.remainingReels,
      remainingRegular: row.remainingRegular,
      exhausted: row.exhausted,
      engineVersion: row.engineVersion,
      nextCursorPresent: row.nextCursorPresent,
    })),
  );
  for (const row of rows) {
    console.log(`[budget:home-feeds] ${row.page} ids=${row.postIdsReturned.join(",")}`);
  }
}

async function hitForYou(page: string, cursor: string | null): Promise<{ row: ForYouRow; nextCursor: string | null }> {
  const params = new URLSearchParams({ viewerId, limit: "5", debug: "1" });
  if (cursor) params.set("cursor", cursor);
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/v2/feed/for-you?${params.toString()}`, { headers: headers() });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  const meta = body?.meta?.db ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const postIdsReturned = items.map((item: { postId?: string }) => String(item.postId ?? "")).filter(Boolean);
  return {
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
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
      reelQueueIndexBefore: Number(data.debug?.reelQueueIndexBefore ?? 0),
      reelQueueIndexAfter: Number(data.debug?.reelQueueIndexAfter ?? 0),
      reelQueueCount: Number(data.debug?.reelQueueCount ?? data.feedState?.reelQueueCount ?? 0),
      regularQueueIndexBefore: Number(data.debug?.regularQueueIndexBefore ?? 0),
      regularQueueIndexAfter: Number(data.debug?.regularQueueIndexAfter ?? 0),
      regularQueueCount: Number(data.debug?.regularQueueCount ?? data.feedState?.regularQueueCount ?? 0),
      remainingReels: Number(data.debug?.remainingReels ?? data.feedState?.remainingReels ?? 0),
      remainingRegular: Number(data.debug?.remainingRegular ?? data.feedState?.remainingRegular ?? 0),
      exhausted: Boolean(data.exhausted),
      engineVersion: String(data.debug?.engineVersion ?? ""),
      nextCursorPresent: Boolean(data.nextCursor),
      postIdsReturned,
    },
  };
}

function hasOverlap(a: string[], b: string[]): boolean {
  const seen = new Set(a);
  return b.some((id) => seen.has(id));
}

async function main() {
  await resetFeedState();
  const first = await hitForYou("page1", null);
  const second = await hitForYou("page2", first.nextCursor);
  const third = await hitForYou("page3", second.nextCursor);
  const restart = await hitForYou("restart", null);
  const rows = [first.row, second.row, third.row, restart.row];
  printRows(rows);

  const errors: string[] = [];
  for (const row of rows) {
    if (row.engineVersion !== "queue-reels-regular-v2") errors.push(`engineVersion_bad:${row.page}:${row.engineVersion}`);
    if (row.returnedCount === 5 && !row.nextCursorPresent) errors.push(`nextCursor_missing:${row.page}`);
    if (row.recycledRegularCount !== 0) errors.push(`recycledRegularCount_nonzero:${row.page}:${row.recycledRegularCount}`);
    if (row.returnedCount > 0 && row.postIdsReturned.length !== row.returnedCount) errors.push(`postIdsReturned_mismatch:${row.page}`);
    if (row.regularCount > 0 && row.regularQueueIndexAfter <= row.regularQueueIndexBefore) {
      errors.push(`regularQueueIndex_not_advanced:${row.page}`);
    }
    if (row.regularCount > 0 && row.regularCount !== row.postIdsReturned.length - row.reelCount) {
      errors.push(`regularCount_mismatch:${row.page}`);
    }
    if (row.exhausted && (row.remainingReels > 0 || row.remainingRegular > 0)) {
      errors.push(`exhausted_with_remaining:${row.page}`);
    }
    if (row.returnedCount === 0 && (row.remainingReels > 0 || row.remainingRegular > 0)) {
      errors.push(`returnedCount_zero_with_remaining:${row.page}`);
    }
  }

  if (hasOverlap(first.row.postIdsReturned, second.row.postIdsReturned)) errors.push("page1_page2_overlap");
  if (hasOverlap(second.row.postIdsReturned, third.row.postIdsReturned)) errors.push("page2_page3_overlap");
  if (first.row.remainingReels > 0 && hasOverlap(first.row.postIdsReturned, restart.row.postIdsReturned)) {
    errors.push("restart_repeated_page1_while_reels_remaining");
  }

  const warmCandidate = second.row.returnedCount > 0 ? second.row : third.row;
  if (warmCandidate.latencyMs > 300) errors.push(`warm_latency_gt_300:${warmCandidate.latencyMs}`);
  if (warmCandidate.reads > 15) errors.push(`warm_reads_gt_15:${warmCandidate.reads}`);
  if (warmCandidate.writes > 1) errors.push(`warm_writes_gt_1:${warmCandidate.writes}`);

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
