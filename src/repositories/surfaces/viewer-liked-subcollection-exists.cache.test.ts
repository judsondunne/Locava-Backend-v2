import { beforeEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { batchResolveViewerHasLiked } from "./viewer-liked-subcollection-exists.js";

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "viewer-liked-bench",
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

describe("batchResolveViewerHasLiked cache scaling", () => {
  beforeEach(async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `post_${i}`);
    await Promise.all(ids.map((id) => globalCache.del(entityCacheKeys.viewerLikedExists("viewer-1", id))));
  });

  it("cold path issues one getAll; warm path issues zero queries", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const refs = args as Array<{ id: string }>;
      return refs.map((ref, i) => ({ id: ref.id, exists: i % 2 === 0 }));
    });
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: (id: string) => ({ id }),
          }),
        }),
      }),
      getAll,
    } as never;

    const ids = Array.from({ length: 30 }, (_, i) => `post_${i}`);

    const cold = await withRequestContext(async () => {
      const map = await batchResolveViewerHasLiked(db, "viewer-1", ids);
      return { queries: getRequestContext()!.dbOps.queries, liked: map.get("post_0") };
    });
    const warm = await withRequestContext(async () => {
      const map = await batchResolveViewerHasLiked(db, "viewer-1", ids);
      return { queries: getRequestContext()!.dbOps.queries, liked: map.get("post_0") };
    });

    expect(cold.queries).toBe(1);
    expect(cold.liked).toBe(true);
    expect(warm.queries).toBe(0);
    expect(warm.liked).toBe(true);
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});
