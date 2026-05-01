import type { AppEnv } from "../../config/env.js";
import { listRoutePolicies, type RouteBudgetPolicy } from "../../observability/route-policies.js";
import { collectRuntimeHealth } from "../../observability/runtime-health.collector.js";
import { requestMetricsCollector, type RouteRuntimeMetrics } from "../../observability/request-metrics.collector.js";
import { errorRingBuffer } from "../../observability/error-ring-buffer.js";
import { firestoreHealthService } from "../../observability/firestore-health.service.js";
import { cacheMetricsCollector } from "../../observability/cache-metrics.collector.js";
import { getConfigHealthSnapshot } from "../../observability/config-health.service.js";

type HealthStatus = "healthy" | "degraded" | "critical" | "not_available";

type RouteDashboardRow = {
  routeName: string;
  method: string | null;
  path: string | null;
  priority: RouteBudgetPolicy["priority"];
  latencyBudgetP95Ms: number;
  dbReadBudget: number;
  payloadBudgetBytes: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  avgLatencyMs: number | null;
  requestCount: number;
  recentFailures: number;
  budgetViolations: number;
  commonBudgetViolation: string | null;
  status: HealthStatus;
  statusReason: string;
  lastSeenAt: string | null;
  avgDbReads: number | null;
  avgPayloadBytes: number | null;
  errorRate: number;
};

type SurfaceCard = {
  surface: string;
  routeNames: string[];
  requestCount: number;
  failures: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  commonBudgetViolation: string | null;
  status: HealthStatus;
};

export type HealthDashboardData = {
  refreshedAt: string;
  auth: {
    localMode: boolean;
    tokenProtected: boolean;
    warning: string | null;
  };
  overall: {
    status: HealthStatus;
    environment: string;
    timestamp: string;
    uptimeSec: number;
    serviceVersion: string;
    gitCommit: string | null;
    nodeVersion: string;
    runtime: ReturnType<typeof collectRuntimeHealth>;
    recentErrorCount: number;
    recentWarningCount: number;
  };
  routeHealth: RouteDashboardRow[];
  firestore: Awaited<ReturnType<typeof firestoreHealthService.getSnapshot>>;
  cache: ReturnType<typeof cacheMetricsCollector.getSnapshot>;
  surfaces: SurfaceCard[];
  errors: ReturnType<typeof errorRingBuffer.getRecent>;
  expensiveRoutes: {
    highestP95Latency: RouteDashboardRow[];
    highestAvgDbReads: RouteDashboardRow[];
    highestPayload: RouteDashboardRow[];
    mostBudgetViolations: RouteDashboardRow[];
    highestErrorRate: RouteDashboardRow[];
  };
  recentRequests: ReturnType<typeof requestMetricsCollector.getRecentRequests>;
  config: ReturnType<typeof getConfigHealthSnapshot>;
  warnings: string[];
};

const SURFACE_GROUPS: Array<{ surface: string; includes: string[] }> = [
  { surface: "Feed", includes: ["feed."] },
  { surface: "Map", includes: ["map."] },
  { surface: "Search", includes: ["search.", "mixes.", "directory.users.get"] },
  { surface: "Profiles", includes: ["profile."] },
  { surface: "Collections", includes: ["collections.", "posts.save", "posts.unsave", "posts.save-state"] },
  { surface: "Chats", includes: ["chats."] },
  { surface: "Notifications", includes: ["notifications."] },
  { surface: "Achievements", includes: ["achievements.", "legends."] },
  { surface: "Auth/session", includes: ["auth.", "bootstrap."] },
  {
    surface: "Posting/media",
    includes: [
      "posting.",
      "posts.stage",
      "posts.publish",
      "posts.mediasignupload",
      "posts.mediacomplete",
      "compat.upload.profile-picture.post"
    ]
  }
];

export class HealthDashboardService {
  async buildData(input: {
    env: AppEnv;
    authWarning: string | null;
  }): Promise<HealthDashboardData> {
    const refreshedAt = new Date().toISOString();
    const runtime = collectRuntimeHealth();
    const routeMetricsByName = new Map(
      requestMetricsCollector.getRouteMetrics().map((metric) => [metric.routeName, metric])
    );
    const routeHealth = listRoutePolicies()
      .map((policy) => toRouteDashboardRow(policy, routeMetricsByName.get(policy.routeName)))
      .sort((left, right) => severityWeight(right.status) - severityWeight(left.status) || right.requestCount - left.requestCount);
    const firestore = await firestoreHealthService.getSnapshot();
    const cache = cacheMetricsCollector.getSnapshot();
    const errors = errorRingBuffer.getRecent(100);
    const config = getConfigHealthSnapshot(input.env);
    const surfaces = buildSurfaceCards(routeHealth);
    const warnings = [
      ...(input.authWarning ? [input.authWarning] : []),
      ...config.warnings,
      ...deriveDashboardWarnings(routeHealth, firestore)
    ];

    return {
      refreshedAt,
      auth: {
        localMode: input.env.NODE_ENV !== "production" && !input.env.INTERNAL_DASHBOARD_TOKEN,
        tokenProtected: Boolean(input.env.INTERNAL_DASHBOARD_TOKEN),
        warning: input.authWarning
      },
      overall: {
        status: deriveOverallStatus(routeHealth, firestore, warnings),
        environment: input.env.NODE_ENV,
        timestamp: refreshedAt,
        uptimeSec: runtime.uptimeSec,
        serviceVersion: input.env.SERVICE_VERSION,
        gitCommit: resolveGitCommit(),
        nodeVersion: runtime.nodeVersion,
        runtime,
        recentErrorCount: errors.filter((entry) => entry.level === "error").length,
        recentWarningCount: errors.filter((entry) => entry.level === "warn").length
      },
      routeHealth,
      firestore,
      cache,
      surfaces,
      errors,
      expensiveRoutes: {
        highestP95Latency: topRoutes(routeHealth, (row) => row.p95LatencyMs ?? -1),
        highestAvgDbReads: topRoutes(routeHealth, (row) => row.avgDbReads ?? -1),
        highestPayload: topRoutes(routeHealth, (row) => row.avgPayloadBytes ?? -1),
        mostBudgetViolations: topRoutes(routeHealth, (row) => row.budgetViolations),
        highestErrorRate: topRoutes(routeHealth, (row) => row.errorRate)
      },
      recentRequests: requestMetricsCollector.getRecentRequests(100),
      config,
      warnings
    };
  }

  renderHtml(data: HealthDashboardData, input: { token: string | null }): string {
    const jsonHref = buildDashboardHref("/internal/health-dashboard/data", input.token);
    const routeRows = data.routeHealth
      .map(
        (row) => `
          <tr>
            <td><div class="strong">${escapeHtml(row.routeName)}</div><div class="muted">${escapeHtml(formatMethodPath(row.method, row.path))}</div></td>
            <td>${escapeHtml(row.priority)}</td>
            <td>${escapeHtml(`${row.latencyBudgetP95Ms}ms`)}</td>
            <td>${escapeHtml(`${row.dbReadBudget} reads`)}</td>
            <td>${escapeHtml(formatBytes(row.payloadBudgetBytes))}</td>
            <td>${escapeHtml(formatLatencyTriple(row.p50LatencyMs, row.p95LatencyMs, row.p99LatencyMs))}</td>
            <td>${escapeHtml(String(row.requestCount))}</td>
            <td>${escapeHtml(String(row.recentFailures))}</td>
            <td>${escapeHtml(String(row.budgetViolations))}</td>
            <td>${statusBadge(row.status, row.statusReason)}</td>
          </tr>`
      )
      .join("");
    const requestRows = data.recentRequests
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(formatTimestamp(row.timestamp))}</td>
            <td>${escapeHtml(row.method)}</td>
            <td>${escapeHtml(row.route)}</td>
            <td>${escapeHtml(row.routeName ?? "not available yet")}</td>
            <td>${escapeHtml(String(row.statusCode))}</td>
            <td>${escapeHtml(`${row.latencyMs}ms`)}</td>
            <td>${escapeHtml(`${row.dbOps.reads}/${row.dbOps.writes}/${row.dbOps.queries}`)}</td>
            <td>${escapeHtml(formatBytes(row.payloadBytes))}</td>
            <td>${escapeHtml(row.budgetViolations.join(", ") || "none")}</td>
            <td><code>${escapeHtml(row.requestId)}</code></td>
          </tr>`
      )
      .join("");
    const errorRows = data.errors
      .map(
        (entry) => `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td>${statusBadge(entry.level === "error" ? "critical" : "degraded", entry.level)}</td>
            <td>${escapeHtml(entry.routeName ?? "not available yet")}</td>
            <td><code>${escapeHtml(entry.requestId ?? "n/a")}</code></td>
            <td>${escapeHtml(entry.message)}</td>
            <td>${escapeHtml(entry.statusCode == null ? "n/a" : String(entry.statusCode))}</td>
            <td>${data.auth.localMode ? `<pre class="stack">${escapeHtml(entry.stack ?? "n/a")}</pre>` : `<span class="muted">${escapeHtml(entry.stack ? "hidden outside dev/local mode" : "n/a")}</span>`}</td>
          </tr>`
      )
      .join("");
    const configChecks = data.config.checks
      .map(
        (check) => `
          <div class="mini-card">
            <div class="mini-label">${escapeHtml(check.label)}</div>
            <div class="mini-value ${check.configured ? "ok" : "bad"}">${check.configured ? "Configured" : "Missing"}</div>
            <div class="muted">${escapeHtml(check.detail)}</div>
          </div>`
      )
      .join("");
    const surfaceCards = data.surfaces
      .map(
        (surface) => `
          <article class="surface-card">
            <div class="surface-head">
              <h3>${escapeHtml(surface.surface)}</h3>
              ${statusBadge(surface.status)}
            </div>
            <div class="surface-stats">
              <span>${escapeHtml(`Requests ${surface.requestCount}`)}</span>
              <span>${escapeHtml(`Failures ${surface.failures}`)}</span>
              <span>${escapeHtml(`Avg ${surface.avgLatencyMs == null ? "n/a" : `${surface.avgLatencyMs}ms`}`)}</span>
              <span>${escapeHtml(`P95 ${surface.p95LatencyMs == null ? "n/a" : `${surface.p95LatencyMs}ms`}`)}</span>
            </div>
            <div class="muted">${escapeHtml(`Most common budget violation: ${surface.commonBudgetViolation ?? "none"}`)}</div>
            <div class="route-list">${surface.routeNames.slice(0, 8).map((name) => `<code>${escapeHtml(name)}</code>`).join("")}</div>
          </article>`
      )
      .join("");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Locava Backendv2 Health Dashboard</title>
    <style>
      :root {
        --bg: #f4f6f8;
        --surface: rgba(255, 255, 255, 0.92);
        --surface-strong: #ffffff;
        --line: #d9e0e8;
        --text: #132033;
        --muted: #5d6b7d;
        --healthy: #16794b;
        --healthy-bg: #dff6ea;
        --degraded: #9a6700;
        --degraded-bg: #fff1cc;
        --critical: #b42318;
        --critical-bg: #fde8e8;
        --na: #475467;
        --na-bg: #eaecf0;
        --shadow: 0 12px 24px rgba(16, 24, 40, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(64, 153, 255, 0.18), transparent 26%),
          radial-gradient(circle at top right, rgba(16, 185, 129, 0.16), transparent 22%),
          linear-gradient(180deg, #eef4f8 0%, #f6f8fb 100%);
      }
      a { color: #155eef; text-decoration: none; }
      .page { max-width: 1640px; margin: 0 auto; padding: 24px; }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        padding: 18px 20px;
        margin-bottom: 20px;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: blur(14px);
        border-bottom: 1px solid rgba(217, 224, 232, 0.85);
        box-shadow: 0 6px 20px rgba(16, 24, 40, 0.06);
      }
      .topbar-grid {
        display: grid;
        grid-template-columns: 2fr repeat(5, minmax(0, 1fr));
        gap: 12px;
        align-items: start;
      }
      .summary-card, .panel, .surface-card, .mini-card {
        background: var(--surface);
        border: 1px solid rgba(217, 224, 232, 0.88);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }
      .summary-card {
        padding: 16px 18px;
      }
      .summary-title {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .summary-value {
        font-size: 26px;
        font-weight: 700;
      }
      .summary-sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      .banner {
        border-radius: 16px;
        padding: 14px 16px;
        margin-bottom: 14px;
        border: 1px solid transparent;
        font-weight: 600;
      }
      .banner.warn {
        background: var(--degraded-bg);
        color: var(--degraded);
        border-color: rgba(154, 103, 0, 0.25);
      }
      .banner.crit {
        background: var(--critical-bg);
        color: var(--critical);
        border-color: rgba(180, 35, 24, 0.2);
      }
      .controls {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 10px;
        color: var(--muted);
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
        border-radius: 999px;
        background: #155eef;
        color: white;
        font-weight: 700;
      }
      .content {
        display: grid;
        grid-template-columns: 1fr;
        gap: 20px;
      }
      .panel { padding: 18px; overflow: hidden; }
      .panel h2 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      .panel-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 12px;
      }
      .metrics-grid, .config-grid, .surface-grid {
        display: grid;
        gap: 14px;
      }
      .metrics-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .config-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .surface-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .mini-card {
        padding: 14px;
      }
      .mini-label {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 6px;
      }
      .mini-value {
        font-size: 22px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .mini-value.ok { color: var(--healthy); }
      .mini-value.bad { color: var(--critical); }
      .table-wrap {
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--surface-strong);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 980px;
      }
      th, td {
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        font-size: 14px;
      }
      th {
        position: sticky;
        top: 0;
        background: #f8fafc;
        z-index: 1;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      tr:last-child td { border-bottom: none; }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .badge.healthy { background: var(--healthy-bg); color: var(--healthy); }
      .badge.degraded { background: var(--degraded-bg); color: var(--degraded); }
      .badge.critical { background: var(--critical-bg); color: var(--critical); }
      .badge.not_available { background: var(--na-bg); color: var(--na); }
      .muted { color: var(--muted); font-size: 13px; }
      .strong { font-weight: 700; }
      .surface-card {
        padding: 16px;
      }
      .surface-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 10px;
      }
      .surface-head h3 {
        margin: 0;
        font-size: 18px;
      }
      .surface-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 10px;
        font-size: 14px;
      }
      .route-list {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      code {
        background: #eef2ff;
        border-radius: 8px;
        padding: 3px 7px;
        font-size: 12px;
      }
      .stack {
        margin: 0;
        max-width: 340px;
        white-space: pre-wrap;
        font-size: 12px;
        color: var(--muted);
      }
      ul.warning-list {
        margin: 0;
        padding-left: 18px;
      }
      @media (max-width: 1280px) {
        .topbar-grid,
        .metrics-grid,
        .config-grid,
        .surface-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 840px) {
        .page { padding: 14px; }
        .topbar-grid,
        .metrics-grid,
        .config-grid,
        .surface-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="page">
        ${data.warnings
          .map((warning) => `<div class="banner ${data.overall.status === "critical" ? "crit" : "warn"}">${escapeHtml(warning)}</div>`)
          .join("")}
        <div class="topbar-grid">
          <div class="summary-card">
            <div class="summary-title">Overall Status</div>
            <div class="summary-value">Locava Backendv2 ${statusBadge(data.overall.status)}</div>
            <div class="summary-sub">${escapeHtml(
              `${data.overall.environment} • version ${data.overall.serviceVersion}${data.overall.gitCommit ? ` • commit ${data.overall.gitCommit}` : ""}`
            )}</div>
            <div class="controls">
              <span>Last refreshed at ${escapeHtml(formatTimestamp(data.refreshedAt))}</span>
              <a class="button" href="${escapeHtml(jsonHref)}">Open JSON Data</a>
            </div>
          </div>
          ${summaryCard("Uptime", `${formatNumber(data.overall.uptimeSec)}s`, `PID ${data.overall.runtime.pid}`)}
          ${summaryCard("RSS Memory", formatBytes(data.overall.runtime.memory.rssBytes), `Heap used ${formatBytes(data.overall.runtime.memory.heapUsedBytes)}`)}
          ${summaryCard("CPU", `${formatNumber(data.overall.runtime.cpu.userMs + data.overall.runtime.cpu.systemMs)}ms`, `user ${formatNumber(data.overall.runtime.cpu.userMs)} • system ${formatNumber(data.overall.runtime.cpu.systemMs)}`)}
          ${summaryCard("Recent Errors", String(data.overall.recentErrorCount), `${data.overall.recentWarningCount} warnings in memory feed`)}
          ${summaryCard("Firestore", data.firestore.connected ? "Connected" : "Failed", data.firestore.errorMessage ?? "probe ok")}
        </div>
      </div>
    </div>
    <div class="page">
      <div class="content">
        <section class="panel">
          <div class="panel-head">
            <h2>Overall System Status</h2>
            ${statusBadge(data.overall.status)}
          </div>
          <div class="metrics-grid">
            ${miniMetric("Environment", data.overall.environment)}
            ${miniMetric("Node", data.overall.nodeVersion)}
            ${miniMetric("Timestamp", formatTimestamp(data.overall.timestamp))}
            ${miniMetric("Git Commit", data.overall.gitCommit ?? "not available yet")}
            ${miniMetric("Heap Total", formatBytes(data.overall.runtime.memory.heapTotalBytes))}
            ${miniMetric("Heap Used", formatBytes(data.overall.runtime.memory.heapUsedBytes))}
            ${miniMetric("External Memory", formatBytes(data.overall.runtime.memory.externalBytes))}
            ${miniMetric("Max RSS", `${formatNumber(data.overall.runtime.resourceUsage.maxRssKb)} KB`)}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Route Health Table</h2>
            <span class="muted">Live runtime metrics are bounded in memory and reset on process restart.</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Priority</th>
                  <th>Latency Budget</th>
                  <th>DB Read Budget</th>
                  <th>Payload Budget</th>
                  <th>P50 / P95 / P99</th>
                  <th>Requests</th>
                  <th>Failures</th>
                  <th>Budget Violations</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${routeRows}</tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Firebase / Firestore Health</h2>
            ${statusBadge(data.firestore.connected ? "healthy" : "critical")}
          </div>
          <div class="metrics-grid">
            ${miniMetric("Configured", data.firestore.configured ? "yes" : "no")}
            ${miniMetric("Admin Initialized", data.firestore.adminInitialized ? "yes" : "no")}
            ${miniMetric("Connected", data.firestore.connected ? "yes" : "no")}
            ${miniMetric("Last Check", data.firestore.lastCheckAt ? formatTimestamp(data.firestore.lastCheckAt) : "not available yet")}
            ${miniMetric("Probe Latency", data.firestore.latencyMs == null ? "not available yet" : `${data.firestore.latencyMs}ms`)}
            ${miniMetric("Error", data.firestore.errorMessage ?? "none")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Cache Health</h2>
            ${statusBadge(cacheStatus(data.cache))}
          </div>
          <div class="metrics-grid">
            ${miniMetric("Route Cache Hits", String(data.cache.routeCache.hits))}
            ${miniMetric("Route Cache Misses", String(data.cache.routeCache.misses))}
            ${miniMetric("Entity Cache Hits", String(data.cache.entityCache.hits))}
            ${miniMetric("Entity Cache Misses", String(data.cache.entityCache.misses))}
            ${miniMetric("Cache Sets", String(data.cache.storageOps.sets))}
            ${miniMetric("Cache Deletes", String(data.cache.storageOps.deletes))}
            ${miniMetric("Cache Provider", data.cache.store?.provider ?? "not available yet")}
            ${miniMetric("Cache Size", data.cache.store?.size == null ? "not available yet" : String(data.cache.store.size))}
          </div>
          <div class="muted" style="margin-top: 14px;">Recent invalidations: ${escapeHtml(
            data.cache.recentInvalidations
              .slice(0, 6)
              .map((entry) => `${entry.invalidationType} (${entry.keyCount} keys)`)
              .join(" • ") || "not available yet"
          )}</div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Backend Surface Health</h2>
            <span class="muted">Grouped by product surface for daily engineering monitoring.</span>
          </div>
          <div class="surface-grid">${surfaceCards}</div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Error / Warning Feed</h2>
            <span class="muted">Most recent in-memory warnings/errors captured from the backend logger path.</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Route</th>
                  <th>Request ID</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Stack</th>
                </tr>
              </thead>
              <tbody>${errorRows}</tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Expensive Route Detector</h2>
            <span class="muted">Fastest way to see what is hurting Backendv2 right now.</span>
          </div>
          <div class="config-grid">
            ${expensiveMiniList("Highest P95 Latency", data.expensiveRoutes.highestP95Latency, (row) => row.p95LatencyMs == null ? "not available yet" : `${row.p95LatencyMs}ms`)}
            ${expensiveMiniList("Highest Avg DB Reads", data.expensiveRoutes.highestAvgDbReads, (row) => row.avgDbReads == null ? "not available yet" : String(row.avgDbReads))}
            ${expensiveMiniList("Highest Payload Size", data.expensiveRoutes.highestPayload, (row) => row.avgPayloadBytes == null ? "not available yet" : formatBytes(row.avgPayloadBytes))}
            ${expensiveMiniList("Most Budget Violations", data.expensiveRoutes.mostBudgetViolations, (row) => String(row.budgetViolations))}
            ${expensiveMiniList("Highest Error Rate", data.expensiveRoutes.highestErrorRate, (row) => `${formatPercent(row.errorRate)}`)}
            <div class="mini-card">
              <div class="mini-label">Current Signals</div>
              <div class="muted">Routes with no traffic are shown as not available yet instead of guesswork.</div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Recent Requests Table</h2>
            <span class="muted">Last ${escapeHtml(String(data.recentRequests.length))} requests, bounded in memory only.</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Route Name</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>DB R/W/Q</th>
                  <th>Payload</th>
                  <th>Budget Violations</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>${requestRows}</tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Deployment / Config Checks</h2>
            ${statusBadge(data.config.warnings.length > 0 ? "degraded" : "healthy")}
          </div>
          <div class="config-grid">${configChecks}</div>
          <div style="margin-top: 14px;">
            <div class="mini-label">Production Safe Settings Warnings</div>
            <ul class="warning-list">
              ${(data.config.warnings.length > 0 ? data.config.warnings : ["No config warnings detected."])
                .map((warning) => `<li>${escapeHtml(warning)}</li>`)
                .join("")}
            </ul>
          </div>
        </section>
      </div>
    </div>
    <script>
      window.setTimeout(() => window.location.reload(), 10000);
    </script>
  </body>
</html>`;
  }
}

function toRouteDashboardRow(policy: RouteBudgetPolicy, metrics?: RouteRuntimeMetrics): RouteDashboardRow {
  const status = deriveRouteStatus(policy, metrics);
  return {
    routeName: policy.routeName,
    method: metrics?.method ?? null,
    path: metrics?.path ?? null,
    priority: policy.priority,
    latencyBudgetP95Ms: policy.budgets.latency.p95Ms,
    dbReadBudget: policy.budgets.dbOps.maxReadsCold,
    payloadBudgetBytes: policy.budgets.payload.maxBytes,
    p50LatencyMs: metrics?.p50LatencyMs ?? null,
    p95LatencyMs: metrics?.p95LatencyMs ?? null,
    p99LatencyMs: metrics?.p99LatencyMs ?? null,
    avgLatencyMs: metrics?.avgLatencyMs ?? null,
    requestCount: metrics?.requestCount ?? 0,
    recentFailures: metrics?.errorCount ?? 0,
    budgetViolations: metrics?.budgetViolationCount ?? 0,
    commonBudgetViolation: metrics?.commonBudgetViolation ?? null,
    status,
    statusReason: describeRouteStatus(policy, metrics, status),
    lastSeenAt: metrics?.lastSeenAt ?? null,
    avgDbReads: metrics?.avgDbReads ?? null,
    avgPayloadBytes: metrics?.avgPayloadBytes ?? null,
    errorRate: metrics?.errorRate ?? 0
  };
}

function buildSurfaceCards(routeHealth: RouteDashboardRow[]): SurfaceCard[] {
  return SURFACE_GROUPS.map((group) => {
    const routes = routeHealth.filter((row) => group.includes.some((prefix) => row.routeName.startsWith(prefix)));
    const requestCount = routes.reduce((sum, row) => sum + row.requestCount, 0);
    const failures = routes.reduce((sum, row) => sum + row.recentFailures, 0);
    const latencyRows = routes.filter((row) => row.avgLatencyMs != null);
    const avgLatencyMs =
      latencyRows.length > 0
        ? round(
            latencyRows.reduce((sum, row) => sum + (row.avgLatencyMs ?? 0) * Math.max(1, row.requestCount), 0) /
              latencyRows.reduce((sum, row) => sum + Math.max(1, row.requestCount), 0)
          )
        : null;
    const p95LatencyMs = latencyRows.length > 0 ? Math.max(...latencyRows.map((row) => row.p95LatencyMs ?? 0)) : null;
    const violationCounts = new Map<string, number>();
    for (const route of routes) {
      if (!route.commonBudgetViolation) continue;
      violationCounts.set(route.commonBudgetViolation, (violationCounts.get(route.commonBudgetViolation) ?? 0) + route.budgetViolations);
    }
    const commonBudgetViolation =
      [...violationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const status = routes.length === 0 ? "not_available" : routes.reduce<HealthStatus>((worst, route) => {
      return severityWeight(route.status) > severityWeight(worst) ? route.status : worst;
    }, "healthy");
    return {
      surface: group.surface,
      routeNames: routes.map((route) => route.routeName),
      requestCount,
      failures,
      avgLatencyMs,
      p95LatencyMs,
      commonBudgetViolation,
      status
    };
  });
}

function deriveRouteStatus(policy: RouteBudgetPolicy, metrics?: RouteRuntimeMetrics): HealthStatus {
  if (!metrics || metrics.requestCount === 0) return "not_available";
  if (metrics.errorRate >= 0.2 && metrics.requestCount >= 5) return "critical";
  if ((metrics.p95LatencyMs ?? 0) > policy.budgets.latency.p95Ms * 2) return "critical";
  if (metrics.budgetViolationRate >= 0.3 && metrics.requestCount >= 5) return "critical";
  if (metrics.errorCount > 0) return "degraded";
  if ((metrics.p95LatencyMs ?? 0) > policy.budgets.latency.p95Ms) return "degraded";
  if (metrics.budgetViolationCount > 0) return "degraded";
  return "healthy";
}

function describeRouteStatus(
  policy: RouteBudgetPolicy,
  metrics: RouteRuntimeMetrics | undefined,
  status: HealthStatus
): string {
  if (!metrics || metrics.requestCount === 0) return "not available yet";
  if (status === "critical" && metrics.errorRate >= 0.2) return "high server error rate";
  if (status === "critical" && (metrics.p95LatencyMs ?? 0) > policy.budgets.latency.p95Ms * 2) return "p95 latency far above budget";
  if (status === "critical") return "budget violation rate is critical";
  if (status === "degraded" && metrics.errorCount > 0) return "recent server errors observed";
  if (status === "degraded" && (metrics.p95LatencyMs ?? 0) > policy.budgets.latency.p95Ms) return "p95 latency above budget";
  if (status === "degraded") return "budget violations observed";
  return "operating within recorded budgets";
}

function deriveOverallStatus(
  routeHealth: RouteDashboardRow[],
  firestore: Awaited<ReturnType<typeof firestoreHealthService.getSnapshot>>,
  warnings: string[]
): HealthStatus {
  const worstRouteStatus = routeHealth.reduce<HealthStatus>((worst, route) => {
    return severityWeight(route.status) > severityWeight(worst) ? route.status : worst;
  }, "healthy");
  if (!firestore.connected && firestore.configured) return "critical";
  if (warnings.some((warning) => /production/i.test(warning))) return "critical";
  if (worstRouteStatus === "critical") return "critical";
  if (!firestore.connected || warnings.length > 0 || worstRouteStatus === "degraded") return "degraded";
  return "healthy";
}

function deriveDashboardWarnings(
  routeHealth: RouteDashboardRow[],
  firestore: Awaited<ReturnType<typeof firestoreHealthService.getSnapshot>>
): string[] {
  const warnings: string[] = [];
  const criticalRoutes = routeHealth.filter((route) => route.status === "critical").slice(0, 3);
  if (criticalRoutes.length > 0) {
    warnings.push(`Critical routes detected: ${criticalRoutes.map((route) => route.routeName).join(", ")}.`);
  }
  if (!firestore.connected && firestore.configured) {
    warnings.push(`Firestore probe failed: ${firestore.errorMessage ?? "unknown error"}.`);
  }
  return warnings;
}

function cacheStatus(cache: ReturnType<typeof cacheMetricsCollector.getSnapshot>): HealthStatus {
  if (cache.routeCache.hits + cache.routeCache.misses + cache.entityCache.hits + cache.entityCache.misses === 0) {
    return "not_available";
  }
  const routeMissesHigher = cache.routeCache.misses > cache.routeCache.hits * 2 && cache.routeCache.misses > 20;
  return routeMissesHigher ? "degraded" : "healthy";
}

function topRoutes(rows: RouteDashboardRow[], selector: (row: RouteDashboardRow) => number): RouteDashboardRow[] {
  return rows
    .filter((row) => row.requestCount > 0)
    .sort((left, right) => selector(right) - selector(left))
    .slice(0, 5);
}

function severityWeight(status: HealthStatus): number {
  if (status === "critical") return 4;
  if (status === "degraded") return 3;
  if (status === "not_available") return 2;
  return 1;
}

function resolveGitCommit(): string | null {
  return (
    process.env.SERVICE_GIT_COMMIT?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    process.env.SHORT_SHA?.trim() ||
    process.env.K_REVISION?.trim() ||
    null
  );
}

function buildDashboardHref(basePath: string, token: string | null): string {
  if (!token) return basePath;
  const url = new URL(`http://localhost${basePath}`);
  url.searchParams.set("token", token);
  return `${url.pathname}${url.search}`;
}

function statusBadge(status: HealthStatus, title?: string): string {
  const label =
    status === "healthy"
      ? "Healthy"
      : status === "degraded"
        ? "Degraded"
        : status === "critical"
          ? "Critical"
          : "Not available yet";
  return `<span class="badge ${status}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</span>`;
}

function summaryCard(title: string, value: string, sub: string): string {
  return `
    <div class="summary-card">
      <div class="summary-title">${escapeHtml(title)}</div>
      <div class="summary-value">${escapeHtml(value)}</div>
      <div class="summary-sub">${escapeHtml(sub)}</div>
    </div>`;
}

function miniMetric(label: string, value: string): string {
  return `
    <div class="mini-card">
      <div class="mini-label">${escapeHtml(label)}</div>
      <div class="mini-value">${escapeHtml(value)}</div>
    </div>`;
}

function expensiveMiniList(
  title: string,
  rows: RouteDashboardRow[],
  formatter: (row: RouteDashboardRow) => string
): string {
  return `
    <div class="mini-card">
      <div class="mini-label">${escapeHtml(title)}</div>
      ${rows.length > 0
        ? rows
            .map(
              (row) => `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:8px;">
                <span>${escapeHtml(row.routeName)}</span>
                <strong>${escapeHtml(formatter(row))}</strong>
              </div>`
            )
            .join("")
        : `<div class="muted">not available yet</div>`}
    </div>`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function formatMethodPath(method: string | null, path: string | null): string {
  if (!method && !path) return "not available yet";
  return `${method ?? "?"} ${path ?? "path not available yet"}`;
}

function formatLatencyTriple(p50: number | null, p95: number | null, p99: number | null): string {
  if (p50 == null && p95 == null && p99 == null) return "not available yet";
  return `${p50 ?? "n/a"} / ${p95 ?? "n/a"} / ${p99 ?? "n/a"} ms`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "not available yet";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024)} KB`;
  return `${round(bytes / (1024 * 1024))} MB`;
}

function formatPercent(value: number): string {
  return `${round(value * 100)}%`;
}

function formatNumber(value: number): string {
  return round(value).toLocaleString();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const healthDashboardService = new HealthDashboardService();
