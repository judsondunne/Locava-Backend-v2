import { describe, expect, it } from "vitest";
import {
  getAuditRequestContext,
  getRequestContext,
  recordFallback,
  runWithRequestContext,
  type RequestContext
} from "../observability/request-context.js";
import {
  flushBackgroundWorkForTests,
  getBackgroundWorkSnapshotForTests,
  resetBackgroundWorkForTests,
  scheduleBackgroundWork
} from "./background-work.js";

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
    surfaceTimings: {},
    audit: {
      auditRunId: "run-1",
      auditSpecId: "spec-1",
      auditSpecName: "test-spec"
    }
  };
  return runWithRequestContext(ctx, fn);
}

describe("background work", () => {
  it("does not leak request context into deferred jobs", async () => {
    resetBackgroundWorkForTests();
    let backgroundContext: RequestContext | undefined;

    await withRequestContext(async () => {
      recordFallback("foreground");
      scheduleBackgroundWork(() => {
        backgroundContext = getRequestContext();
        recordFallback("background");
      });
    });

    await flushBackgroundWorkForTests();

    expect(backgroundContext).toBeUndefined();

    await withRequestContext(async () => {
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toEqual([]);
    });
  });

  it("tracks background work by audit scope and drains nested work", async () => {
    resetBackgroundWorkForTests();

    await withRequestContext(async () => {
      scheduleBackgroundWork(async () => {
        expect(getRequestContext()).toBeUndefined();
        expect(getAuditRequestContext()?.auditRunId).toBeUndefined();
        scheduleBackgroundWork(() => undefined);
      });
    });

    expect(getBackgroundWorkSnapshotForTests({ auditRunId: "run-1", auditSpecId: "spec-1" }).total).toBe(1);
    await flushBackgroundWorkForTests({ auditRunId: "run-1", auditSpecId: "spec-1" });
    expect(getBackgroundWorkSnapshotForTests({ auditRunId: "run-1", auditSpecId: "spec-1" }).total).toBe(0);
  });
});
