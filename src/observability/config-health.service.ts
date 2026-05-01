import type { AppEnv } from "../config/env.js";
import { readWasabiConfigFromEnv } from "../services/storage/wasabi-config.js";
import { BigQueryAnalyticsPublisher } from "../repositories/analytics/analytics-publisher.js";
import { getCoherenceStatus } from "../runtime/coherence.js";

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
          ? "Dashboard is public because INTERNAL_DASHBOARD_TOKEN is not set."
          : "Dashboard access is open because INTERNAL_DASHBOARD_TOKEN is not set."
    }
  ];

  const warnings: string[] = [];
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
  }

  return { checks, warnings };
}
