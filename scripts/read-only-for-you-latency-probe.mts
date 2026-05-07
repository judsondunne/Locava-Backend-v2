const READ_ONLY_FLAG = "READ_ONLY_LATENCY_AUDIT";
const USER_ID_ENV = "USER_ID";

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`missing_required_env:${name}`);
  }
  return value;
}

if (String(process.env[READ_ONLY_FLAG] ?? "").trim() !== "1") {
  throw new Error(`refusing_to_run:set_${READ_ONLY_FLAG}=1`);
}

const userId = requireEnv(USER_ID_ENV);

if (String(process.env.FIRESTORE_EMULATOR_HOST ?? "").trim()) {
  throw new Error("refusing_to_run:real_data_probe_requires_non_emulator_firebase");
}

process.env[READ_ONLY_FLAG] = "1";
process.env.NODE_ENV ??= "production";
process.env.LOG_LEVEL ??= "silent";

const [
  { createApp },
  { requestMetricsCollector },
  { diagnosticsStore },
  { isReadOnlyLatencyAuditGuardActive },
] = await Promise.all([
  import("../src/app/createApp.js"),
  import("../src/observability/request-metrics.collector.js"),
  import("../src/observability/diagnostics-store.js"),
  import("../src/safety/read-only-latency-audit-guard.js"),
]);

if (!isReadOnlyLatencyAuditGuardActive()) {
  throw new Error("read_only_latency_audit_guard_inactive");
}

type ProbeDiagnostic = {
  routeName: string;
  route: string;
  latencyMs: number;
  payloadBytes: number;
  dbOps: { reads: number; writes: number; queries: number };
  cache: { hits: number; misses: number };
  dedupe: { hits: number; misses: number };
  entityCache: { hits: number; misses: number };
  fallbacks: string[];
  timeouts: string[];
  surfaceTimings: Record<string, number>;
};

type ProbeResult = {
  label: string;
  method: "GET";
  url: string;
  statusCode: number;
  totalDurationMs: number;
  requestId: string | null;
  payloadBytes: number;
  dbReads: number;
  dbWrites: number;
  dbQueries: number;
  cacheHits: number;
  cacheMisses: number;
  dedupeHits: number;
  dedupeMisses: number;
  entityCacheHits: number;
  entityCacheMisses: number;
  candidateReadCount: number | null;
  rawCandidateCount: number | null;
  hydratedPostCount: number;
  mediaAssetsCount: number;
  firstPaintPosterCoverage: number;
  firstPaintImmediateMediaCount: number;
  detailBatchRequiredForFirstPaint: boolean | null;
  deckHit: boolean | null;
  deckSource: string | null;
  slowestSteps: Array<{ name: string; durationMs: number }>;
  fallbacks: string[];
  timeouts: string[];
  debug: Record<string, unknown>;
  nextCursor: string | null;
};

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return Math.round((sorted[index] ?? 0) * 100) / 100;
}

function sumMediaAssets(items: Array<Record<string, unknown>>): number {
  return items.reduce((sum, item) => {
    const assets = Array.isArray(item.assets) ? item.assets : [];
    return sum + assets.length;
  }, 0);
}

function countImmediateMedia(items: Array<Record<string, unknown>>): { posterCoverage: number; immediateMediaCount: number } {
  let withPoster = 0;
  let immediateMedia = 0;
  for (const item of items) {
    const media = (item.media as Record<string, unknown> | undefined) ?? undefined;
    const poster =
      typeof media?.posterUrl === "string" && media.posterUrl.trim()
        ? media.posterUrl.trim()
        : typeof item.displayPhotoLink === "string" && item.displayPhotoLink.trim()
          ? item.displayPhotoLink.trim()
          : typeof item.thumbUrl === "string" && item.thumbUrl.trim()
            ? item.thumbUrl.trim()
            : typeof (Array.isArray(item.assets) ? item.assets[0] : undefined)?.posterUrl === "string" &&
                String((Array.isArray(item.assets) ? item.assets[0] : undefined as { posterUrl?: unknown })?.posterUrl ?? "").trim()
              ? String((Array.isArray(item.assets) ? item.assets[0] : undefined as { posterUrl?: unknown })?.posterUrl ?? "").trim()
              : "";
    if (poster) withPoster += 1;
    const firstAsset = (Array.isArray(item.assets) ? item.assets[0] : undefined) as Record<string, unknown> | undefined;
    const immediate =
      poster ||
      (typeof firstAsset?.previewUrl === "string" && firstAsset.previewUrl.trim()) ||
      (typeof firstAsset?.mp4Url === "string" && firstAsset.mp4Url.trim()) ||
      (typeof firstAsset?.streamUrl === "string" && firstAsset.streamUrl.trim()) ||
      (typeof firstAsset?.originalUrl === "string" && firstAsset.originalUrl.trim()) ||
      "";
    if (immediate) immediateMedia += 1;
  }
  return { posterCoverage: withPoster, immediateMediaCount: immediateMedia };
}

function extractLatestDiagnostic(): ProbeDiagnostic {
  const latest = requestMetricsCollector.getRecentRequests(1)[0] as ProbeDiagnostic | undefined;
  if (!latest) {
    throw new Error("missing_request_diagnostic");
  }
  return latest;
}

async function probeRoute(app: ReturnType<typeof createApp>, input: {
  label: string;
  url: string;
}): Promise<ProbeResult> {
  requestMetricsCollector.clear();
  diagnosticsStore.clear();
  const startedAt = Date.now();
  const response = await app.inject({
    method: "GET",
    url: input.url,
    headers: {
      "x-viewer-id": userId,
      "x-viewer-roles": "internal",
    },
  });
  const totalDurationMs = Date.now() - startedAt;
  const body = response.json() as {
    ok?: boolean;
    data?: {
      items?: Array<Record<string, unknown>>;
      nextCursor?: string | null;
      debug?: Record<string, unknown>;
    };
    meta?: {
      requestId?: string;
      db?: { reads?: number; writes?: number; queries?: number };
    };
    error?: { code?: string; message?: string };
  };
  if (!body.ok) {
    throw new Error(`probe_failed:${input.label}:${body.error?.code ?? response.statusCode}:${body.error?.message ?? "unknown"}`);
  }
  const diag = extractLatestDiagnostic();
  const items = Array.isArray(body.data?.items) ? body.data.items : [];
  const debug = (body.data?.debug ?? {}) as Record<string, unknown>;
  const { posterCoverage, immediateMediaCount } = countImmediateMedia(items);
  const slowestSteps = Object.entries(diag.surfaceTimings ?? {})
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 8);

  return {
    label: input.label,
    method: "GET",
    url: input.url,
    statusCode: response.statusCode,
    totalDurationMs,
    requestId: body.meta?.requestId ?? null,
    payloadBytes: diag.payloadBytes || Buffer.byteLength(response.body, "utf8"),
    dbReads: Number(body.meta?.db?.reads ?? diag.dbOps.reads ?? 0),
    dbWrites: Number(body.meta?.db?.writes ?? diag.dbOps.writes ?? 0),
    dbQueries: Number(body.meta?.db?.queries ?? diag.dbOps.queries ?? 0),
    cacheHits: diag.cache.hits,
    cacheMisses: diag.cache.misses,
    dedupeHits: diag.dedupe.hits,
    dedupeMisses: diag.dedupe.misses,
    entityCacheHits: diag.entityCache.hits,
    entityCacheMisses: diag.entityCache.misses,
    candidateReadCount:
      typeof debug.candidateReadCount === "number" ? Math.floor(debug.candidateReadCount) : null,
    rawCandidateCount:
      typeof debug.rawReelCandidates === "number" || typeof debug.rawFallbackCandidates === "number"
        ? Math.floor(Number(debug.rawReelCandidates ?? 0) + Number(debug.rawFallbackCandidates ?? 0))
        : null,
    hydratedPostCount: items.length,
    mediaAssetsCount: sumMediaAssets(items),
    firstPaintPosterCoverage: posterCoverage,
    firstPaintImmediateMediaCount: immediateMediaCount,
    detailBatchRequiredForFirstPaint:
      typeof debug.detailBatchRequiredForFirstPaint === "boolean"
        ? debug.detailBatchRequiredForFirstPaint
        : null,
    deckHit: typeof debug.deckHit === "boolean" ? debug.deckHit : null,
    deckSource: typeof debug.deckSource === "string" ? debug.deckSource : null,
    slowestSteps,
    fallbacks: [...diag.fallbacks],
    timeouts: [...diag.timeouts],
    debug,
    nextCursor: typeof body.data?.nextCursor === "string" ? body.data.nextCursor : null,
  };
}

function summarizeSeries(label: string, rows: ProbeResult[]): Record<string, unknown> {
  const durations = rows.map((row) => row.totalDurationMs);
  const reads = rows.map((row) => row.dbReads);
  return {
    label,
    count: rows.length,
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    p50Reads: percentile(reads, 0.5),
    p95Reads: percentile(reads, 0.95),
    maxDurationMs: Math.max(...durations),
    maxReads: Math.max(...reads),
  };
}

function printMarkdown(results: {
  coldFirst: ProbeResult;
  warmSeries: ProbeResult[];
  pageProbe: ProbeResult | null;
  bootstrapProbe: ProbeResult | null;
}): void {
  const warmSummary = summarizeSeries("for_you_simple_warm", results.warmSeries);
  const rows = [
    {
      route: results.coldFirst.label,
      durationMs: results.coldFirst.totalDurationMs,
      dbReads: results.coldFirst.dbReads,
      dbQueries: results.coldFirst.dbQueries,
      payloadBytes: results.coldFirst.payloadBytes,
      deckSource: results.coldFirst.deckSource ?? "n/a",
      candidateReads: results.coldFirst.candidateReadCount ?? 0,
    },
    ...(results.pageProbe
      ? [
          {
            route: results.pageProbe.label,
            durationMs: results.pageProbe.totalDurationMs,
            dbReads: results.pageProbe.dbReads,
            dbQueries: results.pageProbe.dbQueries,
            payloadBytes: results.pageProbe.payloadBytes,
            deckSource: results.pageProbe.deckSource ?? "n/a",
            candidateReads: results.pageProbe.candidateReadCount ?? 0,
          },
        ]
      : []),
    ...(results.bootstrapProbe
      ? [
          {
            route: results.bootstrapProbe.label,
            durationMs: results.bootstrapProbe.totalDurationMs,
            dbReads: results.bootstrapProbe.dbReads,
            dbQueries: results.bootstrapProbe.dbQueries,
            payloadBytes: results.bootstrapProbe.payloadBytes,
            deckSource: results.bootstrapProbe.deckSource ?? "n/a",
            candidateReads: results.bootstrapProbe.candidateReadCount ?? 0,
          },
        ]
      : []),
  ];

  console.log("\n# Read-Only For You Latency Probe");
  console.log("");
  console.log(`- userId: \`${userId}\``);
  console.log(`- guardActive: \`${isReadOnlyLatencyAuditGuardActive()}\``);
  console.log(`- warmSeriesCount: \`${results.warmSeries.length}\``);
  console.log(`- warmSeriesP50: \`${warmSummary.p50DurationMs}\` ms`);
  console.log(`- warmSeriesP95: \`${warmSummary.p95DurationMs}\` ms`);
  console.log("");
  console.log("| route | durationMs | dbReads | dbQueries | payloadBytes | deckSource | candidateReads |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const row of rows) {
    console.log(`| ${row.route} | ${row.durationMs} | ${row.dbReads} | ${row.dbQueries} | ${row.payloadBytes} | ${row.deckSource} | ${row.candidateReads} |`);
  }
  console.log("");
  console.log("## Cold First Slowest Steps");
  for (const step of results.coldFirst.slowestSteps) {
    console.log(`- ${step.name}: ${step.durationMs}ms`);
  }
}

const warmRepeatCountRaw = Number(process.env.REPEAT_COUNT ?? "5");
const warmRepeatCount = Number.isFinite(warmRepeatCountRaw)
  ? Math.max(2, Math.min(12, Math.floor(warmRepeatCountRaw)))
  : 5;

const app = createApp({
  NODE_ENV: "production",
  LOG_LEVEL: "silent",
});

try {
  await app.ready();

  const coldFirst = await probeRoute(app, {
    label: "for_you_simple:first_cold",
    url: `/v2/feed/for-you/simple?viewerId=${encodeURIComponent(userId)}&limit=5`,
  });

  const warmSeries: ProbeResult[] = [];
  for (let index = 0; index < warmRepeatCount; index += 1) {
    warmSeries.push(
      await probeRoute(app, {
        label: `for_you_simple:first_warm_${index + 1}`,
        url: `/v2/feed/for-you/simple?viewerId=${encodeURIComponent(userId)}&limit=5`,
      })
    );
  }

  const pageProbe =
    coldFirst.nextCursor
      ? await probeRoute(app, {
          label: "for_you_simple:page",
          url: `/v2/feed/for-you/simple?viewerId=${encodeURIComponent(userId)}&limit=5&cursor=${encodeURIComponent(coldFirst.nextCursor)}`,
        })
      : null;

  const bootstrapProbe = await probeRoute(app, {
    label: "feed_bootstrap:explore_control",
    url: `/v2/feed/bootstrap?limit=5&tab=explore`,
  }).catch(() => null);

  const output = {
    generatedAt: new Date().toISOString(),
    userId,
    readOnlyLatencyAudit: true,
    guardActive: isReadOnlyLatencyAuditGuardActive(),
    coldFirst,
    warmSeries,
    warmSummary: summarizeSeries("for_you_simple_warm", warmSeries),
    pageProbe,
    bootstrapProbe,
  };

  printMarkdown({ coldFirst, warmSeries, pageProbe, bootstrapProbe });
  console.log("\n```json");
  console.log(JSON.stringify(output, null, 2));
  console.log("```");
} finally {
  await app.close();
}
