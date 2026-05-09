const READ_ONLY_PROD_FLAG = "READ_ONLY_PROD_AUDIT";
const READ_ONLY_GUARD_FLAG = "READ_ONLY_LATENCY_AUDIT";

const prodAuditMode = String(process.env[READ_ONLY_PROD_FLAG] ?? "").trim() === "1";
if (prodAuditMode && String(process.env.FIRESTORE_EMULATOR_HOST ?? "").trim()) {
  throw new Error("refusing_to_run:READ_ONLY_PROD_AUDIT_requires_non_emulator_firebase");
}

process.env[READ_ONLY_GUARD_FLAG] = "1";
process.env.NODE_ENV ??= "production";
process.env.LOG_LEVEL ??= "silent";

const viewerId = String(process.env.AUDIT_VIEWER_ID ?? process.env.USER_ID ?? "internal-viewer").trim();

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
  url: "/v2/map/markers?payloadMode=compact",
  headers: {
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    "x-locava-surface": "map",
    "x-locava-priority": "P1_NEXT_PLAYBACK",
  },
});
const elapsedMs = Date.now() - startedAt;
const body = response.json() as {
  ok?: boolean;
  data?: {
    count?: number;
    diagnostics?: Record<string, unknown>;
    markers?: Array<Record<string, unknown>>;
  };
  meta?: {
    db?: { reads?: number; writes?: number; queries?: number };
  };
  error?: { code?: string; message?: string };
};

if (!body.ok) {
  throw new Error(`map_compact_markers_failed:${body.error?.code ?? response.statusCode}:${body.error?.message ?? "unknown"}`);
}

const latest = requestMetricsCollector.getRecentRequests(1)[0] as
  | {
      latencyMs: number;
      payloadBytes: number;
      dbOps: { reads: number; writes: number; queries: number };
      cache: { hits: number; misses: number };
      fallbacks: string[];
    }
  | undefined;
if (!latest) throw new Error("missing_request_diagnostic");

const dbWrites = Number(body.meta?.db?.writes ?? latest.dbOps.writes ?? 0);
if (dbWrites !== 0) {
  throw new Error(`read_only_violation:map_compact_markers_writes=${dbWrites}`);
}

const diagnostics = body.data?.diagnostics ?? {};
const summary = {
  route: "/v2/map/markers?payloadMode=compact",
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
  markerCount: Number(body.data?.count ?? (Array.isArray(body.data?.markers) ? body.data.markers.length : 0)),
  cache: latest.cache,
  fallbacks: latest.fallbacks,
  readOnlyGuardActive: prodAuditMode ? isReadOnlyLatencyAuditGuardActive() : false,
  diagnostics: {
    queryCount: diagnostics.queryCount ?? null,
    readCount: diagnostics.readCount ?? null,
    payloadBytes: diagnostics.payloadBytes ?? null,
    invalidCoordinateDrops: diagnostics.invalidCoordinateDrops ?? null,
    cacheSource: diagnostics.cacheSource ?? null,
    payloadMode: diagnostics.payloadMode ?? null,
  },
};

console.log(JSON.stringify(summary, null, 2));
