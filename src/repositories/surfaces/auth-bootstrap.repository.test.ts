import { describe, expect, it } from "vitest";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { AuthBootstrapRepository } from "./auth-bootstrap.repository.js";

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

describe("auth bootstrap repository", () => {
  it("uses firestore adapter for viewer summary and bootstrap when available", async () => {
    const repository = new AuthBootstrapRepository({
      isEnabled: () => true,
      getViewerBootstrapFields: async () => ({
        data: { handle: "real_handle", badge: "gold", unreadCount: 7 },
        queryCount: 1,
        readCount: 1
      }),
      markUnavailableBriefly: () => undefined
    } as never);

    await withRequestContext(async () => {
      const summary = await repository.getViewerSummary("u-1");
      const seed = await repository.getBootstrapSeed("u-1");
      expect(summary.handle).toBe("real_handle");
      expect(summary.badge).toBe("gold");
      expect(seed.unreadCount).toBe(7);
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(2);
      expect(ctx?.dbOps.reads).toBe(2);
    });
  });

  it("falls back when firestore fails", async () => {
    const repository = new AuthBootstrapRepository({
      isEnabled: () => true,
      getViewerBootstrapFields: async () => {
        throw new Error("auth-bootstrap-firestore-user_timeout");
      },
      markUnavailableBriefly: () => undefined
    } as never);

    await withRequestContext(async () => {
      const summary = await repository.getViewerSummary("u-2");
      expect(summary.handle).toBe("");
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("auth_bootstrap_viewer_firestore_fallback");
      expect(ctx?.timeouts).toContain("auth_bootstrap_viewer_firestore");
    });
  });
});
