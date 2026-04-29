import { describe, expect, it } from "vitest";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { SearchRepository } from "./search.repository.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "test-request",
    route: "/test",
    method: "GET",
    startNs: 0n,
    payloadBytes: 0,
    dbOps: { reads: 0, writes: 0, queries: 0 },
    cache: { hits: 0, misses: 0 },
    dedupe: { hits: 0, misses: 0 },
    concurrency: { waits: 0 },
    entityCache: { hits: 0, misses: 0 },
    entityConstruction: { total: 0, types: {} },
    idempotency: { hits: 0, misses: 0 },
    invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: [],
    timeouts: [],
    surfaceTimings: {}
  };
  return runWithRequestContext(ctx, fn);
}

describe("search repository", () => {
  it("uses firestore adapter candidate path when available", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const repository = new SearchRepository({
      isEnabled: () => true,
      searchResultsPage: async (input: Record<string, unknown>) => {
        seen.push(input);
        return {
          items: [
            { postId: "internal-viewer-feed-post-2", rank: 1 },
            { postId: "internal-viewer-feed-post-5", rank: 2 }
          ],
          hasMore: false,
          nextCursor: null,
          queryCount: 1,
          readCount: 6
        };
      }
    } as never);

    await withRequestContext(async () => {
      const page = await repository.getSearchResultsPage({
        viewerId: "internal-viewer",
        query: "hike",
        cursor: null,
        limit: 8,
        lat: 40.68,
        lng: -75.22
      });
      expect(page.items.map((item) => item.postId)).toEqual([
        "internal-viewer-feed-post-2",
        "internal-viewer-feed-post-5"
      ]);
      expect(seen[0]).toMatchObject({
        viewerId: "internal-viewer",
        query: "hike",
        cursorOffset: 0,
        limit: 8,
        lat: 40.68,
        lng: -75.22
      });
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(1);
      expect(ctx?.dbOps.reads).toBe(6);
    });
  });

  it("degrades on firestore timeout with explicit fallback", async () => {
    const repository = new SearchRepository({
      isEnabled: () => true,
      searchResultsPage: async () => {
        throw new Error("search-results-firestore-query_timeout");
      }
    } as never);

    await withRequestContext(async () => {
      const page = await repository.getSearchResultsPage({
        viewerId: "internal-viewer",
        query: "hike",
        cursor: null,
        limit: 6,
        lat: null,
        lng: null,
        includeDebug: true,
      });
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBe(null);
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("search_results_firestore_fallback");
      expect(ctx?.timeouts).toContain("search_results_firestore");
      expect(ctx?.dbOps.queries).toBe(0);
    });
  });
});
