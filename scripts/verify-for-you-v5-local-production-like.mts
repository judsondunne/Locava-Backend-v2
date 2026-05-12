/**
 * For You V5 HTTP harness: first page + 40 cursor pages + second no-cursor first page.
 *
 * **No .env is required on the server** for V5 + seen writes (those are the code defaults).
 * Point `FOR_YOU_V5_VERIFY_BASE_URL` at your local Backendv2 if not using the default.
 *
 * This script only issues GETs; any Firestore writes happen inside your running server.
 *
 * Usage:
 *   npm run verify:for-you-v5:local-production-like
 */
const baseUrl = (process.env.FOR_YOU_V5_VERIFY_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const viewerId =
  process.env.FOR_YOU_V5_VERIFY_VIEWER_ID ?? `local-prodlike-for-you-v5-${Date.now()}`;

function extractPostId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  if (typeof r.postId === "string") return r.postId;
  return null;
}

async function fetchPage(cursor: string | null): Promise<{
  items: unknown[];
  nextCursor: string | null;
  debug: Record<string, unknown>;
  ok: boolean;
}> {
  const qs = new URLSearchParams({ limit: "5", debug: "1", viewerId });
  if (cursor) qs.set("cursor", cursor);
  const url = `${baseUrl}/v2/feed/for-you/simple?${qs.toString()}`;
  const res = await fetch(url);
  const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown> };
  const data = body.data ?? {};
  return {
    ok: res.ok && body.ok === true,
    items: (data.items as unknown[]) ?? [],
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
    debug: (data.debug as Record<string, unknown>) ?? {},
  };
}

async function main(): Promise<void> {
  console.log("For You V5 local production-like harness");
  console.log("baseUrl", baseUrl, "viewerId", viewerId);

  const seenInChain = new Set<string>();
  let cursor: string | null = null;
  let firstNoCursorIds: string[] = [];

  for (let page = 0; page < 41; page += 1) {
    const useCursor = page === 0 ? null : cursor;
    const { ok, items, nextCursor, debug } = await fetchPage(useCursor);
    if (!ok) {
      console.error("Request failed", { page });
      process.exit(1);
    }
    if (debug.forYouRouteVariant !== "v5") {
      console.error("Expected V5 route; got", debug.forYouRouteVariant, debug.legacyReason);
      process.exit(1);
    }
    if (debug.routeEnteredV5 !== true) {
      console.error("Expected routeEnteredV5 true in debug");
      process.exit(1);
    }
    const ids = items.map(extractPostId).filter((x): x is string => Boolean(x));
        console.log(`page ${page + 1} (noCursor=${useCursor === null}) returnedPostIds`, ids.join(", "));
    if (page === 0) firstNoCursorIds = ids;
    for (const id of ids) {
      if (seenInChain.has(id)) {
        console.error("Duplicate post ID in cursor chain", id);
        process.exit(1);
      }
      seenInChain.add(id);
    }
    if (page > 0 && page <= 40 && ids.length > 0) {
      if (debug.regularFallbackUsed === true && Number(debug.reelReturnedCount ?? 0) < ids.length) {
        console.warn("WARN: mixed reel/regular before end of 40-page chain", { page: page + 1 });
      }
    }
    cursor = nextCursor;
    if (page < 40 && !cursor) {
      console.error("nextCursor missing before completing 40 cursor pages", { page });
      process.exit(1);
    }
  }

  const secondNoCursor = await fetchPage(null);
  if (!secondNoCursor.ok) {
    console.error("Second no-cursor fetch failed");
    process.exit(1);
  }
  const secondIds = secondNoCursor.items.map(extractPostId).filter((x): x is string => Boolean(x));
  console.log("final no-cursor first page returnedPostIds", secondIds.join(", "));
  if (firstNoCursorIds.join("|") === secondIds.join("|") && firstNoCursorIds.length > 0) {
    console.error(
      "Second no-cursor first page matched the first no-cursor page exactly (expected different posts when seen writes are on)"
    );
    process.exit(1);
  }

  console.log("OK: V5 chain (41 requests: first + 40 cursors), no dupes in chain, second no-cursor differs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
