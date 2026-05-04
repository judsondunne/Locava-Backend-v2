import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HttpMethod = "GET" | "POST" | "HEAD";
type Phase = "first_paint" | "deferred_interactive" | "background";

type SimRequest = {
  name: string;
  method: HttpMethod;
  path: string;
  phase: Phase;
  body?: unknown;
  allowInReadOnly?: boolean;
};

type RouteMetric = {
  name: string;
  method: HttpMethod;
  path: string;
  routeName: string | null;
  phase: Phase;
  latencyMs: number;
  statusCode: number;
  ok: boolean;
  bytes: number;
  startedAtMs: number;
  endedAtMs: number;
  error?: string;
};

type FeedItem = Record<string, unknown>;

type VideoCheck = {
  postId: string;
  url: string;
  statusCode: number | null;
  reachable: boolean;
  latencyMs: number;
  contentType: string | null;
  contentLength: number | null;
  acceptRanges: string | null;
  rangeWorks: boolean;
  likelyLowQuality: boolean;
  signedLikelyExpired: boolean;
};

type SimConfig = {
  baseUrl: string;
  dashboardToken: string | null;
  authToken: string | null;
  viewerId: string;
  lat: number;
  lng: number;
  radiusMiles: number[];
  readOnly: boolean;
  mutationTestMode: boolean;
  maxPages: number;
  pageSize: number;
  networkProfile: "wifi" | "average_lte" | "bad_lte";
  concurrencyProfile: "native_startup" | "fast_scroll" | "background_pressure";
};

const DEFAULT_RADIUS_SERIES = [1, 10, 25, 50];
const SEARCH_QUERIES = ["hiking", "coffee", "swimming", "cool spots near me", "amazing hikes in New Jersey"];

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseRadius(raw: string | undefined): number[] {
  if (!raw || raw.trim().length === 0) return DEFAULT_RADIUS_SERIES;
  const values = raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.length > 0 ? values : DEFAULT_RADIUS_SERIES;
}

function normalizeUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function buildConfig(): SimConfig {
  const baseUrl = normalizeUrl(
    process.env.LOCAL_BACKEND_URL?.trim() ||
      process.env.DEPLOYED_BACKEND_URL?.trim() ||
      "http://127.0.0.1:3901",
  );
  const networkProfile = (process.env.NETWORK_PROFILE?.trim() || "average_lte") as SimConfig["networkProfile"];
  const concurrencyProfile = (process.env.CONCURRENCY_PROFILE?.trim() || "native_startup") as SimConfig["concurrencyProfile"];
  return {
    baseUrl,
    dashboardToken: process.env.INTERNAL_DASHBOARD_TOKEN?.trim() || null,
    authToken: process.env.TEST_USER_AUTH_TOKEN?.trim() || null,
    viewerId: process.env.TEST_VIEWER_ID?.trim() || "anonymous",
    lat: envNumber("TEST_LAT", 40.7128),
    lng: envNumber("TEST_LNG", -74.006),
    radiusMiles: parseRadius(process.env.TEST_RADIUS_MILES),
    readOnly: envBool("READ_ONLY", true),
    mutationTestMode: envBool("MUTATION_TEST_MODE", false),
    maxPages: Math.max(1, Math.min(20, Math.floor(envNumber("MAX_PAGES", 5)))),
    pageSize: Math.max(4, Math.min(30, Math.floor(envNumber("PAGE_SIZE", 5)))),
    networkProfile,
    concurrencyProfile,
  };
}

function delayForNetwork(profile: SimConfig["networkProfile"]): Promise<void> {
  if (profile === "wifi") return Promise.resolve();
  const ms = profile === "average_lte" ? 80 : 220;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertSafeRequest(cfg: SimConfig, req: SimRequest): void {
  if (!cfg.readOnly) return;
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.allowInReadOnly) return;
  throw new Error(`read_only_blocked:${req.method}:${req.path}`);
}

function responseBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function extractRouteName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  if (typeof data?.routeName === "string" && data.routeName.length > 0) return data.routeName;
  if (typeof root.routeName === "string" && root.routeName.length > 0) return root.routeName;
  return null;
}

function readHealthValue(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  if (data && key in data) return data[key];
  if (key in root) return root[key];
  return null;
}

function readHealthOverall(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const overall = data?.overall as Record<string, unknown> | undefined;
  if (overall && key in overall) return overall[key];
  return null;
}

async function runRequest(cfg: SimConfig, req: SimRequest): Promise<{ metric: RouteMetric; json: unknown | null }> {
  assertSafeRequest(cfg, req);
  await delayForNetwork(cfg.networkProfile);
  const startedAtMs = Date.now();
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-viewer-id": cfg.viewerId,
    "x-viewer-roles": "internal",
  };
  if (cfg.authToken) headers.authorization = `Bearer ${cfg.authToken}`;
  if (req.body !== undefined) headers["content-type"] = "application/json";
  let response: Response | null = null;
  let bodyText = "";
  let parsed: unknown | null = null;
  let errorText: string | undefined;
  try {
    response = await fetch(`${cfg.baseUrl}${req.path}`, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
    bodyText = req.method === "HEAD" ? "" : await response.text();
    if (bodyText.length > 0) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }
    }
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
  }
  const endedAtMs = Date.now();
  const statusCode = response?.status ?? 0;
  const metric: RouteMetric = {
    name: req.name,
    method: req.method,
    path: req.path,
    routeName: extractRouteName(parsed),
    phase: req.phase,
    latencyMs: endedAtMs - startedAtMs,
    statusCode,
    ok: Boolean(response?.ok),
    bytes: responseBytes(bodyText),
    startedAtMs,
    endedAtMs,
    ...(errorText ? { error: errorText } : {}),
  };
  return { metric, json: parsed };
}

async function fetchHealth(cfg: SimConfig): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (cfg.dashboardToken) headers["x-internal-dashboard-token"] = cfg.dashboardToken;
  const response = await fetch(`${cfg.baseUrl}/internal/health-dashboard/data`, { method: "GET", headers });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function toFeedItems(feedPayload: unknown): FeedItem[] {
  if (!feedPayload || typeof feedPayload !== "object") return [];
  const root = feedPayload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const items = (data?.items ?? root.items) as unknown;
  return Array.isArray(items) ? (items as FeedItem[]) : [];
}

function readNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const value = (data?.nextCursor ?? root.nextCursor) as unknown;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function collectVideoCandidates(items: FeedItem[]): Array<{ postId: string; url: string }> {
  const result: Array<{ postId: string; url: string }> = [];
  for (const item of items) {
    const postId = String(item.postId ?? "");
    if (!postId) continue;
    const assets = Array.isArray(item.assets) ? (item.assets as Array<Record<string, unknown>>) : [];
    for (const asset of assets) {
      const variants = (asset.variants as Record<string, unknown> | undefined) ?? {};
      const urlCandidates = [
        String(variants.main720 ?? ""),
        String(variants.main720Avc ?? ""),
        String(variants.hls ?? ""),
        String(variants.preview360 ?? ""),
        String(asset.streamUrl ?? ""),
        String(asset.mp4Url ?? ""),
      ].filter((v) => v.startsWith("http"));
      if (urlCandidates.length > 0) {
        result.push({ postId, url: urlCandidates[0] });
        break;
      }
    }
  }
  return result;
}

async function checkVideoUrl(candidate: { postId: string; url: string }): Promise<VideoCheck> {
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let reachable = false;
  let contentType: string | null = null;
  let contentLength: number | null = null;
  let acceptRanges: string | null = null;
  let rangeWorks = false;
  try {
    const head = await fetch(candidate.url, { method: "HEAD" });
    statusCode = head.status;
    reachable = head.ok;
    contentType = head.headers.get("content-type");
    const lengthRaw = head.headers.get("content-length");
    contentLength = lengthRaw ? Number(lengthRaw) : null;
    acceptRanges = head.headers.get("accept-ranges");
    if (candidate.url.startsWith("http")) {
      const partial = await fetch(candidate.url, {
        method: "GET",
        headers: { range: "bytes=0-2047" },
      });
      rangeWorks = partial.status === 206 || partial.headers.get("content-range") !== null;
      await partial.arrayBuffer();
    }
  } catch {
    reachable = false;
  }
  const endedAt = Date.now();
  const lowUrl = candidate.url.toLowerCase();
  return {
    postId: candidate.postId,
    url: candidate.url,
    statusCode,
    reachable,
    latencyMs: endedAt - startedAt,
    contentType,
    contentLength: Number.isFinite(contentLength as number) ? (contentLength as number) : null,
    acceptRanges,
    rangeWorks,
    likelyLowQuality: lowUrl.includes("preview") || lowUrl.includes("360"),
    signedLikelyExpired: lowUrl.includes("expires=") && lowUrl.includes("signature=") && !reachable,
  };
}

function percentile(input: number[], p: number): number {
  if (input.length === 0) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function groupByRoute(metrics: RouteMetric[]): Record<string, RouteMetric[]> {
  const grouped: Record<string, RouteMetric[]> = {};
  for (const metric of metrics) {
    const key = metric.routeName ?? `${metric.method} ${metric.path.split("?")[0]}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(metric);
  }
  return grouped;
}

function writeOutputs(payload: unknown): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const artifactsPath = path.join(repoRoot, "artifacts", "health");
  const docsPath = path.join(repoRoot, "docs", "health");
  fs.mkdirSync(artifactsPath, { recursive: true });
  fs.mkdirSync(docsPath, { recursive: true });
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const jsonTarget = path.join(artifactsPath, "native-session-sim-latest.json");
  fs.writeFileSync(jsonTarget, JSON.stringify(payload, null, 2));
  const reportTarget = path.join(docsPath, `native-session-sim-report-${date}.md`);
  const data = payload as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown>;
  const lines = [
    "# Native Session Simulator Report",
    "",
    `Generated: ${String(data.generatedAt)}`,
    `Base URL: \`${String(data.baseUrl)}\``,
    `Read only: \`${String(data.readOnly)}\``,
    "",
    "## Session Metrics",
    "",
    `- Total duration ms: ${String(summary.totalDurationMs)}`,
    `- Time to app bootstrap ms: ${String(summary.timeToBootstrapMs)}`,
    `- Time to first feed response ms: ${String(summary.timeToFirstFeedResponseMs)}`,
    `- Time to first playable video probe ms: ${String(summary.timeToFirstPlayableVideoMs)}`,
    `- Duplicate post rate: ${String(summary.duplicatePostRate)}`,
    `- Duplicate asset rate: ${String(summary.duplicateAssetRate)}`,
    `- Missing asset rate: ${String(summary.missingAssetRate)}`,
    `- Low quality video selections: ${String(summary.lowQualityVideoCount)}`,
    "",
    "## Dashboard Diff",
    "",
    "```json",
    JSON.stringify(data.dashboardDelta, null, 2),
    "```",
    "",
  ];
  fs.writeFileSync(reportTarget, lines.join("\n"));
}

export async function main(): Promise<void> {
  const cfg = buildConfig();
  const runStartedAt = Date.now();
  const beforeHealth = await fetchHealth(cfg).catch(() => null);
  const metrics: RouteMetric[] = [];
  const feedPosts: FeedItem[] = [];
  const backgroundStartAt = Date.now();
  let firstFeedMs = 0;

  const startupA: SimRequest[] = [
    { name: "auth.session", method: "GET", path: "/v2/auth/session", phase: "first_paint" },
    { name: "feed.for_you.simple", method: "GET", path: `/v2/feed/for-you/simple?limit=${cfg.pageSize}`, phase: "first_paint" },
  ];
  for (const req of startupA) {
    const { metric, json } = await runRequest(cfg, req);
    metrics.push(metric);
    if (req.name === "feed.for_you.simple") {
      firstFeedMs = metric.latencyMs;
      const items = toFeedItems(json);
      feedPosts.push(...items);
    }
  }

  const deferredCalls: SimRequest[] = [
    { name: "feed.bootstrap", method: "GET", path: `/v2/feed/bootstrap?limit=${cfg.pageSize}`, phase: "deferred_interactive" },
    { name: "notifications.list", method: "GET", path: "/v2/notifications?limit=15", phase: "background" },
    { name: "chats.inbox", method: "GET", path: "/v2/chats/inbox?limit=15", phase: "background" },
    { name: "achievements.bootstrap", method: "GET", path: "/v2/achievements/bootstrap", phase: "background" },
    { name: "achievements.snapshot", method: "GET", path: "/v2/achievements/snapshot", phase: "background" },
    { name: "achievements.hero", method: "GET", path: "/v2/achievements/hero", phase: "background" },
    { name: "legends.unseen", method: "GET", path: "/v2/legends/events/unseen", phase: "background" },
    { name: "social.suggested_friends", method: "GET", path: "/v2/social/suggested-friends?surface=generic&limit=25", phase: "background" },
  ];
  const deferredResults = await Promise.allSettled(deferredCalls.map((req) => runRequest(cfg, req)));
  for (const result of deferredResults) {
    if (result.status === "fulfilled") metrics.push(result.value.metric);
  }
  const backgroundOverlapMs = Date.now() - backgroundStartAt;

  let cursor = readNextCursor({ data: { nextCursor: null } });
  for (let page = 1; page <= cfg.maxPages; page += 1) {
    const query = new URLSearchParams({ limit: String(cfg.pageSize) });
    if (cursor) query.set("cursor", cursor);
    const { metric, json } = await runRequest(cfg, {
      name: `feed.pagination.page_${page}`,
      method: "GET",
      path: `/v2/feed/for-you/simple?${query.toString()}`,
      phase: "deferred_interactive",
    });
    metrics.push(metric);
    const items = toFeedItems(json);
    if (items.length === 0) break;
    feedPosts.push(...items);
    const next = readNextCursor(json);
    if (!next || next === cursor) break;
    cursor = next;
  }

  const videoCandidates = collectVideoCandidates(feedPosts).slice(0, 6);
  const videoChecks: VideoCheck[] = [];
  for (const candidate of videoCandidates) videoChecks.push(await checkVideoUrl(candidate));

  for (const radius of cfg.radiusMiles) {
    const q = new URLSearchParams({
      lat: String(cfg.lat),
      lng: String(cfg.lng),
      radiusMiles: String(radius),
      limit: String(cfg.pageSize),
    });
    const nearMe = await runRequest(cfg, {
      name: `radius.near_me.${radius}`,
      method: "GET",
      path: `/api/v1/product/reels/near-me?${q.toString()}`,
      phase: "deferred_interactive",
    });
    metrics.push(nearMe.metric);
    const count = await runRequest(cfg, {
      name: `radius.near_me_count.${radius}`,
      method: "GET",
      path: `/api/v1/product/reels/near-me/count?${q.toString()}`,
      phase: "deferred_interactive",
    });
    metrics.push(count.metric);
  }

  const mapMarkers = await runRequest(cfg, {
    name: "map.markers",
    method: "GET",
    path: "/v2/map/markers?payloadMode=compact",
    phase: "deferred_interactive",
  });
  metrics.push(mapMarkers.metric);

  for (const queryText of SEARCH_QUERIES) {
    const query = encodeURIComponent(queryText);
    const suggest = await runRequest(cfg, {
      name: `search.suggest.${queryText}`,
      method: "GET",
      path: `/v2/search/suggest?q=${query}`,
      phase: "deferred_interactive",
    });
    metrics.push(suggest.metric);
  }
  metrics.push(
    (await runRequest(cfg, { name: "search.home_bootstrap", method: "GET", path: "/v2/search/home-bootstrap", phase: "deferred_interactive" })).metric,
  );
  metrics.push(
    (await runRequest(cfg, { name: "search.results", method: "GET", path: `/v2/search/results?q=${encodeURIComponent("hiking")}&limit=10&types=posts,collections`, phase: "deferred_interactive" })).metric,
  );
  metrics.push(
    (await runRequest(cfg, { name: "search.mixes.bootstrap", method: "GET", path: `/v2/search/mixes/bootstrap?lat=${cfg.lat}&lng=${cfg.lng}&limit=8`, phase: "deferred_interactive" })).metric,
  );

  const firstPost = feedPosts[0] ?? null;
  const firstPostId = firstPost ? String(firstPost.postId ?? "") : "";
  const firstAuthorId = firstPost ? String((firstPost.author as Record<string, unknown> | undefined)?.userId ?? "") : "";
  if (firstPostId) {
    metrics.push((await runRequest(cfg, { name: "feed.item.detail", method: "GET", path: `/v2/feed/items/${encodeURIComponent(firstPostId)}/detail`, phase: "deferred_interactive" })).metric);
    metrics.push((await runRequest(cfg, { name: "posts.detail", method: "GET", path: `/v2/posts/${encodeURIComponent(firstPostId)}/detail`, phase: "deferred_interactive" })).metric);
    metrics.push((await runRequest(cfg, { name: "posts.detail.batch", method: "POST", path: "/v2/posts/details:batch", body: { postIds: [firstPostId], reason: "open" }, allowInReadOnly: true, phase: "deferred_interactive" })).metric);
  }
  if (firstAuthorId) {
    metrics.push((await runRequest(cfg, { name: "profile.bootstrap", method: "GET", path: `/v2/profiles/${encodeURIComponent(firstAuthorId)}/bootstrap?gridLimit=12`, phase: "deferred_interactive" })).metric);
    metrics.push((await runRequest(cfg, { name: "profile.grid", method: "GET", path: `/v2/profiles/${encodeURIComponent(firstAuthorId)}/grid?limit=12`, phase: "deferred_interactive" })).metric);
  }
  metrics.push((await runRequest(cfg, { name: "collections.list", method: "GET", path: "/v2/collections?limit=12", phase: "deferred_interactive" })).metric);
  metrics.push((await runRequest(cfg, { name: "places.reverse_geocode", method: "GET", path: `/v2/places/reverse-geocode?lat=${cfg.lat}&lng=${cfg.lng}`, phase: "background" })).metric);

  // Build stronger sample sizes for dashboard reliability without mutating data.
  const sampleFillRequests: SimRequest[] = [
    { name: "feed.bootstrap.samplefill", method: "GET", path: `/v2/feed/bootstrap?limit=${cfg.pageSize}`, phase: "deferred_interactive" },
    { name: "achievements.bootstrap.samplefill", method: "GET", path: "/v2/achievements/bootstrap", phase: "background" },
    { name: "achievements.snapshot.samplefill", method: "GET", path: "/v2/achievements/snapshot", phase: "background" },
    { name: "achievements.hero.samplefill", method: "GET", path: "/v2/achievements/hero", phase: "background" },
    { name: "social.suggested_friends.samplefill", method: "GET", path: "/v2/social/suggested-friends?surface=generic&limit=25", phase: "background" },
    { name: "map.markers.samplefill", method: "GET", path: "/v2/map/markers?payloadMode=compact", phase: "deferred_interactive" },
    { name: "places.reverse_geocode.samplefill", method: "GET", path: `/v2/places/reverse-geocode?lat=${cfg.lat}&lng=${cfg.lng}`, phase: "background" },
    { name: "search.results.samplefill", method: "GET", path: `/v2/search/results?q=${encodeURIComponent("hiking")}&limit=10&types=posts,collections`, phase: "deferred_interactive" },
  ];
  for (let i = 0; i < 4; i += 1) {
    const passResults = await Promise.allSettled(sampleFillRequests.map((req) => runRequest(cfg, req)));
    for (const result of passResults) {
      if (result.status === "fulfilled") metrics.push(result.value.metric);
    }
  }

  const afterHealth = await fetchHealth(cfg).catch(() => null);
  const totalDurationMs = Date.now() - runStartedAt;
  const grouped = groupByRoute(metrics);
  const uniquePostIds = new Set(feedPosts.map((row) => String(row.postId ?? "")).filter(Boolean));
  const duplicatePostRate = feedPosts.length === 0 ? 0 : Number(((feedPosts.length - uniquePostIds.size) / feedPosts.length).toFixed(4));
  let assetCount = 0;
  let duplicateAssetCount = 0;
  let missingAssetCount = 0;
  for (const post of feedPosts) {
    const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];
    const seen = new Set<string>();
    if (assets.length === 0) missingAssetCount += 1;
    for (const asset of assets) {
      assetCount += 1;
      const id = String(asset.id ?? asset.url ?? "");
      if (!id) continue;
      if (seen.has(id)) duplicateAssetCount += 1;
      seen.add(id);
    }
  }
  const summary = {
    totalDurationMs,
    timeToBootstrapMs: metrics.find((m) => m.name === "auth.session")?.latencyMs ?? 0,
    timeToFirstFeedResponseMs: firstFeedMs,
    timeToFirstPlayableVideoMs: videoChecks[0]?.latencyMs ?? 0,
    duplicatePostRate,
    duplicateAssetRate: assetCount === 0 ? 0 : Number((duplicateAssetCount / assetCount).toFixed(4)),
    missingAssetRate: feedPosts.length === 0 ? 0 : Number((missingAssetCount / feedPosts.length).toFixed(4)),
    lowQualityVideoCount: videoChecks.filter((v) => v.likelyLowQuality).length,
    slowVideoUrlCount: videoChecks.filter((v) => v.latencyMs > 1200).length,
    rangeUnsupportedCount: videoChecks.filter((v) => !v.rangeWorks).length,
    backgroundOverlapMs,
  };
  const routeStats = Object.entries(grouped).map(([routeKey, rows]) => {
    const latencies = rows.map((r) => r.latencyMs);
    const bytes = rows.reduce((sum, r) => sum + r.bytes, 0);
    return {
      route: routeKey,
      calls: rows.length,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
      totalBytes: bytes,
      errorCount: rows.filter((r) => !r.ok).length,
    };
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    readOnly: cfg.readOnly,
    config: cfg,
    beforeHealth,
    afterHealth,
    dashboardDelta: {
      beforeOverallStatus: readHealthOverall(beforeHealth, "status"),
      afterOverallStatus: readHealthOverall(afterHealth, "status"),
      beforeObservedRoutes: readHealthOverall(beforeHealth, "observedBudgetedRoutes"),
      afterObservedRoutes: readHealthOverall(afterHealth, "observedBudgetedRoutes"),
      beforeObservedNonDashboardRequests: readHealthOverall(beforeHealth, "observedNonDashboardRequests"),
      afterObservedNonDashboardRequests: readHealthOverall(afterHealth, "observedNonDashboardRequests"),
    },
    summary,
    routeStats,
    metrics,
    videoChecks,
  };
  writeOutputs(payload);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
