import { z } from "zod";
import { validateRouteRegistry } from "../src/observability/route-registry.validation.js";
import { createApp } from "../src/app/createApp.js";

const RouteRowSchema = z.object({
  routeName: z.string(),
  priority: z.string(),
  requestCount: z.number().int().nonnegative(),
  recentFailures: z.number().int().nonnegative(),
  p95LatencyMs: z.number().nullable(),
  avgDbReads: z.number().nullable(),
  avgPayloadBytes: z.number().nullable(),
  status: z.enum(["healthy", "degraded", "critical", "not_available"]),
  commonBudgetViolation: z.string().nullable().optional()
});

const HealthDataSchema = z.object({
  overall: z.object({
    status: z.string(),
    observedBudgetedRoutes: z.number().int().nonnegative(),
    totalBudgetedRoutes: z.number().int().nonnegative()
  }),
  routeHealth: z.array(RouteRowSchema),
  firestore: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nullable(),
    errorMessage: z.string().nullable()
  }),
  errors: z.array(z.object({ level: z.string(), message: z.string() })),
  warnings: z.array(z.string()),
  expensiveRoutes: z.object({
    highestP95Latency: z.array(RouteRowSchema),
    highestAvgDbReads: z.array(RouteRowSchema),
    highestPayload: z.array(RouteRowSchema)
  })
});

const EnvelopeSchema = z.object({
  ok: z.literal(true),
  data: HealthDataSchema
});

async function main(): Promise<void> {
  const mode = process.env.HEALTH_AUDIT_MODE?.trim() === "inject" ? "inject" : "http";
  const baseUrl = (process.env.HEALTH_AUDIT_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const token = process.env.INTERNAL_DASHBOARD_TOKEN?.trim();
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  const htmlUrl = `${baseUrl}/internal/health-dashboard${tokenQuery}`;
  const jsonUrl = `${baseUrl}/internal/health-dashboard/data${tokenQuery}`;

  let payload: unknown;
  if (mode === "inject") {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", INTERNAL_DASHBOARD_TOKEN: token || undefined });
    try {
      const html = await app.inject({
        method: "GET",
        url: "/internal/health-dashboard",
        headers: token ? { "x-internal-dashboard-token": token } : undefined
      });
      if (html.statusCode !== 200) {
        throw new Error(`dashboard_endpoint_failed:${html.statusCode}`);
      }
      const json = await app.inject({
        method: "GET",
        url: "/internal/health-dashboard/data",
        headers: token ? { "x-internal-dashboard-token": token } : undefined
      });
      if (json.statusCode !== 200) {
        throw new Error(`dashboard_data_endpoint_failed:${json.statusCode}`);
      }
      payload = json.json();
    } finally {
      await app.close();
    }
  } else {
    const htmlResponse = await fetch(htmlUrl, token ? { headers: { "x-internal-dashboard-token": token } } : undefined);
    if (!htmlResponse.ok) {
      throw new Error(`dashboard_endpoint_failed:${htmlResponse.status}`);
    }
    const response = await fetch(jsonUrl, token ? { headers: { "x-internal-dashboard-token": token } } : undefined);
    payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`dashboard_data_endpoint_failed:${response.status}`);
    }
  }
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`health_json_malformed:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  const data = parsed.data.data;
  if (!data.firestore.connected) {
    throw new Error(`firestore_probe_failed:${data.firestore.errorMessage ?? "unknown"}`);
  }

  const registryValidation = validateRouteRegistry();
  if (registryValidation.duplicateRouteNames.length > 0) {
    throw new Error(`duplicate_route_names:${registryValidation.duplicateRouteNames.join(",")}`);
  }
  if (registryValidation.duplicateMethodPathWithDifferentNames.length > 0) {
    throw new Error("duplicate_method_path_mappings_detected");
  }

  const impossibleMetric = data.routeHealth.find(
    (row) =>
      row.requestCount < 0 ||
      row.recentFailures < 0 ||
      (row.p95LatencyMs != null && row.p95LatencyMs < 0) ||
      (row.avgDbReads != null && row.avgDbReads < 0) ||
      (row.avgPayloadBytes != null && row.avgPayloadBytes < 0)
  );
  if (impossibleMetric) {
    throw new Error(`impossible_metrics:${impossibleMetric.routeName}`);
  }

  const criticalFailures = data.routeHealth.filter(
    (row) => row.priority === "critical_interactive" && row.recentFailures > 0
  );
  if (criticalFailures.length > 0) {
    throw new Error(`critical_route_failures:${criticalFailures.map((row) => row.routeName).join(",")}`);
  }

  const criticalRoutes = data.routeHealth.filter((row) => row.status === "critical").map((row) => row.routeName);
  const degradedRoutes = data.routeHealth.filter((row) => row.status === "degraded").map((row) => row.routeName);
  const recentErrors = data.errors.filter((row) => row.level === "error").slice(0, 10).map((row) => row.message);
  const recentWarnings = data.warnings.slice(0, 10);

  console.log(`overallStatus=${data.overall.status}`);
  console.log(`routeCoverage=${data.overall.observedBudgetedRoutes}/${data.overall.totalBudgetedRoutes}`);
  console.log(`firestoreProbeLatencyMs=${data.firestore.latencyMs ?? "n/a"}`);
  console.log(`criticalRoutes=${criticalRoutes.join(",") || "none"}`);
  console.log(`degradedRoutes=${degradedRoutes.join(",") || "none"}`);
  console.log(`recentErrors=${recentErrors.join(" | ") || "none"}`);
  console.log(`recentWarnings=${recentWarnings.join(" | ") || "none"}`);
  console.log(
    `topP95Latency=${data.expensiveRoutes.highestP95Latency
      .slice(0, 5)
      .map((row) => `${row.routeName}:${row.p95LatencyMs ?? "n/a"}ms`)
      .join(",") || "none"}`
  );
  console.log(
    `topAvgDbReads=${data.expensiveRoutes.highestAvgDbReads
      .slice(0, 5)
      .map((row) => `${row.routeName}:${row.avgDbReads ?? "n/a"}`)
      .join(",") || "none"}`
  );
  console.log(
    `topPayload=${data.expensiveRoutes.highestPayload
      .slice(0, 5)
      .map((row) => `${row.routeName}:${row.avgPayloadBytes ?? "n/a"}`)
      .join(",") || "none"}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
