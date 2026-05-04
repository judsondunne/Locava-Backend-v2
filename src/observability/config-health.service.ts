import type { AppEnv } from "../config/env.js";
import { legacyProxyLoopsToBackendTargets } from "../lib/firebase-identity-toolkit.js";
import { readWasabiConfigFromEnv } from "../services/storage/wasabi-config.js";
import { BigQueryAnalyticsPublisher } from "../repositories/analytics/analytics-publisher.js";
import { getCoherenceStatus } from "../runtime/coherence.js";
import { resolveVideoProcessingCloudTasksConfig } from "../services/posting/video-processing-cloud-tasks.diagnostics.js";

export type ConfigHealthCheck = {
  key: string;
  label: string;
  configured: boolean;
  detail: string;
};

export type ConfigHealthSnapshot = {
  checks: ConfigHealthCheck[];
  warnings: string[];
};

export function getConfigHealthSnapshot(env: AppEnv): ConfigHealthSnapshot {
  const firebaseConfigured = Boolean(
    env.FIREBASE_PROJECT_ID ||
      env.GCP_PROJECT_ID ||
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  const wasabiConfigured = readWasabiConfigFromEnv() !== null;
  const analyticsConfigured = new BigQueryAnalyticsPublisher(env).getDestination().enabled;
  const pushConfigured = firebaseConfigured && env.FIRESTORE_SOURCE_ENABLED;
  const videoTasks = resolveVideoProcessingCloudTasksConfig();
  const videoWorkerConfigured = Boolean(videoTasks.workerTargetUrl);

  const checks: ConfigHealthCheck[] = [
    {
      key: "firebase",
      label: "Firebase project configured",
      configured: firebaseConfigured,
      detail: firebaseConfigured ? "Admin/runtime project settings are present." : "Missing Firebase project/runtime credentials."
    },
    {
      key: "wasabi",
      label: "Wasabi/S3 configured",
      configured: wasabiConfigured,
      detail: wasabiConfigured ? "S3-compatible storage credentials are present." : "Missing Wasabi/S3 storage credentials."
    },
    {
      key: "legacy_monolith_proxy",
      label: "Legacy monolith proxy configured",
      configured: Boolean(env.LEGACY_MONOLITH_PROXY_BASE_URL),
      detail: env.LEGACY_MONOLITH_PROXY_BASE_URL
        ? "Legacy proxy base URL is configured."
        : "Legacy monolith proxy is not configured."
    },
    {
      key: "analytics",
      label: "Analytics configured",
      configured: analyticsConfigured,
      detail: analyticsConfigured
        ? "Analytics publisher destination is configured."
        : "Analytics publisher destination is incomplete or disabled."
    },
    {
      key: "push_notifications",
      label: "Push notifications configured",
      configured: pushConfigured,
      detail: pushConfigured
        ? "Firestore-backed push delivery prerequisites are present."
        : "Push delivery depends on Firebase/Firestore runtime configuration."
    },
    {
      key: "dashboard_token",
      label: "Dashboard token configured",
      configured: Boolean(env.INTERNAL_DASHBOARD_TOKEN),
      detail: env.INTERNAL_DASHBOARD_TOKEN
        ? "Dashboard token protection is enabled."
        : env.NODE_ENV === "production"
          ? "Missing INTERNAL_DASHBOARD_TOKEN in production."
          : "Local mode currently allows dashboard access without a token."
    },
    {
      key: "video_cloud_tasks",
      label: "Video processing Cloud Tasks (resolved)",
      configured: Boolean(videoTasks.gcpProjectId && videoWorkerConfigured),
      detail: videoTasks.gcpProjectId
        ? `Queue ${videoTasks.queueName} @ ${videoTasks.cloudTasksLocation}; worker ${videoTasks.workerUrlSource}; ` +
          `VIDEO_PROCESSOR_FUNCTION_URL ${env.VIDEO_PROCESSOR_FUNCTION_URL ? "set" : "unset (default CF URL if project known)"}.`
        : "GCP project id missing — cannot resolve Cloud Tasks worker URL defaults."
    }
  ];

  const warnings: string[] = [];
  if (env.NODE_ENV === "production" && !env.INTERNAL_DASHBOARD_TOKEN) {
    warnings.push("Production is missing INTERNAL_DASHBOARD_TOKEN.");
  }
  if (env.NODE_ENV === "production" && env.ALLOW_PUBLIC_POSTING_TEST) {
    warnings.push("ALLOW_PUBLIC_POSTING_TEST is enabled in production.");
  }
  if (env.ENABLE_PUBLIC_FIRESTORE_PROBE) {
    warnings.push("ENABLE_PUBLIC_FIRESTORE_PROBE is enabled.");
  }
  if (env.ENABLE_LOCAL_DEV_IDENTITY === "1") {
    warnings.push("ENABLE_LOCAL_DEV_IDENTITY is enabled.");
  }
  if (!env.FIRESTORE_SOURCE_ENABLED) {
    warnings.push("FIRESTORE_SOURCE_ENABLED is disabled.");
  }
  if (env.ENABLE_LEGACY_COMPAT_ROUTES) {
    warnings.push("ENABLE_LEGACY_COMPAT_ROUTES is enabled.");
  }
  const coherence = getCoherenceStatus(env);
  if (coherence.warning) {
    warnings.push(coherence.warning);
  } else if (coherence.processLocalOnly && coherence.singleInstanceConfirmed) {
    warnings.push("Single-instance process-local mode confirmed (Cloud Run max instances = 1).");
  }
  const proxyCollide = legacyProxyLoopsToBackendTargets({
    legacyBaseUrl: env.LEGACY_MONOLITH_PROXY_BASE_URL,
    backendPublicUrls: [env.BACKEND_PUBLIC_BASE_URL]
  });
  if (proxyCollide) {
    warnings.push(
      `LEGACY_MONOLITH_PROXY_BASE_URL resolves to the same origin as BACKEND_PUBLIC_BASE_URL (${proxyCollide}); risk of Backendv2 proxying to itself.`
    );
  }

  return { checks, warnings };
}
