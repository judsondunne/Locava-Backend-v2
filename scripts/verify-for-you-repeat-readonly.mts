/**
 * Read-only harness for the "For You repeats the same posts" bug.
 *
 * Simulates two cold-start sessions against /v2/feed/for-you/simple and reports:
 *   - Page-1 IDs of session A
 *   - Page-2 IDs of session A (cursor-chained)
 *   - Page-1 IDs of session B without `excludeIds` (cold restart, no client memory)
 *   - Page-1 IDs of session B WITH `excludeIds` from session A (the fix path)
 *   - Overlap counts and timing
 *
 * Hard safety rules:
 *   - HTTP GET only. Never sets `markServed=1`.
 *   - Sends `x-locava-readonly: 1` and `dryRunSeen=1` so the backend skips the
 *     compact seen write for V5 even when feature flags are on.
 *   - Uses a unique viewer id per invocation (`harness-...`) so it never touches
 *     real user state.
 *   - Loudly prints `READ ONLY` and aborts if env hints at writes.
 *
 * Usage:
 *   FOR_YOU_REPEAT_BASE_URL=http://127.0.0.1:8080 \
 *     npm run verify:for-you-repeat:readonly
 *
 * Optional env:
 *   FOR_YOU_REPEAT_PAGE_SIZE   default 5 (matches Native FOR_YOU_RECO_PAGE_SIZE)
 *   FOR_YOU_REPEAT_VIEWER_ID   override the synthetic viewer id (must start with "harness-")
 */

const baseUrl = (process.env.FOR_YOU_REPEAT_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const pageSize = Math.max(1, Math.min(20, Number(process.env.FOR_YOU_REPEAT_PAGE_SIZE ?? 5)));
const rawViewerId = process.env.FOR_YOU_REPEAT_VIEWER_ID ?? `harness-for-you-repeat-${Date.now()}`;
const viewerId = rawViewerId.trim();

if (!viewerId.startsWith("harness-")) {
  console.error(
    "[verify-for-you-repeat] refusing to run: viewer id must start with 'harness-' to guarantee we never touch a real user.",
  );
  process.exit(2);
}

if (process.env.FOR_YOU_SEEN_WRITES_ENABLED === "true" && !process.env.FOR_YOU_REPEAT_FORCE_READONLY) {
  console.error(
    "[verify-for-you-repeat] refusing: FOR_YOU_SEEN_WRITES_ENABLED=true is set; rerun without that env or set FOR_YOU_REPEAT_FORCE_READONLY=1 if you really know what you're doing.",
  );
  process.exit(2);
}

console.log("======================================================================");
console.log("[verify-for-you-repeat] READ ONLY — no writes will be performed");
console.log(`[verify-for-you-repeat] base=${baseUrl} viewerId=${viewerId} pageSize=${pageSize}`);
console.log("======================================================================");

type FeedItem = { postId?: string };
type FeedResponse = {
  items?: readonly FeedItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
  debug?: Record<string, unknown>;
};

interface FetchPageOpts {
  cursor?: string | null;
  excludeIds?: readonly string[];
  label: string;
}

interface PageResult {
  label: string;
  status: number;
  elapsedMs: number;
  postIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
  debug: Record<string, unknown> | null;
}

async function fetchPage(opts: FetchPageOpts): Promise<PageResult> {
  const search = new URLSearchParams();
  search.set("limit", String(pageSize));
  search.set("debug", "1");
  search.set("dryRunSeen", "1");
  if (opts.cursor) search.set("cursor", opts.cursor);
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    search.set("excludeIds", opts.excludeIds.slice(0, 200).join(","));
  }
  const url = `${baseUrl}/v2/feed/for-you/simple?${search.toString()}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-locava-readonly": "1",
      "x-locava-viewer-override": viewerId,
    },
  });
  const elapsedMs = Date.now() - started;
  const status = res.status;
  let payload: FeedResponse | null = null;
  try {
    payload = (await res.json()) as FeedResponse;
  } catch {
    payload = null;
  }
  const items = Array.isArray(payload?.items) ? (payload!.items as readonly FeedItem[]) : [];
  const postIds: string[] = [];
  for (const item of items) {
    const id = typeof item?.postId === "string" ? item.postId.trim() : "";
    if (id) postIds.push(id);
  }
  return {
    label: opts.label,
    status,
    elapsedMs,
    postIds,
    nextCursor: typeof payload?.nextCursor === "string" ? payload.nextCursor : null,
    hasMore: payload?.hasMore === true,
    debug: (payload?.debug as Record<string, unknown>) ?? null,
  };
}

function fmtList(ids: readonly string[]): string {
  return ids.length === 0 ? "(empty)" : ids.join(", ");
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}

(async () => {
  console.log("\n--- Session A (fresh viewer, no excludeIds) ---");
  const a1 = await fetchPage({ label: "A.page1" });
  console.log(
    `[A.page1] status=${a1.status} ms=${a1.elapsedMs} count=${a1.postIds.length} hasMore=${a1.hasMore}`,
  );
  console.log(`[A.page1] ids=${fmtList(a1.postIds)}`);

  let a2: PageResult | null = null;
  if (a1.nextCursor) {
    a2 = await fetchPage({ label: "A.page2", cursor: a1.nextCursor });
    console.log(
      `[A.page2] status=${a2.status} ms=${a2.elapsedMs} count=${a2.postIds.length} hasMore=${a2.hasMore}`,
    );
    console.log(`[A.page2] ids=${fmtList(a2.postIds)}`);
    const dup12 = overlap(a1.postIds, a2.postIds);
    console.log(
      `[A.page1↔A.page2] overlap=${dup12.length}${dup12.length ? ` (${dup12.join(", ")})` : ""}`,
    );
  } else {
    console.log("[A.page2] skipped — no nextCursor returned");
  }

  console.log("\n--- Session B simulation (cold restart) ---");
  console.log("[B.no-exclude]  first request after restart, no client memory");
  const b1 = await fetchPage({ label: "B.no-exclude.page1" });
  console.log(
    `[B.no-exclude.page1] status=${b1.status} ms=${b1.elapsedMs} count=${b1.postIds.length} hasMore=${b1.hasMore}`,
  );
  console.log(`[B.no-exclude.page1] ids=${fmtList(b1.postIds)}`);
  const dupBnoEx = overlap(a1.postIds, b1.postIds);
  console.log(
    `[A.page1↔B.no-exclude.page1] overlap=${dupBnoEx.length}/${a1.postIds.length}${dupBnoEx.length ? ` (${dupBnoEx.join(", ")})` : ""}`,
  );

  console.log("\n[B.with-exclude] first request after restart, client sends recent-seen IDs");
  const excludeIds = [...a1.postIds, ...(a2?.postIds ?? [])];
  const b2 = await fetchPage({ label: "B.with-exclude.page1", excludeIds });
  console.log(
    `[B.with-exclude.page1] status=${b2.status} ms=${b2.elapsedMs} count=${b2.postIds.length} hasMore=${b2.hasMore} excludeIdsSent=${excludeIds.length}`,
  );
  console.log(`[B.with-exclude.page1] ids=${fmtList(b2.postIds)}`);
  const dupBwithEx = overlap(excludeIds, b2.postIds);
  console.log(
    `[excludeIds↔B.with-exclude.page1] overlap=${dupBwithEx.length}/${excludeIds.length}${dupBwithEx.length ? ` (${dupBwithEx.join(", ")})` : ""}`,
  );
  if (b2.debug && typeof b2.debug === "object") {
    const dbg = b2.debug as Record<string, unknown>;
    if (
      typeof dbg.clientExcludeIdsCount === "number" ||
      typeof dbg.clientExcludeIdsFiltered === "number"
    ) {
      console.log(
        `[B.with-exclude.page1] debug.clientExcludeIdsCount=${dbg.clientExcludeIdsCount ?? "?"} debug.clientExcludeIdsFiltered=${dbg.clientExcludeIdsFiltered ?? "?"}`,
      );
    }
  }

  console.log("\n--- Verdict ---");
  const filledPage1A = a1.postIds.length >= Math.min(pageSize, 1);
  const pageChainDisjoint = !a2 || overlap(a1.postIds, a2.postIds).length === 0;
  const excludeIdsHonored = dupBwithEx.length === 0 || b2.postIds.length === 0;
  console.log(`fills.page1 = ${filledPage1A ? "ok" : "EMPTY"} (returned ${a1.postIds.length})`);
  console.log(`pagination.disjoint = ${pageChainDisjoint ? "ok" : "DUPLICATES"} `);
  console.log(`excludeIds.honored  = ${excludeIdsHonored ? "ok" : "FAIL"}`);

  if (!filledPage1A || !pageChainDisjoint || !excludeIdsHonored) {
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error("[verify-for-you-repeat] fatal:", err);
  process.exit(1);
});
