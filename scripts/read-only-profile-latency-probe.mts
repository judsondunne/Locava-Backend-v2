const READ_ONLY_FLAG = "READ_ONLY_LATENCY_AUDIT";
const USER_ID_ENV = "USER_ID";
const PROFILE_USER_ID_ENV = "PROFILE_USER_ID";

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

const viewerId = requireEnv(USER_ID_ENV);
const profileUserId = String(process.env[PROFILE_USER_ID_ENV] ?? viewerId).trim() || viewerId;

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
  url: string;
  statusCode: number;
  totalDurationMs: number;
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
  itemCount: number;
  postCount: number | null;
  nextCursor: string | null;
  firstPaintPosterCoverage: number;
  firstPaintImmediateMediaCount: number;
  mediaAssetsCount: number;
  slowestSteps: Array<{ name: string; durationMs: number }>;
  fallbacks: string[];
  timeouts: string[];
  debug: Record<string, unknown>;
};

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return Math.round((sorted[index] ?? 0) * 100) / 100;
}

function countImmediateMedia(items: Array<Record<string, unknown>>): { posterCoverage: number; immediateMediaCount: number } {
  let withPoster = 0;
  let immediateMedia = 0;
  for (const item of items) {
    const media = (item.media as Record<string, unknown> | undefined) ?? undefined;
    const poster =
      typeof media?.posterUrl === "string" && media.posterUrl.trim()
        ? media.posterUrl.trim()
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

function sumMediaAssets(items: Array<Record<string, unknown>>): number {
  return items.reduce((sum, item) => sum + (Array.isArray(item.assets) ? item.assets.length : 0), 0);
}

function extractLatestDiagnostic(): ProbeDiagnostic {
  const latest = requestMetricsCollector.getRecentRequests(1)[0] as ProbeDiagnostic | undefined;
  if (!latest) {
    throw new Error("missing_request_diagnostic");
  }
  return latest;
}

function extractItems(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const direct = data.items;
  if (Array.isArray(direct)) return direct as Array<Record<string, unknown>>;
  const bootstrapItems = (data.firstRender as { gridPreview?: { items?: unknown } } | undefined)?.gridPreview?.items;
  return Array.isArray(bootstrapItems) ? (bootstrapItems as Array<Record<string, unknown>>) : [];
}

function extractNextCursor(body: Record<string, unknown>): string | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const direct = typeof data.nextCursor === "string" ? data.nextCursor : null;
  if (direct) return direct;
  const fromPage = (data.page as { nextCursor?: unknown } | undefined)?.nextCursor;
  if (typeof fromPage === "string") return fromPage;
  const fromBootstrap = (data.firstRender as { gridPreview?: { nextCursor?: unknown } } | undefined)?.gridPreview?.nextCursor;
  return typeof fromBootstrap === "string" ? fromBootstrap : null;
}

function extractPostCount(body: Record<string, unknown>): number | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const summaryCount = (data.summary as { postCount?: unknown } | undefined)?.postCount;
  return typeof summaryCount === "number" && Number.isFinite(summaryCount) ? Math.floor(summaryCount) : null;
}

function extractDebug(body: Record<string, unknown>): Record<string, unknown> {
  const data = (body.data ?? {}) as Record<string, unknown>;
  return ((data.debug as Record<string, unknown> | undefined) ?? {});
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
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal",
    },
  });
  const totalDurationMs = Date.now() - startedAt;
  const body = response.json() as Record<string, unknown>;
  if (!body.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new Error(`probe_failed:${input.label}:${error.code ?? response.statusCode}:${error.message ?? "unknown"}`);
  }
  const items = extractItems(body);
  const debug = extractDebug(body);
  const diag = extractLatestDiagnostic();
  const { posterCoverage, immediateMediaCount } = countImmediateMedia(items);
  const slowestSteps = Object.entries(diag.surfaceTimings ?? {})
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 8);

  return {
    label: input.label,
    url: input.url,
    statusCode: response.statusCode,
    totalDurationMs,
    payloadBytes: diag.payloadBytes || Buffer.byteLength(response.body, "utf8"),
    dbReads: Number(((body.meta as { db?: { reads?: unknown } } | undefined)?.db?.reads) ?? diag.dbOps.reads ?? 0),
    dbWrites: Number(((body.meta as { db?: { writes?: unknown } } | undefined)?.db?.writes) ?? diag.dbOps.writes ?? 0),
    dbQueries: Number(((body.meta as { db?: { queries?: unknown } } | undefined)?.db?.queries) ?? diag.dbOps.queries ?? 0),
    cacheHits: diag.cache.hits,
    cacheMisses: diag.cache.misses,
    dedupeHits: diag.dedupe.hits,
    dedupeMisses: diag.dedupe.misses,
    entityCacheHits: diag.entityCache.hits,
    entityCacheMisses: diag.entityCache.misses,
    itemCount: items.length,
    postCount: extractPostCount(body),
    nextCursor: extractNextCursor(body),
    firstPaintPosterCoverage: posterCoverage,
    firstPaintImmediateMediaCount: immediateMediaCount,
    mediaAssetsCount: sumMediaAssets(items),
    slowestSteps,
    fallbacks: [...diag.fallbacks],
    timeouts: [...diag.timeouts],
    debug,
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

function printMarkdown(input: {
  bootstrap: ProbeResult;
  bootstrapWarm: ProbeResult[];
  gridFirstPage: ProbeResult;
  gridSecondPage: ProbeResult | null;
}): void {
  const warmSummary = summarizeSeries("profile_bootstrap_warm", input.bootstrapWarm);
  const rows = [
    {
      route: input.bootstrap.label,
      durationMs: input.bootstrap.totalDurationMs,
      dbReads: input.bootstrap.dbReads,
      dbQueries: input.bootstrap.dbQueries,
      payloadBytes: input.bootstrap.payloadBytes,
      items: input.bootstrap.itemCount,
      postCount: input.bootstrap.postCount ?? "n/a",
    },
    {
      route: input.gridFirstPage.label,
      durationMs: input.gridFirstPage.totalDurationMs,
      dbReads: input.gridFirstPage.dbReads,
      dbQueries: input.gridFirstPage.dbQueries,
      payloadBytes: input.gridFirstPage.payloadBytes,
      items: input.gridFirstPage.itemCount,
      postCount: input.gridFirstPage.postCount ?? "n/a",
    },
    ...(input.gridSecondPage
      ? [
          {
            route: input.gridSecondPage.label,
            durationMs: input.gridSecondPage.totalDurationMs,
            dbReads: input.gridSecondPage.dbReads,
            dbQueries: input.gridSecondPage.dbQueries,
            payloadBytes: input.gridSecondPage.payloadBytes,
            items: input.gridSecondPage.itemCount,
            postCount: input.gridSecondPage.postCount ?? "n/a",
          },
        ]
      : []),
  ];

  console.log("# Profile Latency Probe");
  console.log("");
  console.log(`- viewerId: \`${viewerId}\``);
  console.log(`- profileUserId: \`${profileUserId}\``);
  console.log(`- guardActive: \`${isReadOnlyLatencyAuditGuardActive()}\``);
  console.log("");
  console.log("| route | durationMs | dbReads | dbQueries | payloadBytes | items | postCount |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log(
      `| ${row.route} | ${row.durationMs} | ${row.dbReads} | ${row.dbQueries} | ${row.payloadBytes} | ${row.items} | ${row.postCount} |`
    );
  }
  console.log("");
  console.log("Warm bootstrap summary:");
  console.log(JSON.stringify(warmSummary, null, 2));
}

const app = createApp({ logger: false });

const bootstrapUrl = `/v2/profiles/${encodeURIComponent(profileUserId)}/bootstrap?gridLimit=18&includeTabPreviews=0`;
const gridUrl = `/v2/profiles/${encodeURIComponent(profileUserId)}/grid?limit=24`;

const bootstrap = await probeRoute(app, {
  label: "profile_bootstrap_cold",
  url: bootstrapUrl,
});
const bootstrapWarm = [];
for (let i = 0; i < 5; i += 1) {
  bootstrapWarm.push(
    await probeRoute(app, {
      label: `profile_bootstrap_warm_${i + 1}`,
      url: bootstrapUrl,
    })
  );
}
const gridFirstPage = await probeRoute(app, {
  label: "profile_grid_first_page",
  url: gridUrl,
});
const gridSecondPage =
  gridFirstPage.nextCursor != null
    ? await probeRoute(app, {
        label: "profile_grid_second_page",
        url: `/v2/profiles/${encodeURIComponent(profileUserId)}/grid?limit=24&cursor=${encodeURIComponent(gridFirstPage.nextCursor)}`,
      })
    : null;

const result = {
  viewerId,
  profileUserId,
  guardActive: isReadOnlyLatencyAuditGuardActive(),
  bootstrap,
  bootstrapWarm,
  gridFirstPage,
  gridSecondPage,
  warmSummary: summarizeSeries("profile_bootstrap_warm", bootstrapWarm),
};

printMarkdown({
  bootstrap,
  bootstrapWarm,
  gridFirstPage,
  gridSecondPage,
});
console.log("");
console.log(JSON.stringify(result, null, 2));
