import type { DbOperationCounts } from "./request-context.js";
import type { RouteBudgetPolicy } from "./route-policies.js";

export type RequestDiagnostic = {
  requestId: string;
  method: string;
  route: string;
  routeName?: string;
  routePolicy?: RouteBudgetPolicy;
  budgetViolations: string[];
  statusCode: number;
  latencyMs: number;
  payloadBytes: number;
  dbOps: DbOperationCounts;
  cache: {
    hits: number;
    misses: number;
  };
  dedupe: {
    hits: number;
    misses: number;
  };
  concurrency: {
    waits: number;
  };
  entityCache: {
    hits: number;
    misses: number;
  };
  entityConstruction: {
    total: number;
    types: Record<string, number>;
  };
  idempotency: {
    hits: number;
    misses: number;
  };
  invalidation: {
    keys: number;
    entityKeys: number;
    routeKeys: number;
    types: Record<string, number>;
  };
  fallbacks: string[];
  timeouts: string[];
  surfaceTimings: Record<string, number>;
  timestamp: string;
};

const MAX_ENTRIES = 200;

class DiagnosticsStore {
  private readonly requests: RequestDiagnostic[] = [];

  addRequest(record: RequestDiagnostic): void {
    this.requests.push(record);
    if (this.requests.length > MAX_ENTRIES) {
      this.requests.shift();
    }
  }

  getRecentRequests(limit = 50): RequestDiagnostic[] {
    return this.requests.slice(-limit).reverse();
  }

  getSummary(): { total: number; avgLatencyMs: number; p95LatencyMs: number; avgPayloadBytes: number } {
    if (this.requests.length === 0) {
      return { total: 0, avgLatencyMs: 0, p95LatencyMs: 0, avgPayloadBytes: 0 };
    }

    const latencies = this.requests.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
    const avgPayloadBytes =
      this.requests.reduce((sum, request) => sum + request.payloadBytes, 0) / this.requests.length;
    const p95Index = Math.max(0, Math.floor(latencies.length * 0.95) - 1);
    const p95LatencyMs = latencies[p95Index] ?? 0;

    return {
      total: this.requests.length,
      avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
      p95LatencyMs: Number(p95LatencyMs.toFixed(2)),
      avgPayloadBytes: Number(avgPayloadBytes.toFixed(2))
    };
  }

  getOperationalSignals(limit = 200): {
    sampleSize: number;
    fallbackCount: number;
    timeoutCount: number;
    fallbackRate: number;
    timeoutRate: number;
    alerts: string[];
    topFallbackRoutes: Array<{ routeName: string; count: number }>;
    budgetViolationCount: number;
    budgetViolationRate: number;
    topBudgetViolationRoutes: Array<{ routeName: string; count: number }>;
  } {
    const sample = this.requests.slice(-Math.max(1, Math.min(limit, this.requests.length)));
    if (sample.length === 0) {
      return {
        sampleSize: 0,
        fallbackCount: 0,
        timeoutCount: 0,
        fallbackRate: 0,
        timeoutRate: 0,
        alerts: [],
        topFallbackRoutes: [],
        budgetViolationCount: 0,
        budgetViolationRate: 0,
        topBudgetViolationRoutes: []
      };
    }
    let fallbackCount = 0;
    let timeoutCount = 0;
    const fallbackByRoute = new Map<string, number>();
    const budgetViolationsByRoute = new Map<string, number>();
    let budgetViolationCount = 0;
    for (const row of sample) {
      if (row.fallbacks.length > 0) {
        fallbackCount += 1;
        const key = row.routeName ?? row.route;
        fallbackByRoute.set(key, (fallbackByRoute.get(key) ?? 0) + 1);
      }
      if (row.timeouts.length > 0) {
        timeoutCount += 1;
      }
      if (row.budgetViolations.length > 0) {
        budgetViolationCount += 1;
        const key = row.routeName ?? row.route;
        budgetViolationsByRoute.set(key, (budgetViolationsByRoute.get(key) ?? 0) + 1);
      }
    }
    const fallbackRate = Number((fallbackCount / sample.length).toFixed(4));
    const timeoutRate = Number((timeoutCount / sample.length).toFixed(4));
    const alerts: string[] = [];
    if (sample.length >= 20 && fallbackRate >= 0.15) {
      alerts.push("fallback_rate_high");
    }
    if (sample.length >= 20 && timeoutRate >= 0.1) {
      alerts.push("timeout_rate_high");
    }
    const budgetViolationRate = Number((budgetViolationCount / sample.length).toFixed(4));
    if (sample.length >= 20 && budgetViolationRate >= 0.1) {
      alerts.push("budget_violation_rate_high");
    }
    const topFallbackRoutes = [...fallbackByRoute.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([routeName, count]) => ({ routeName, count }));
    const topBudgetViolationRoutes = [...budgetViolationsByRoute.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([routeName, count]) => ({ routeName, count }));
    return {
      sampleSize: sample.length,
      fallbackCount,
      timeoutCount,
      fallbackRate,
      timeoutRate,
      alerts,
      topFallbackRoutes,
      budgetViolationCount,
      budgetViolationRate,
      topBudgetViolationRoutes
    };
  }

  getRouteAggregates(limit = 200): Array<{
    routeName: string;
    count: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    avgPayloadBytes: number;
    fallbackRate: number;
    timeoutRate: number;
    budgetViolationRate: number;
  }> {
    const sample = this.requests.slice(-Math.max(1, Math.min(limit, this.requests.length)));
    if (sample.length === 0) {
      return [];
    }
    const grouped = new Map<string, RequestDiagnostic[]>();
    for (const row of sample) {
      const key = row.routeName ?? row.route;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    return [...grouped.entries()]
      .map(([routeName, rows]) => {
        const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
        const p50Index = Math.max(0, Math.floor(latencies.length * 0.5) - 1);
        const p95Index = Math.max(0, Math.floor(latencies.length * 0.95) - 1);
        const fallbackCount = rows.filter((row) => row.fallbacks.length > 0).length;
        const timeoutCount = rows.filter((row) => row.timeouts.length > 0).length;
        const budgetViolationCount = rows.filter((row) => row.budgetViolations.length > 0).length;
        const avgPayloadBytes = rows.reduce((acc, row) => acc + row.payloadBytes, 0) / rows.length;
        return {
          routeName,
          count: rows.length,
          p50LatencyMs: Number((latencies[p50Index] ?? 0).toFixed(2)),
          p95LatencyMs: Number((latencies[p95Index] ?? 0).toFixed(2)),
          avgPayloadBytes: Number(avgPayloadBytes.toFixed(2)),
          fallbackRate: Number((fallbackCount / rows.length).toFixed(4)),
          timeoutRate: Number((timeoutCount / rows.length).toFixed(4)),
          budgetViolationRate: Number((budgetViolationCount / rows.length).toFixed(4))
        };
      })
      .sort((a, b) => b.count - a.count);
  }
}

export const diagnosticsStore = new DiagnosticsStore();
