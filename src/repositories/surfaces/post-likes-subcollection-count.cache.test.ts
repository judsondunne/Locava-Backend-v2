import { beforeEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { countPostLikesSubcollectionBatch } from "./post-likes-subcollection-count.js";

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "likes-cache-bench",
    route: "/bench",
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
    surfaceTimings: {},
  };
  return runWithRequestContext(ctx, fn);
}

describe("countPostLikesSubcollectionBatch cache scaling", () => {
  beforeEach(async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `post_${i}`);
    await Promise.all(ids.map((id) => globalCache.del(entityCacheKeys.likesSubcollectionCount(id))));
  });

  it("cold path issues one aggregate query per post; warm path issues zero", async () => {
    const countGet = vi.fn(async () => ({ data: () => ({ count: 7 }) }));
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            count: () => ({ get: countGet }),
          }),
        }),
      }),
    } as never;

    const ids = Array.from({ length: 30 }, (_, i) => `post_${i}`);

    const cold = await withRequestContext(async () => {
      const map = await countPostLikesSubcollectionBatch(db, ids);
      return {
        queries: getRequestContext()!.dbOps.queries,
        size: map.size,
        sample: map.get("post_0"),
      };
    });

    const warm = await withRequestContext(async () => {
      const map = await countPostLikesSubcollectionBatch(db, ids);
      return {
        queries: getRequestContext()!.dbOps.queries,
        size: map.size,
        sample: map.get("post_0"),
      };
    });

    expect(cold.queries).toBe(30);
    expect(cold.size).toBe(30);
    expect(cold.sample).toBe(7);
    expect(warm.queries).toBe(0);
    expect(warm.size).toBe(30);
    expect(warm.sample).toBe(7);
    // Numerical improvement: 30 → 0 aggregate queries on repeat hydration (−100%).
    expect(warm.queries).toBeLessThan(cold.queries);
    expect(countGet).toHaveBeenCalledTimes(30);
  });
});
