import { describe, expect, it } from "vitest";
import { requestMetricsCollector } from "./request-metrics.collector.js";
import type { RequestDiagnostic } from "./diagnostics-store.js";
import { getRoutePolicy } from "./route-policies.js";

function buildDiagnostic(input: Partial<RequestDiagnostic> = {}): RequestDiagnostic {
  return {
    requestId: input.requestId ?? "req-1",
    method: input.method ?? "GET",
    route: input.route ?? "/v2/feed/bootstrap",
    routeName: input.routeName ?? "feed.bootstrap.get",
    routePolicy: input.routePolicy ?? getRoutePolicy("feed.bootstrap.get"),
    budgetViolations: input.budgetViolations ?? [],
    statusCode: input.statusCode ?? 200,
    latencyMs: input.latencyMs ?? 120,
    payloadBytes: input.payloadBytes ?? 2048,
    dbOps: input.dbOps ?? { reads: 2, writes: 0, queries: 1 },
    cache: input.cache ?? { hits: 0, misses: 0 },
    dedupe: input.dedupe ?? { hits: 0, misses: 0 },
    concurrency: input.concurrency ?? { waits: 0 },
    entityCache: input.entityCache ?? { hits: 0, misses: 0 },
    entityConstruction: input.entityConstruction ?? { total: 0, types: {} },
    idempotency: input.idempotency ?? { hits: 0, misses: 0 },
    invalidation: input.invalidation ?? { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: input.fallbacks ?? [],
    timeouts: input.timeouts ?? [],
    surfaceTimings: input.surfaceTimings ?? {},
    orchestration: input.orchestration,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

describe("requestMetricsCollector", () => {
  it("records request counts, errors, latencies, and percentiles", () => {
    requestMetricsCollector.clear();
    requestMetricsCollector.record(buildDiagnostic({ requestId: "r1", latencyMs: 100, statusCode: 200 }));
    requestMetricsCollector.record(buildDiagnostic({ requestId: "r2", latencyMs: 300, statusCode: 503, budgetViolations: ["latency_p95_exceeded"] }));
    requestMetricsCollector.record(buildDiagnostic({ requestId: "r3", latencyMs: 200, statusCode: 200 }));

    const row = requestMetricsCollector.getRouteMetrics().find((entry) => entry.routeName === "feed.bootstrap.get");
    expect(row).toBeTruthy();
    expect(row?.requestCount).toBe(3);
    expect(row?.errorCount).toBe(1);
    expect(row?.lastStatusCode).toBe(200);
    expect(row?.maxLatencyMs).toBe(300);
    expect(row?.p95LatencyMs).toBe(300);
    expect(row?.budgetViolationCount).toBe(1);
  });
});
