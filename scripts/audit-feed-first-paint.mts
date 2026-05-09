const READ_ONLY_PROD_FLAG = "READ_ONLY_PROD_AUDIT";
const READ_ONLY_GUARD_FLAG = "READ_ONLY_LATENCY_AUDIT";

function requireViewerId(): string {
  const viewerId = String(process.env.AUDIT_VIEWER_ID ?? process.env.USER_ID ?? "").trim();
  if (!viewerId) {
    throw new Error("missing_required_env:AUDIT_VIEWER_ID_or_USER_ID");
  }
  return viewerId;
}

const prodAuditMode = String(process.env[READ_ONLY_PROD_FLAG] ?? "").trim() === "1";
if (prodAuditMode && String(process.env.FIRESTORE_EMULATOR_HOST ?? "").trim()) {
  throw new Error("refusing_to_run:READ_ONLY_PROD_AUDIT_requires_non_emulator_firebase");
}

process.env[READ_ONLY_GUARD_FLAG] = "1";
process.env.NODE_ENV ??= "production";
process.env.LOG_LEVEL ??= "silent";

const viewerId = requireViewerId();

const [
  { createApp },
  { requestMetricsCollector },
  { diagnosticsStore },
  { isReadOnlyLatencyAuditEnabled, isReadOnlyLatencyAuditGuardActive },
] = await Promise.all([
  import("../src/app/createApp.js"),
  import("../src/observability/request-metrics.collector.js"),
  import("../src/observability/diagnostics-store.js"),
  import("../src/safety/read-only-latency-audit-guard.js"),
]);

if (!isReadOnlyLatencyAuditEnabled()) {
  throw new Error("read_only_latency_audit_not_enabled");
}
if (prodAuditMode && !isReadOnlyLatencyAuditGuardActive()) {
  throw new Error("read_only_latency_audit_guard_inactive");
}

requestMetricsCollector.clear();
diagnosticsStore.clear();

const app = createApp({ NODE_ENV: "production", LOG_LEVEL: "silent" });
const startedAt = Date.now();
const response = await app.inject({
  method: "GET",
  url: `/v2/feed/for-you/simple?viewerId=${encodeURIComponent(viewerId)}&limit=5`,
  headers: {
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    "x-locava-surface": "home_feed",
    "x-locava-priority": "P0_VISIBLE_PLAYBACK",
    "x-locava-request-group": "first_paint",
  },
});
const elapsedMs = Date.now() - startedAt;
const body = response.json() as {
  ok?: boolean;
  data?: {
    items?: Array<Record<string, unknown>>;
    nextCursor?: string | null;
    debug?: Record<string, unknown>;
  };
  meta?: {
    db?: { reads?: number; writes?: number; queries?: number };
  };
  error?: { code?: string; message?: string };
};

if (!body.ok) {
  throw new Error(`feed_first_paint_failed:${body.error?.code ?? response.statusCode}:${body.error?.message ?? "unknown"}`);
}

const latest = requestMetricsCollector.getRecentRequests(1)[0] as
  | {
      routeName?: string;
      latencyMs: number;
      payloadBytes: number;
      dbOps: { reads: number; writes: number; queries: number };
      surfaceTimings?: Record<string, number>;
      cache: { hits: number; misses: number };
      fallbacks: string[];
    }
  | undefined;
if (!latest) throw new Error("missing_request_diagnostic");

const dbWrites = Number(body.meta?.db?.writes ?? latest.dbOps.writes ?? 0);
if (dbWrites !== 0) {
  throw new Error(`read_only_violation:feed_first_paint_writes=${dbWrites}`);
}

const debug = body.data?.debug ?? {};
const summary = {
  route: "/v2/feed/for-you/simple",
  viewerId,
  prodAuditMode,
  elapsedMs,
  requestLatencyMs: latest.latencyMs,
  payloadBytes: latest.payloadBytes,
  db: {
    reads: Number(body.meta?.db?.reads ?? latest.dbOps.reads ?? 0),
    writes: dbWrites,
    queries: Number(body.meta?.db?.queries ?? latest.dbOps.queries ?? 0),
  },
  itemsReturned: Array.isArray(body.data?.items) ? body.data.items.length : 0,
  nextCursorPresent: typeof body.data?.nextCursor === "string",
  cache: latest.cache,
  fallbacks: latest.fallbacks,
  readOnlyGuardActive: prodAuditMode ? isReadOnlyLatencyAuditGuardActive() : false,
  debug: {
    deckSource: debug.deckSource ?? null,
    deckHit: debug.deckHit ?? null,
    candidateReadCount: debug.candidateReadCount ?? null,
    rawReelCandidates: debug.rawReelCandidates ?? null,
    rawFallbackCandidates: debug.rawFallbackCandidates ?? null,
    firstPaintCardReadyCount: debug.firstPaintCardReadyCount ?? null,
    firstPaintImmediatePlayableCount: debug.firstPaintImmediatePlayableCount ?? null,
    seenWriteAttempted: debug.seenWriteAttempted ?? null,
    seenWriteSucceeded: debug.seenWriteSucceeded ?? null,
  },
  surfaceTimings: latest.surfaceTimings ?? {},
};

console.log(JSON.stringify(summary, null, 2));
