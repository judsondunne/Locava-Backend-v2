import type { RequestDiagnostic } from "./diagnostics-store.js";

export type RouteRuntimeMetrics = {
  routeName: string;
  method: string | null;
  path: string | null;
  lastSeenAt: string | null;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  maxLatencyMs: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  avgDbReads: number | null;
  avgDbWrites: number | null;
  avgDbQueries: number | null;
  avgPayloadBytes: number | null;
  maxPayloadBytes: number;
  budgetViolationCount: number;
  budgetViolationRate: number;
  commonBudgetViolation: string | null;
  budgetViolationTypes: Array<{ code: string; count: number }>;
};

const MAX_RECENT_REQUESTS = 100;
const MAX_ROUTE_SAMPLE = 240;

type RouteObservation = {
  latencyMs: number;
  statusCode: number;
  dbReads: number;
  dbWrites: number;
  dbQueries: number;
  payloadBytes: number;
  budgetViolations: string[];
};

type RouteBucket = {
  routeName: string;
  method: string | null;
  path: string | null;
  lastSeenAt: string | null;
  requestCount: number;
  errorCount: number;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  maxLatencyMs: number;
  maxPayloadBytes: number;
  budgetViolationCount: number;
  budgetViolationCounts: Map<string, number>;
  sample: RouteObservation[];
};

class RequestMetricsCollector {
  private readonly recentRequests: RequestDiagnostic[] = [];
  private readonly routes = new Map<string, RouteBucket>();

  record(request: RequestDiagnostic): void {
    this.recentRequests.push(cloneRequest(request));
    if (this.recentRequests.length > MAX_RECENT_REQUESTS) {
      this.recentRequests.shift();
    }

    const routeName = request.routeName ?? request.route;
    const bucket = this.routes.get(routeName) ?? {
      routeName,
      method: null,
      path: null,
      lastSeenAt: null,
      requestCount: 0,
      errorCount: 0,
      lastStatusCode: null,
      lastLatencyMs: null,
      maxLatencyMs: 0,
      maxPayloadBytes: 0,
      budgetViolationCount: 0,
      budgetViolationCounts: new Map<string, number>(),
      sample: []
    };

    bucket.method = request.method;
    bucket.path = request.route;
    bucket.lastSeenAt = request.timestamp;
    bucket.requestCount += 1;
    bucket.lastStatusCode = request.statusCode;
    bucket.lastLatencyMs = request.latencyMs;
    bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, request.latencyMs);
    bucket.maxPayloadBytes = Math.max(bucket.maxPayloadBytes, request.payloadBytes);
    if (request.statusCode >= 500) {
      bucket.errorCount += 1;
    }
    if (request.budgetViolations.length > 0) {
      bucket.budgetViolationCount += 1;
      for (const violation of request.budgetViolations) {
        bucket.budgetViolationCounts.set(violation, (bucket.budgetViolationCounts.get(violation) ?? 0) + 1);
      }
    }
    bucket.sample.push({
      latencyMs: request.latencyMs,
      statusCode: request.statusCode,
      dbReads: request.dbOps.reads,
      dbWrites: request.dbOps.writes,
      dbQueries: request.dbOps.queries,
      payloadBytes: request.payloadBytes,
      budgetViolations: [...request.budgetViolations]
    });
    if (bucket.sample.length > MAX_ROUTE_SAMPLE) {
      bucket.sample.shift();
    }

    this.routes.set(routeName, bucket);
  }

  getRecentRequests(limit = MAX_RECENT_REQUESTS): RequestDiagnostic[] {
    return this.recentRequests.slice(-Math.max(1, limit)).reverse().map(cloneRequest);
  }

  getRouteMetrics(): RouteRuntimeMetrics[] {
    return [...this.routes.values()]
      .map((bucket) => toRouteRuntimeMetrics(bucket))
      .sort((left, right) => right.requestCount - left.requestCount || left.routeName.localeCompare(right.routeName));
  }

  clear(): void {
    this.recentRequests.length = 0;
    this.routes.clear();
  }
}

function toRouteRuntimeMetrics(bucket: RouteBucket): RouteRuntimeMetrics {
  const latencies = bucket.sample.map((row) => row.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = average(bucket.sample.map((row) => row.latencyMs));
  const avgDbReads = average(bucket.sample.map((row) => row.dbReads));
  const avgDbWrites = average(bucket.sample.map((row) => row.dbWrites));
  const avgDbQueries = average(bucket.sample.map((row) => row.dbQueries));
  const avgPayloadBytes = average(bucket.sample.map((row) => row.payloadBytes));
  const budgetViolationTypes = [...bucket.budgetViolationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
  return {
    routeName: bucket.routeName,
    method: bucket.method,
    path: bucket.path,
    lastSeenAt: bucket.lastSeenAt,
    requestCount: bucket.requestCount,
    errorCount: bucket.errorCount,
    errorRate: ratio(bucket.errorCount, bucket.requestCount),
    lastStatusCode: bucket.lastStatusCode,
    lastLatencyMs: bucket.lastLatencyMs,
    maxLatencyMs: round(bucket.maxLatencyMs),
    avgLatencyMs,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    p99LatencyMs: percentile(latencies, 0.99),
    avgDbReads,
    avgDbWrites,
    avgDbQueries,
    avgPayloadBytes,
    maxPayloadBytes: bucket.maxPayloadBytes,
    budgetViolationCount: bucket.budgetViolationCount,
    budgetViolationRate: ratio(bucket.budgetViolationCount, bucket.requestCount),
    commonBudgetViolation: budgetViolationTypes[0]?.code ?? null,
    budgetViolationTypes
  };
}

function percentile(sortedValues: number[], ratioValue: number): number | null {
  if (!sortedValues.length) return null;
  const index = Math.max(0, Math.ceil(sortedValues.length * ratioValue) - 1);
  return round(sortedValues[index] ?? 0);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round(numerator / denominator, 4);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cloneRequest(request: RequestDiagnostic): RequestDiagnostic {
  return {
    ...request,
    dbOps: { ...request.dbOps },
    cache: { ...request.cache },
    dedupe: { ...request.dedupe },
    concurrency: { ...request.concurrency },
    entityCache: { ...request.entityCache },
    entityConstruction: {
      total: request.entityConstruction.total,
      types: { ...request.entityConstruction.types }
    },
    idempotency: { ...request.idempotency },
    invalidation: {
      keys: request.invalidation.keys,
      entityKeys: request.invalidation.entityKeys,
      routeKeys: request.invalidation.routeKeys,
      types: { ...request.invalidation.types }
    },
    fallbacks: [...request.fallbacks],
    timeouts: [...request.timeouts],
    surfaceTimings: { ...request.surfaceTimings },
    budgetViolations: [...request.budgetViolations],
    orchestration: request.orchestration
      ? {
          ...request.orchestration
        }
      : undefined
  };
}

export const requestMetricsCollector = new RequestMetricsCollector();
