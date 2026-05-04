import type { AppEnv } from "../../config/env.js";
import { listRoutePolicies, type RouteBudgetPolicy } from "../../observability/route-policies.js";
import { collectRuntimeHealth } from "../../observability/runtime-health.collector.js";
import { requestMetricsCollector, type RouteRuntimeMetrics } from "../../observability/request-metrics.collector.js";
import { errorRingBuffer } from "../../observability/error-ring-buffer.js";
import { firestoreHealthService } from "../../observability/firestore-health.service.js";
import { cacheMetricsCollector } from "../../observability/cache-metrics.collector.js";
import { getConfigHealthSnapshot } from "../../observability/config-health.service.js";
import { listInferredRouteIndex } from "../../runtime/infer-route-name.js";

type HealthStatus = "healthy" | "degraded" | "critical" | "not_available";
type SampleSizeStatus = "none" | "low" | "usable" | "strong";
type CoverageClassification =
  | "observed"
  | "not_observed_yet"
  | "mounted_but_no_recent_traffic"
  | "budgeted_but_unmounted"
  | "intentionally_inactive";

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
  sampleSizeStatus: SampleSizeStatus;
  coverageClassification: CoverageClassification;
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
    observedBudgetedRoutes: number;
    totalBudgetedRoutes: number;
    degradedBudgetedRoutes: number;
    criticalBudgetedRoutes: number;
    observedNonDashboardRequests: number;
    lastNonDashboardRequestAt: string | null;
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
  topErrorSignatures: Array<{
    signature: string;
    count: number;
    routeName: string | null;
    level: "warn" | "error";
  }>;
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
    const recentRequests = requestMetricsCollector.getRecentRequests(100);
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
    const nonDashboardRequests = recentRequests.filter((row) => !isDashboardRoute(row.routeName, row.route));
    const observedBudgetedRoutes = routeHealth.filter((row) => row.requestCount > 0).length;
    const degradedBudgetedRoutes = routeHealth.filter((row) => row.status === "degraded").length;
    const criticalBudgetedRoutes = routeHealth.filter((row) => row.status === "critical").length;
    const warnings = [
      ...(input.authWarning ? [input.authWarning] : []),
      ...config.warnings,
      ...deriveDashboardWarnings(routeHealth, firestore, nonDashboardRequests)
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
        recentWarningCount: errors.filter((entry) => entry.level === "warn").length,
        observedBudgetedRoutes,
        totalBudgetedRoutes: routeHealth.length,
        degradedBudgetedRoutes,
        criticalBudgetedRoutes,
        observedNonDashboardRequests: nonDashboardRequests.length,
        lastNonDashboardRequestAt: nonDashboardRequests[0]?.timestamp ?? null
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
      recentRequests,
      config,
      warnings
      ,
      topErrorSignatures: buildTopErrorSignatures(errors)
    };
  }

  renderHtml(data: HealthDashboardData, input: { token: string | null }): string {
    const jsonHref = buildDashboardHref("/internal/health-dashboard/data", input.token);
    const htmlHref = buildDashboardHref("/internal/health-dashboard", input.token);
    const recentNonDashboardRequests = data.recentRequests.filter((row) => !isDashboardRoute(row.routeName, row.route));
    const trafficSample = (recentNonDashboardRequests.length > 0 ? recentNonDashboardRequests : data.recentRequests).slice(0, 24);
    const routeStatusCounts = countRoutesByStatus(data.routeHealth);
    const liveChecks = buildLiveChecks(data);
    const hottestLatencyRoute = data.expensiveRoutes.highestP95Latency[0] ?? null;
    const highestErrorRoute = data.expensiveRoutes.highestErrorRate[0] ?? null;
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
    const warningBanners = data.warnings
      .map((warning) => `<div class="banner ${data.overall.status === "critical" ? "crit" : "warn"}">${escapeHtml(warning)}</div>`)
      .join("");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Locava Backendv2 Health Dashboard</title>
    <style>
      :root {
        --bg-top: #edf6fb;
        --bg-bottom: #f7fafc;
        --surface: rgba(255, 255, 255, 0.62);
        --surface-strong: rgba(255, 255, 255, 0.9);
        --surface-deep: rgba(11, 26, 43, 0.8);
        --line: rgba(144, 164, 174, 0.24);
        --line-strong: rgba(144, 164, 174, 0.36);
        --text: #0f1728;
        --muted: #5d6b7d;
        --healthy: #116a46;
        --healthy-bg: rgba(21, 183, 113, 0.12);
        --degraded: #996300;
        --degraded-bg: rgba(245, 158, 11, 0.16);
        --critical: #b42318;
        --critical-bg: rgba(239, 68, 68, 0.12);
        --na: #475467;
        --na-bg: rgba(113, 128, 150, 0.14);
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.12);
        --shadow: 0 30px 80px rgba(15, 23, 42, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 10% 10%, rgba(56, 189, 248, 0.22), transparent 20%),
          radial-gradient(circle at 85% 12%, rgba(110, 231, 183, 0.2), transparent 18%),
          radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.72), transparent 34%),
          linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 58%, #f4f6fb 100%);
      }
      a { color: #155eef; text-decoration: none; }
      .page-shell {
        position: relative;
        overflow: hidden;
      }
      .ambient {
        position: fixed;
        inset: auto;
        width: 340px;
        height: 340px;
        border-radius: 999px;
        filter: blur(70px);
        opacity: 0.5;
        pointer-events: none;
      }
      .ambient.a {
        top: -80px;
        left: -70px;
        background: rgba(56, 189, 248, 0.25);
      }
      .ambient.b {
        top: 120px;
        right: -90px;
        background: rgba(52, 211, 153, 0.22);
      }
      .page {
        position: relative;
        max-width: 1660px;
        margin: 0 auto;
        padding: 28px 24px 40px;
      }
      .glass, .panel, .surface-card, .mini-card, .summary-card {
        background: var(--surface);
        backdrop-filter: blur(22px);
        -webkit-backdrop-filter: blur(22px);
        border: 1px solid rgba(255, 255, 255, 0.52);
        box-shadow: var(--shadow);
      }
      .hero {
        padding: 28px;
        border-radius: 30px;
        margin-bottom: 18px;
      }
      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.8fr) minmax(320px, 0.95fr);
        gap: 18px;
        align-items: stretch;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.45);
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hero h1 {
        margin: 18px 0 10px;
        font-size: clamp(34px, 4.5vw, 56px);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      .hero-copy {
        max-width: 760px;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.65;
      }
      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 14px 0 0;
      }
      .hero-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.55);
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
      }
      .hero-rail {
        padding: 20px;
        border-radius: 26px;
        background: linear-gradient(180deg, rgba(10, 19, 34, 0.72), rgba(19, 35, 57, 0.9));
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 28px 60px rgba(15, 23, 42, 0.22);
      }
      .hero-rail h2 {
        margin: 0 0 10px;
        font-size: 20px;
      }
      .hero-rail .muted {
        color: rgba(226, 232, 240, 0.78);
      }
      .hero-status-stack {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }
      .status-line {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: center;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .status-line strong {
        font-size: 15px;
      }
      .summary-title {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .summary-value {
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.03em;
      }
      .summary-sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 18px;
      }
      .summary-card {
        padding: 18px;
        border-radius: 22px;
      }
      .banner {
        border-radius: 18px;
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
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 11px 16px;
        border-radius: 999px;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: white;
        font-weight: 700;
        box-shadow: 0 10px 24px rgba(37, 99, 235, 0.22);
      }
      .button.secondary {
        color: var(--text);
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(255, 255, 255, 0.65);
        box-shadow: none;
      }
      .content {
        display: grid;
        grid-template-columns: 1fr;
        gap: 18px;
      }
      .overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 0.95fr);
        gap: 14px;
        margin-bottom: 18px;
      }
      .panel {
        padding: 20px;
        overflow: hidden;
        border-radius: 24px;
      }
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
        border-radius: 18px;
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
        letter-spacing: -0.03em;
      }
      .mini-value.ok { color: var(--healthy); }
      .mini-value.bad { color: var(--critical); }
      .check-list {
        display: grid;
        gap: 10px;
      }
      .check-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 12px;
        align-items: start;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.55);
      }
      .check-dot {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        margin-top: 4px;
      }
      .check-dot.healthy { background: var(--healthy); box-shadow: 0 0 0 6px rgba(17, 106, 70, 0.11); }
      .check-dot.degraded { background: var(--degraded); box-shadow: 0 0 0 6px rgba(153, 99, 0, 0.12); }
      .check-dot.critical { background: var(--critical); box-shadow: 0 0 0 6px rgba(180, 35, 24, 0.12); }
      .check-dot.not_available { background: var(--na); box-shadow: 0 0 0 6px rgba(71, 84, 103, 0.1); }
      .meter {
        height: 14px;
        display: flex;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.06);
        margin: 12px 0 16px;
      }
      .meter span {
        height: 100%;
      }
      .meter .healthy { background: linear-gradient(90deg, #22c55e, #16a34a); }
      .meter .degraded { background: linear-gradient(90deg, #f59e0b, #d97706); }
      .meter .critical { background: linear-gradient(90deg, #ef4444, #dc2626); }
      .meter .not_available { background: linear-gradient(90deg, #cbd5e1, #94a3b8); }
      .legend-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }
      .legend-swatch {
        width: 11px;
        height: 11px;
        border-radius: 999px;
      }
      .pulse-grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 16px;
        align-items: end;
      }
      .bar-strip {
        display: grid;
        grid-template-columns: repeat(24, minmax(0, 1fr));
        gap: 6px;
        align-items: end;
        min-height: 168px;
        padding: 14px;
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.28));
        border: 1px solid rgba(255, 255, 255, 0.55);
      }
      .bar-col {
        display: flex;
        flex-direction: column;
        justify-content: end;
        gap: 6px;
        min-height: 140px;
      }
      .bar {
        width: 100%;
        min-height: 8px;
        border-radius: 999px;
        opacity: 0.98;
      }
      .bar.healthy { background: linear-gradient(180deg, rgba(34, 197, 94, 0.55), rgba(22, 163, 74, 0.95)); }
      .bar.degraded { background: linear-gradient(180deg, rgba(245, 158, 11, 0.5), rgba(217, 119, 6, 0.95)); }
      .bar.critical { background: linear-gradient(180deg, rgba(248, 113, 113, 0.55), rgba(220, 38, 38, 0.95)); }
      .bar.not_available { background: linear-gradient(180deg, rgba(148, 163, 184, 0.5), rgba(100, 116, 139, 0.95)); }
      .bar-label {
        color: var(--muted);
        font-size: 11px;
        text-align: center;
      }
      .callout-stack {
        display: grid;
        gap: 10px;
      }
      .callout {
        padding: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.55);
      }
      .callout strong {
        display: block;
        margin-bottom: 4px;
        font-size: 15px;
      }
      .table-wrap {
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--line-strong);
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
        background: #f8fafc;
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
        background: rgba(37, 99, 235, 0.1);
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
        .hero-grid,
        .summary-grid,
        .overview-grid,
        .pulse-grid,
        .metrics-grid,
        .config-grid,
        .surface-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .summary-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .overview-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 840px) {
        .page { padding: 14px; }
        .hero,
        .summary-grid,
        .hero-grid,
        .overview-grid,
        .pulse-grid,
        .metrics-grid,
        .config-grid,
        .surface-grid {
          grid-template-columns: 1fr;
        }
        .legend-grid {
          grid-template-columns: 1fr;
        }
        .bar-strip {
          grid-template-columns: repeat(12, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <div class="page-shell">
      <div class="ambient a"></div>
      <div class="ambient b"></div>
      <div class="page">
        ${warningBanners}
        <section class="hero glass">
          <div class="hero-grid">
            <div>
              <div class="eyebrow">Operational Health Console</div>
              <h1>Locava Backendv2</h1>
              <div class="hero-copy">
                One place to see if the backend is actually healthy: runtime pressure, live route behavior, Firestore reachability,
                expensive endpoints, and whether the data is still warming up instead of pretending it knows more than it does.
              </div>
              <div class="hero-meta">
                <span class="hero-pill">${escapeHtml(data.overall.environment)}</span>
                <span class="hero-pill">Version ${escapeHtml(data.overall.serviceVersion)}</span>
                <span class="hero-pill">${escapeHtml(data.overall.gitCommit ? `Commit ${data.overall.gitCommit}` : "Commit not available yet")}</span>
                <span class="hero-pill">Last refreshed ${escapeHtml(formatTimestamp(data.refreshedAt))}</span>
              </div>
              <div class="hero-actions">
                <a class="button" href="${escapeHtml(htmlHref)}">Run Checks Now</a>
                <a class="button secondary" href="${escapeHtml(jsonHref)}">Open JSON Data</a>
                <span class="hero-pill">Auto-refresh every 10 seconds</span>
              </div>
            </div>
            <aside class="hero-rail">
              <div class="summary-title" style="color: rgba(226, 232, 240, 0.72);">Current Readiness</div>
              <h2>${statusBadge(data.overall.status)} <span style="font-weight: 800; margin-left: 8px;">${escapeHtml(data.overall.status === "critical" ? "Critical" : data.overall.status === "degraded" ? "Degraded" : data.overall.status === "healthy" ? "Healthy" : "Warming up")}</span></h2>
              <div class="muted">Checks rerun on refresh using live process state, route metrics, cache counters, and Firestore probe results.</div>
              <div class="hero-status-stack">
                <div class="status-line">
                  <div>
                    <strong>${escapeHtml(`${data.overall.observedBudgetedRoutes}/${data.overall.totalBudgetedRoutes}`)}</strong>
                    <div class="muted">budgeted routes with real traffic observed</div>
                  </div>
                  ${statusBadge(data.overall.observedBudgetedRoutes > 0 ? "healthy" : "not_available")}
                </div>
                <div class="status-line">
                  <div>
                    <strong>${escapeHtml(data.firestore.connected ? "Firestore responding" : "Firestore failing")}</strong>
                    <div class="muted">${escapeHtml(data.firestore.errorMessage ?? `probe latency ${data.firestore.latencyMs ?? "n/a"}ms`)}</div>
                  </div>
                  ${statusBadge(data.firestore.connected ? "healthy" : "critical")}
                </div>
                <div class="status-line">
                  <div>
                    <strong>${escapeHtml(`${data.overall.recentErrorCount} recent errors`)}</strong>
                    <div class="muted">${escapeHtml(`${data.overall.recentWarningCount} warnings in in-memory feed`)}</div>
                  </div>
                  ${statusBadge(data.overall.recentErrorCount > 0 ? "degraded" : "healthy")}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section class="summary-grid">
          ${summaryCard("Uptime", `${formatNumber(data.overall.uptimeSec)}s`, `PID ${data.overall.runtime.pid}`)}
          ${summaryCard("Observed Routes", `${data.overall.observedBudgetedRoutes}/${data.overall.totalBudgetedRoutes}`, `${data.overall.degradedBudgetedRoutes} degraded • ${data.overall.criticalBudgetedRoutes} critical`)}
          ${summaryCard("Recent Traffic", String(data.overall.observedNonDashboardRequests), data.overall.lastNonDashboardRequestAt ? `last app request ${formatTimestamp(data.overall.lastNonDashboardRequestAt)}` : "no non-dashboard traffic observed yet")}
          ${summaryCard("RSS Memory", formatBytes(data.overall.runtime.memory.rssBytes), `Heap used ${formatBytes(data.overall.runtime.memory.heapUsedBytes)}`)}
          ${summaryCard("CPU Time", `${formatNumber(data.overall.runtime.cpu.userMs + data.overall.runtime.cpu.systemMs)}ms`, `user ${formatNumber(data.overall.runtime.cpu.userMs)} • system ${formatNumber(data.overall.runtime.cpu.systemMs)}`)}
          ${summaryCard("Firestore", data.firestore.connected ? "Connected" : "Failed", data.firestore.errorMessage ?? "probe ok")}
        </section>

        <section class="overview-grid">
          <section class="panel">
            <div class="panel-head">
              <h2>Live Checks</h2>
              <span class="muted">Fast sanity checks rerun with each refresh.</span>
            </div>
            <div class="check-list">${liveChecks}</div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Traffic & Latency Pulse</h2>
              <span class="muted">${escapeHtml(trafficSample.length > 0 ? `Latest ${trafficSample.length} requests` : "Waiting for request traffic")}</span>
            </div>
            <div class="pulse-grid">
              ${buildRequestPulseChart(trafficSample)}
              <div class="callout-stack">
                <div class="callout">
                  <strong>${escapeHtml(formatNumber(recentNonDashboardRequests.length))}</strong>
                  <div class="muted">non-dashboard requests seen in the rolling request buffer</div>
                </div>
                <div class="callout">
                  <strong>${escapeHtml(hottestLatencyRoute ? `${hottestLatencyRoute.routeName} @ ${hottestLatencyRoute.p95LatencyMs ?? "n/a"}ms` : "No hot route yet")}</strong>
                  <div class="muted">highest recorded p95 latency right now</div>
                </div>
                <div class="callout">
                  <strong>${escapeHtml(highestErrorRoute ? `${highestErrorRoute.routeName} @ ${formatPercent(highestErrorRoute.errorRate)}` : "No elevated error route yet")}</strong>
                  <div class="muted">highest current route error rate in observed traffic</div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Coverage & Risk</h2>
              <span class="muted">Budgeted route coverage from this process only.</span>
            </div>
            ${buildRouteCoverageMeter(routeStatusCounts, data.routeHealth.length)}
            <div class="legend-grid">
              ${coverageLegendItem("Healthy", routeStatusCounts.healthy, "healthy")}
              ${coverageLegendItem("Degraded", routeStatusCounts.degraded, "degraded")}
              ${coverageLegendItem("Critical", routeStatusCounts.critical, "critical")}
              ${coverageLegendItem("Warming Up", routeStatusCounts.not_available, "not_available")}
            </div>
            <div class="callout-stack" style="margin-top: 14px;">
              <div class="callout">
                <strong>${escapeHtml(`${Math.round((data.overall.observedBudgetedRoutes / Math.max(1, data.overall.totalBudgetedRoutes)) * 100)}% route coverage`)}</strong>
                <div class="muted">routes with at least one live request since this process started</div>
              </div>
              <div class="callout">
                <strong>${escapeHtml(data.cache.store?.provider ?? "no cache provider reported")}</strong>
                <div class="muted">${escapeHtml(data.cache.store?.size == null ? "cache size not available yet" : `cache size ${data.cache.store.size}`)}</div>
              </div>
            </div>
          </section>
        </section>

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
            ${miniMetric("Observed Budgeted Routes", `${data.overall.observedBudgetedRoutes}/${data.overall.totalBudgetedRoutes}`)}
            ${miniMetric("Recent Non-Dashboard Requests", String(data.overall.observedNonDashboardRequests))}
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
  const sampleSizeStatus = deriveSampleSizeStatus(metrics?.requestCount ?? 0);
  const inferredMountedNames = getInferredMountedRouteNames();
  const coverageClassification = deriveCoverageClassification(metrics?.requestCount ?? 0, inferredMountedNames.has(policy.routeName));
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
    errorRate: metrics?.errorRate ?? 0,
    sampleSizeStatus,
    coverageClassification
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
  const sampleSizeStatus = deriveSampleSizeStatus(metrics.requestCount);
  const sampleUsable = sampleSizeStatus === "usable" || sampleSizeStatus === "strong";
  if (metrics.errorRate >= 0.2 && sampleUsable) return "critical";
  if ((metrics.p95LatencyMs ?? 0) > policy.budgets.latency.p95Ms * 2 && sampleUsable) return "critical";
  if (metrics.budgetViolationRate >= 0.3 && sampleUsable) return "critical";
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
  if (deriveSampleSizeStatus(metrics.requestCount) === "low") return "sample too small";
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
  const significantRouteRows = routeHealth.filter(
    (route) => route.sampleSizeStatus === "usable" || route.sampleSizeStatus === "strong"
  );
  const worstRouteStatus = significantRouteRows.reduce<HealthStatus>((worst, route) => {
    return severityWeight(route.status) > severityWeight(worst) ? route.status : worst;
  }, "healthy");
  const hasCriticalFailureOnCriticalRoute = routeHealth.some(
    (route) => route.priority === "critical_interactive" && route.recentFailures > 0
  );
  if (!firestore.connected && firestore.configured) return "critical";
  if (warnings.some((warning) => isCriticalWarning(warning))) return "critical";
  if (hasCriticalFailureOnCriticalRoute) return "critical";
  if (worstRouteStatus === "critical") return "critical";
  if (!firestore.connected || warnings.some((warning) => isDegradedWarning(warning)) || worstRouteStatus === "degraded") return "degraded";
  return "healthy";
}

function deriveDashboardWarnings(
  routeHealth: RouteDashboardRow[],
  firestore: Awaited<ReturnType<typeof firestoreHealthService.getSnapshot>>,
  nonDashboardRequests: ReturnType<typeof requestMetricsCollector.getRecentRequests>
): string[] {
  const warnings: string[] = [];
  const criticalRoutes = routeHealth.filter((route) => route.status === "critical").slice(0, 3);
  if (criticalRoutes.length > 0) {
    warnings.push(`Critical routes detected: ${criticalRoutes.map((route) => route.routeName).join(", ")}.`);
  }
  if (!firestore.connected && firestore.configured) {
    warnings.push(`Firestore probe failed: ${firestore.errorMessage ?? "unknown error"}.`);
  }
  if (nonDashboardRequests.length === 0) {
    warnings.push("No non-dashboard backend traffic has been observed yet, so most route health rows are still warming up.");
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

function deriveSampleSizeStatus(requestCount: number): SampleSizeStatus {
  if (requestCount <= 0) return "none";
  if (requestCount < 5) return "low";
  if (requestCount < 20) return "usable";
  return "strong";
}

function deriveCoverageClassification(requestCount: number, mounted: boolean): CoverageClassification {
  if (requestCount > 0) return "observed";
  return mounted ? "mounted_but_no_recent_traffic" : "budgeted_but_unmounted";
}

function getInferredMountedRouteNames(): Set<string> {
  return new Set(listInferredRouteIndex().map((row) => row.routeName));
}

function buildTopErrorSignatures(
  errors: ReturnType<typeof errorRingBuffer.getRecent>
): Array<{ signature: string; count: number; routeName: string | null; level: "warn" | "error" }> {
  const grouped = new Map<string, { signature: string; count: number; routeName: string | null; level: "warn" | "error" }>();
  for (const row of errors) {
    const messageKey = row.message.split("\n")[0]?.slice(0, 180) ?? "unknown";
    const stackKey = row.stack?.split("\n")[0]?.slice(0, 180) ?? "no_stack";
    const signature = `${messageKey} :: ${stackKey}`;
    const key = `${row.level}|${row.routeName ?? "unknown"}|${signature}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      signature,
      count: 1,
      routeName: row.routeName,
      level: row.level
    });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

function isCriticalWarning(warning: string): boolean {
  const normalized = warning.toLowerCase();
  return (
    normalized.includes("production is missing internal_dashboard_token") ||
    normalized.includes("missing internal_dashboard_token in production") ||
    normalized.includes("proxying to itself")
  );
}

function isDegradedWarning(warning: string): boolean {
  const normalized = warning.toLowerCase();
  if (isCriticalWarning(warning)) return true;
  if (normalized.includes("no non-dashboard backend traffic has been observed yet")) return false;
  if (normalized.includes("single-instance process-local mode confirmed")) return false;
  if (normalized.includes("enable_public_firestore_probe is enabled")) return false;
  return (
    normalized.includes("allow_public_posting_test is enabled") ||
    normalized.includes("enable_local_dev_identity is enabled") ||
    normalized.includes("firestore_source_enabled is disabled") ||
    normalized.includes("enable_legacy_compat_routes is enabled") ||
    normalized.includes("process-local cache/dedupe/lock/invalidation assumptions remain") ||
    normalized.includes("redis coherence mode is enabled without redis_url") ||
    normalized.includes("external coordinator stub mode does not provide")
  );
}

function isDashboardRoute(routeName: string | undefined, routePath: string): boolean {
  if (routeName?.startsWith("internal.health_dashboard.")) return true;
  return routePath.startsWith("/internal/health-dashboard");
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

function countRoutesByStatus(routeHealth: RouteDashboardRow[]): Record<HealthStatus, number> {
  return routeHealth.reduce<Record<HealthStatus, number>>(
    (counts, row) => {
      counts[row.status] += 1;
      return counts;
    },
    {
      healthy: 0,
      degraded: 0,
      critical: 0,
      not_available: 0
    }
  );
}

function buildLiveChecks(data: HealthDashboardData): string {
  const routeCoverage = data.overall.totalBudgetedRoutes === 0 ? 0 : data.overall.observedBudgetedRoutes / data.overall.totalBudgetedRoutes;
  const checks: Array<{ label: string; detail: string; status: HealthStatus }> = [
    {
      label: "Dashboard access control",
      detail: data.auth.tokenProtected
        ? "INTERNAL_DASHBOARD_TOKEN is set and the dashboard requires it."
        : data.auth.localMode
          ? "Local mode is open because no token is configured."
          : "Production token is missing.",
      status: data.auth.tokenProtected ? "healthy" : data.auth.localMode ? "degraded" : "critical"
    },
    {
      label: "Firestore probe",
      detail: data.firestore.connected
        ? `Read probe succeeded in ${data.firestore.latencyMs ?? "n/a"}ms.`
        : data.firestore.errorMessage ?? "Firestore probe failed.",
      status: data.firestore.connected ? "healthy" : data.firestore.configured ? "critical" : "degraded"
    },
    {
      label: "Runtime request capture",
      detail:
        data.recentRequests.length > 0
          ? `${data.recentRequests.length} recent requests are available in memory.`
          : "No recent requests captured yet.",
      status: data.recentRequests.length > 0 ? "healthy" : "not_available"
    },
    {
      label: "Route coverage warmup",
      detail: `${data.overall.observedBudgetedRoutes}/${data.overall.totalBudgetedRoutes} budgeted routes have seen traffic in this process.`,
      status: routeCoverage >= 0.5 ? "healthy" : routeCoverage > 0 ? "degraded" : "not_available"
    },
    {
      label: "Recent error feed",
      detail:
        data.overall.recentErrorCount > 0
          ? `${data.overall.recentErrorCount} recent errors are buffered for inspection.`
          : "No recent errors captured in memory.",
      status: data.overall.recentErrorCount > 0 ? "degraded" : "healthy"
    },
    {
      label: "Deployment config sanity",
      detail:
        data.config.warnings.length > 0
          ? data.config.warnings[0] ?? "Config warnings were detected."
          : "Critical config checks passed without warnings.",
      status: data.config.warnings.length > 0 ? "degraded" : "healthy"
    }
  ];

  return checks
    .map(
      (check) => `
        <div class="check-row">
          <span class="check-dot ${check.status}"></span>
          <div>
            <div class="strong">${escapeHtml(check.label)}</div>
            <div class="muted">${escapeHtml(check.detail)}</div>
          </div>
          ${statusBadge(check.status)}
        </div>`
    )
    .join("");
}

function buildRequestPulseChart(
  requests: ReturnType<typeof requestMetricsCollector.getRecentRequests>
): string {
  if (requests.length === 0) {
    return `
      <div class="bar-strip">
        <div class="muted" style="grid-column: 1 / -1; align-self: center; text-align: center;">
          No request traffic has been captured yet.
        </div>
      </div>`;
  }

  const sample = [...requests].reverse();
  const maxLatency = Math.max(...sample.map((row) => row.latencyMs), 1);
  const bars = sample
    .map((row) => {
      const height = Math.max(8, Math.round((row.latencyMs / maxLatency) * 100));
      const status =
        row.statusCode >= 500 ? "critical" : row.statusCode >= 400 ? "degraded" : isDashboardRoute(row.routeName, row.route) ? "not_available" : "healthy";
      const shortLabel = row.method.slice(0, 3).toUpperCase();
      const title = `${formatTimestamp(row.timestamp)} • ${row.method} ${row.route} • ${row.latencyMs}ms • ${row.statusCode}`;
      return `
        <div class="bar-col" title="${escapeHtml(title)}">
          <div class="bar ${status}" style="height:${height}%"></div>
          <span class="bar-label">${escapeHtml(shortLabel)}</span>
        </div>`;
    })
    .join("");

  return `<div class="bar-strip">${bars}</div>`;
}

function buildRouteCoverageMeter(
  counts: Record<HealthStatus, number>,
  total: number
): string {
  const safeTotal = Math.max(1, total);
  const segment = (status: HealthStatus) => `width:${(counts[status] / safeTotal) * 100}%`;
  return `
    <div class="meter" title="${escapeHtml(`${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.critical} critical, ${counts.not_available} warming up`)}}">
      <span class="healthy" style="${segment("healthy")}"></span>
      <span class="degraded" style="${segment("degraded")}"></span>
      <span class="critical" style="${segment("critical")}"></span>
      <span class="not_available" style="${segment("not_available")}"></span>
    </div>`;
}

function coverageLegendItem(label: string, count: number, tone: HealthStatus): string {
  return `
    <div class="legend-item">
      <span class="legend-swatch ${tone}" style="background:${tone === "healthy" ? "#16a34a" : tone === "degraded" ? "#f59e0b" : tone === "critical" ? "#dc2626" : "#94a3b8"}"></span>
      <span>${escapeHtml(label)} <strong>${escapeHtml(String(count))}</strong></span>
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
