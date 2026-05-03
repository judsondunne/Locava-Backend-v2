import { BigQuery, type Table } from "@google-cloud/bigquery";
import type { AppEnv } from "../../config/env.js";

export type AnalyticsRow = {
  event: string;
  schemaVersion: string | null;
  userId: string | null;
  anonId: string | null;
  sessionId: string | null;
  clientTime: Date | null;
  receivedAt: Date;
  platform: string | null;
  requestIp: string | null;
  userAgent: string | null;
  properties: string | null;
};

export type AnalyticsPublisherDestination = {
  enabled: boolean;
  projectId: string | null;
  dataset: string | null;
  table: string | null;
};

export type AnalyticsBigQueryRuntimeConfig = {
  enabled: boolean;
  projectId: string | null;
  dataset: string | null;
  table: string | null;
  credentialSource: "google_application_credentials" | "firebase_env_credentials" | "adc_default";
  serviceAccountEmail: string | null;
  nonBlockingFailures: boolean;
};

export interface AnalyticsPublisher {
  publish(rows: AnalyticsRow[]): Promise<void>;
  getDestination(): AnalyticsPublisherDestination;
}

export function getAnalyticsBigQueryRuntimeConfig(env: AppEnv): AnalyticsBigQueryRuntimeConfig {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const hasFirebaseServiceAccount = Boolean(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
  return {
    enabled: Boolean(env.ANALYTICS_ENABLED && env.GCP_PROJECT_ID && env.ANALYTICS_DATASET && env.ANALYTICS_EVENTS_TABLE),
    projectId: env.GCP_PROJECT_ID ?? null,
    dataset: env.ANALYTICS_DATASET ?? null,
    table: env.ANALYTICS_EVENTS_TABLE ?? null,
    credentialSource: credentialPath
      ? "google_application_credentials"
      : hasFirebaseServiceAccount
        ? "firebase_env_credentials"
        : "adc_default",
    serviceAccountEmail: env.FIREBASE_CLIENT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL ?? null,
    nonBlockingFailures: true,
  };
}

export class BigQueryAnalyticsPublisher implements AnalyticsPublisher {
  private readonly destination: AnalyticsPublisherDestination;
  private readonly runtimeConfig: AnalyticsBigQueryRuntimeConfig;
  private bigQuery: BigQuery | null = null;
  private tableRef: Table | null = null;
  private loggedStartupDiagnostic = false;
  private lastFailureLogMs = 0;
  private static readonly FAILURE_LOG_COOLDOWN_MS = 60_000;

  constructor(private readonly env: AppEnv) {
    this.destination = {
      enabled: Boolean(env.ANALYTICS_ENABLED && env.GCP_PROJECT_ID && env.ANALYTICS_DATASET && env.ANALYTICS_EVENTS_TABLE),
      projectId: env.GCP_PROJECT_ID ?? null,
      dataset: env.ANALYTICS_DATASET ?? null,
      table: env.ANALYTICS_EVENTS_TABLE ?? null
    };
    this.runtimeConfig = getAnalyticsBigQueryRuntimeConfig(env);
  }

  getDestination(): AnalyticsPublisherDestination {
    return { ...this.destination };
  }

  async publish(rows: AnalyticsRow[]): Promise<void> {
    if (!rows.length) return;
    const table = this.ensureTable();
    if (!table) {
      this.logStartupDiagnosticsOnce();
      throw new Error("analytics_publisher_unconfigured");
    }
    try {
      this.logStartupDiagnosticsOnce();
      await table.insert(rows);
      console.info("[analytics] bigquery_publish_ok", {
        count: rows.length,
        dataset: this.destination.dataset,
        table: this.destination.table
      });
    } catch (error) {
      const now = Date.now();
      if (now - this.lastFailureLogMs >= BigQueryAnalyticsPublisher.FAILURE_LOG_COOLDOWN_MS) {
        this.lastFailureLogMs = now;
        console.error("[analytics] bigquery_publish_fail", {
          projectId: this.runtimeConfig.projectId,
          dataset: this.destination.dataset,
          table: this.destination.table,
          credentialSource: this.runtimeConfig.credentialSource,
          serviceAccountEmail: this.runtimeConfig.serviceAccountEmail,
          nonBlocking: true,
          error: error instanceof Error ? error.message : String(error),
          checkCommand: "npm run debug:analytics:bigquery",
        });
      }
      throw error;
    }
  }

  private ensureTable(): Table | null {
    if (!this.destination.enabled) {
      return null;
    }
    if (this.tableRef) {
      return this.tableRef;
    }
    this.bigQuery = new BigQuery({ projectId: this.destination.projectId ?? undefined });
    this.tableRef = this.bigQuery
      .dataset(this.destination.dataset ?? "analytics_prod")
      .table(this.destination.table ?? "client_events");
    return this.tableRef;
  }

  private logStartupDiagnosticsOnce(): void {
    if (this.loggedStartupDiagnostic) return;
    this.loggedStartupDiagnostic = true;
    console.info("[analytics] bigquery_runtime_config", {
      enabled: this.runtimeConfig.enabled,
      projectId: this.runtimeConfig.projectId,
      dataset: this.runtimeConfig.dataset,
      table: this.runtimeConfig.table,
      credentialSource: this.runtimeConfig.credentialSource,
      serviceAccountEmail: this.runtimeConfig.serviceAccountEmail,
      nonBlockingFailures: this.runtimeConfig.nonBlockingFailures,
      checkCommand: "npm run debug:analytics:bigquery",
    });
    if (!this.runtimeConfig.enabled) {
      console.info("[analytics] bigquery_publishing_disabled_by_env", {
        analyticsEnabled: this.env.ANALYTICS_ENABLED,
        hasProjectId: Boolean(this.env.GCP_PROJECT_ID),
        hasDataset: Boolean(this.env.ANALYTICS_DATASET),
        hasTable: Boolean(this.env.ANALYTICS_EVENTS_TABLE),
      });
    }
  }
}
