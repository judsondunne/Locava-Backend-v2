import { describe, expect, it } from "vitest";
import { diagnosticsStore } from "./diagnostics-store.js";

describe("diagnostics store", () => {
  it("keeps an immutable snapshot of request diagnostics", () => {
    diagnosticsStore.clear();

    const dbOps = { reads: 1, writes: 2, queries: 3 };
    const fallbacks = ["before"];
    const surfaceTimings = { notifications_firestore_parallel_ms: 123.45 };

    diagnosticsStore.addRequest({
      requestId: "req-1",
      method: "GET",
      route: "/v2/test",
      routeName: "test.route",
      auditRunId: "run-1",
      auditSpecId: "spec-1",
      auditSpecName: "test-spec",
      routePolicy: undefined,
      budgetViolations: [],
      statusCode: 200,
      latencyMs: 12.34,
      payloadBytes: 456,
      dbOps: { ...dbOps },
      cache: { hits: 0, misses: 1 },
      dedupe: { hits: 0, misses: 1 },
      concurrency: { waits: 0 },
      entityCache: { hits: 0, misses: 0 },
      entityConstruction: { total: 0, types: {} },
      idempotency: { hits: 0, misses: 0 },
      invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
      fallbacks: [...fallbacks],
      timeouts: [],
      surfaceTimings: { ...surfaceTimings },
      timestamp: "2026-04-26T00:00:00.000Z"
    });

    dbOps.reads = 99;
    fallbacks.push("after");
    surfaceTimings.notifications_firestore_parallel_ms = 999;

    const [row] = diagnosticsStore.getRecentRequests(1);
    expect(row).toBeDefined();
    if (!row) {
      throw new Error("expected diagnostics row");
    }
    expect(row.dbOps.reads).toBe(1);
    expect(row.fallbacks).toEqual(["before"]);
    expect(row.surfaceTimings.notifications_firestore_parallel_ms).toBe(123.45);
  });

  it("filters requests by audit scope", () => {
    diagnosticsStore.clear();

    diagnosticsStore.addRequest({
      requestId: "req-a",
      method: "GET",
      route: "/v2/a",
      routeName: "route.a",
      auditRunId: "run-1",
      auditSpecId: "spec-a",
      auditSpecName: "a",
      routePolicy: undefined,
      budgetViolations: [],
      statusCode: 200,
      latencyMs: 10,
      payloadBytes: 10,
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
      timestamp: "2026-04-26T00:00:00.000Z"
    });

    diagnosticsStore.addRequest({
      requestId: "req-b",
      method: "GET",
      route: "/v2/b",
      routeName: "route.b",
      auditRunId: "run-2",
      auditSpecId: "spec-b",
      auditSpecName: "b",
      routePolicy: undefined,
      budgetViolations: [],
      statusCode: 200,
      latencyMs: 20,
      payloadBytes: 20,
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
      timestamp: "2026-04-26T00:00:00.000Z"
    });

    expect(diagnosticsStore.findRequest({ auditRunId: "run-1", auditSpecId: "spec-a" })?.requestId).toBe("req-a");
    expect(diagnosticsStore.getRecentRequests(10, { auditRunId: "run-2" }).map((row) => row.requestId)).toEqual(["req-b"]);
  });
});
