import { AsyncLocalStorage } from "node:async_hooks";
import type { RouteBudgetPolicy } from "./route-policies.js";
import { getRoutePolicy } from "./route-policies.js";

export type DbOperationCounts = {
  reads: number;
  writes: number;
  queries: number;
};

export type AuditRequestContext = {
  auditRunId?: string;
  auditSpecId?: string;
  auditSpecName?: string;
};

export type OrchestrationContext = {
  surface: string | null;
  priority: string | null;
  requestGroup: string | null;
  visiblePostId: string | null;
  screenInstanceId: string | null;
  clientRequestId: string | null;
  hydrationMode: string | null;
  stale: boolean;
  canceled: boolean;
  deduped: boolean;
  queueWaitMs: number;
};

export type RequestContext = {
  requestId: string;
  route: string;
  method: string;
  startNs: bigint;
  routeName?: string;
  routePolicy?: RouteBudgetPolicy;
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
  /** Milliseconds spent in named repository/service stages (for Server-Timing / profiling). */
  surfaceTimings: Record<string, number>;
  orchestration?: OrchestrationContext;
  audit?: AuditRequestContext;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getAuditRequestContext(): AuditRequestContext | undefined {
  return storage.getStore()?.audit;
}

export function runOutsideRequestContext<T>(fn: () => T): T {
  return storage.exit(fn);
}

export function incrementDbOps(kind: keyof DbOperationCounts, count = 1): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.dbOps[kind] += count;
}

export function setRouteName(routeName: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.routeName = routeName;
  ctx.routePolicy = getRoutePolicy(routeName);
}

export function recordCacheHit(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.cache.hits += 1;
}

export function recordCacheMiss(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.cache.misses += 1;
}

export function recordFallback(label: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.fallbacks.push(label);
}

export function recordTimeout(label: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.timeouts.push(label);
}

export function recordSurfaceTimings(partials: Record<string, number>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  for (const [k, v] of Object.entries(partials)) {
    if (Number.isFinite(v)) ctx.surfaceTimings[k] = Math.round(v * 100) / 100;
  }
}

/** RFC 6797 Server-Timing header value (ASCII metric names). */
export function formatServerTimingHeader(timings: Record<string, number>): string {
  const parts: string[] = [];
  for (const [name, dur] of Object.entries(timings)) {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    parts.push(`${safe};dur=${dur}`);
  }
  return parts.join(", ");
}

export function recordPayloadBytes(bytes: number): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.payloadBytes = bytes;
}

export function recordDedupeHit(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.dedupe.hits += 1;
}

export function recordDedupeMiss(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.dedupe.misses += 1;
}

export function recordConcurrencyWait(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.concurrency.waits += 1;
}

export function recordEntityCacheHit(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.entityCache.hits += 1;
}

export function recordEntityCacheMiss(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.entityCache.misses += 1;
}

export function recordEntityConstructed(entityType: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.entityConstruction.total += 1;
  ctx.entityConstruction.types[entityType] = (ctx.entityConstruction.types[entityType] ?? 0) + 1;
}

export function recordInvalidation(
  invalidationType: string,
  input: { keyCount?: number; entityKeyCount?: number; routeKeyCount?: number } = {}
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  const entityKeyCount = input.entityKeyCount ?? input.keyCount ?? 0;
  const routeKeyCount = input.routeKeyCount ?? 0;
  ctx.invalidation.entityKeys += entityKeyCount;
  ctx.invalidation.routeKeys += routeKeyCount;
  ctx.invalidation.keys += entityKeyCount + routeKeyCount;
  ctx.invalidation.types[invalidationType] = (ctx.invalidation.types[invalidationType] ?? 0) + 1;
}

export function recordIdempotencyHit(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.idempotency.hits += 1;
}

export function recordIdempotencyMiss(): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.idempotency.misses += 1;
}

function createDefaultOrchestrationContext(): OrchestrationContext {
  return {
    surface: null,
    priority: null,
    requestGroup: null,
    visiblePostId: null,
    screenInstanceId: null,
    clientRequestId: null,
    hydrationMode: null,
    stale: false,
    canceled: false,
    deduped: false,
    queueWaitMs: 0
  };
}

export function setOrchestrationMetadata(
  patch: Partial<RequestContext["orchestration"]>
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.orchestration = {
    ...createDefaultOrchestrationContext(),
    ...(ctx.orchestration ?? {}),
    ...patch
  };
}
