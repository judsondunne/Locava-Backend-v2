import fs from "node:fs";
import path from "node:path";
import { BigQuery, type Table } from "@google-cloud/bigquery";
import type { AppEnv } from "../../config/env.js";
import { LOG_ANALYTICS_DEBUG } from "../../lib/logging/log-config.js";
import { rateLimitedLog, warnOnce } from "../../lib/logging/debug-log.js";
import {
  resolveAnalyticsBigQueryClientInit,
  type AnalyticsBigQueryCredentialSource
} from "./analytics-bigquery-credentials.js";

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
  analyticsEnabled: boolean;
  bigQueryEnabled: boolean;
  /** Alias of `bigQueryEnabled` for scripts and older callers. */
  enabled: boolean;
  projectId: string | null;
  dataset: string | null;
  table: string | null;
  credentialSource: AnalyticsBigQueryCredentialSource;
  serviceAccountEmail: string | null;
  nonBlockingFailures: boolean;
};

export interface AnalyticsPublisher {
  publish(rows: AnalyticsRow[]): Promise<void>;
  getDestination(): AnalyticsPublisherDestination;
}

const SPOOL_REL_DIR = ".analytics-spool";
const SPOOL_FILENAME = "client-events.ndjson";

const failureLogCooldownMs = 60_000;
const failureLogByFingerprint = new Map<string, number>();

export function extractMissingBigQueryPermission(message: string): string | null {
  const m = message.match(/Permission\s+(\S+)\s+denied/i);
  return m?.[1] ?? null;
}

export function getAnalyticsBigQueryRuntimeConfig(env: AppEnv): AnalyticsBigQueryRuntimeConfig {
  const init = resolveAnalyticsBigQueryClientInit(env);
  const bigQueryEnabled = Boolean(
    env.ANALYTICS_ENABLED && env.GCP_PROJECT_ID && env.ANALYTICS_DATASET && env.ANALYTICS_EVENTS_TABLE
  );
  return {
    analyticsEnabled: env.ANALYTICS_ENABLED,
    bigQueryEnabled,
    enabled: bigQueryEnabled,
    projectId: env.GCP_PROJECT_ID ?? null,
    dataset: env.ANALYTICS_DATASET ?? null,
    table: env.ANALYTICS_EVENTS_TABLE ?? null,
    credentialSource: init.credentialSource,
    serviceAccountEmail: init.serviceAccountEmail,
    nonBlockingFailures: true
  };
}

/** Safe structured payload for server startup / health (no secrets). */
export function getAnalyticsStartupLogPayload(env: AppEnv): Record<string, unknown> {
  const rt = getAnalyticsBigQueryRuntimeConfig(env);
  return {
    analyticsEnabled: rt.analyticsEnabled,
    bigQueryEnabled: rt.bigQueryEnabled,
    projectId: rt.projectId,
    dataset: rt.dataset,
    table: rt.table,
    credentialSource: rt.credentialSource,
    serviceAccountEmail: rt.serviceAccountEmail,
    nonBlocking: rt.nonBlockingFailures
  };
}

function appendAnalyticsEventsSpool(rows: AnalyticsRow[], errorMessage: string, nodeEnv: string): void {
  if (nodeEnv === "production" || rows.length === 0) return;
  try {
    const dir = path.join(process.cwd(), SPOOL_REL_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      at: new Date().toISOString(),
      error: errorMessage.slice(0, 2_000),
      rowCount: rows.length,
      rows: rows.map((row) => ({
        event: row.event,
        schemaVersion: row.schemaVersion,
        userId: row.userId,
        anonId: row.anonId,
        sessionId: row.sessionId,
        clientTime: row.clientTime?.toISOString() ?? null,
        receivedAt: row.receivedAt.toISOString(),
        platform: row.platform,
        requestIp: row.requestIp,
        userAgent: row.userAgent,
        properties: row.properties
      }))
    };
    fs.appendFileSync(path.join(dir, SPOOL_FILENAME), `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    /* spool must never throw */
  }
}

function shouldLogFailure(fingerprint: string, now: number): boolean {
  const last = failureLogByFingerprint.get(fingerprint) ?? 0;
  if (now - last < failureLogCooldownMs) return false;
  failureLogByFingerprint.set(fingerprint, now);
  return true;
}

/** Vitest-only: reset rate-limit map between cases. */
export function resetAnalyticsPublisherFailureLogForTests(): void {
  failureLogByFingerprint.clear();
}

export class BigQueryAnalyticsPublisher implements AnalyticsPublisher {
  private readonly destination: AnalyticsPublisherDestination;
  private readonly runtimeConfig: AnalyticsBigQueryRuntimeConfig;
  private readonly bqInit: ReturnType<typeof resolveAnalyticsBigQueryClientInit>;
  private bigQuery: BigQuery | null = null;
  private tableRef: Table | null = null;
  private loggedStartupDiagnostic = false;

  constructor(private readonly env: AppEnv) {
    this.bqInit = resolveAnalyticsBigQueryClientInit(env);
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
      if (LOG_ANALYTICS_DEBUG) {
        rateLimitedLog(
          "analytics",
          "analytics bigquery_publish_ok",
          () => ({
            count: rows.length,
            dataset: this.destination.dataset,
            table: this.destination.table
          }),
          30_000
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingPermission = extractMissingBigQueryPermission(message);
      const fingerprint = missingPermission ?? message.slice(0, 240);
      const now = Date.now();
      if (shouldLogFailure(fingerprint, now)) {
        const payload = {
          event: "analytics_bigquery_publish_fail",
          projectId: this.runtimeConfig.projectId,
          dataset: this.destination.dataset,
          table: this.destination.table,
          credentialSource: this.runtimeConfig.credentialSource,
          serviceAccountEmail: this.runtimeConfig.serviceAccountEmail,
          missingPermission,
          message: message.slice(0, 2_000),
          nonBlocking: true,
          checkCommand: "npm run debug:analytics:bigquery"
        };
        console.warn("[analytics_bigquery_publish_fail]", payload);
      }
      appendAnalyticsEventsSpool(rows, message, this.env.NODE_ENV);
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
    this.bigQuery = new BigQuery(this.bqInit.bigQueryOptions);
    this.tableRef = this.bigQuery
      .dataset(this.destination.dataset ?? "analytics_prod")
      .table(this.destination.table ?? "client_events");
    return this.tableRef;
  }

  private logStartupDiagnosticsOnce(): void {
    if (this.loggedStartupDiagnostic) return;
    this.loggedStartupDiagnostic = true;
    if (LOG_ANALYTICS_DEBUG) {
      rateLimitedLog(
        "analytics",
        "analytics bigquery_runtime_config",
        () => ({
          bigQueryEnabled: this.runtimeConfig.bigQueryEnabled,
          projectId: this.runtimeConfig.projectId,
          dataset: this.runtimeConfig.dataset,
          table: this.runtimeConfig.table,
          credentialSource: this.runtimeConfig.credentialSource,
          serviceAccountEmail: this.runtimeConfig.serviceAccountEmail,
          nonBlockingFailures: this.runtimeConfig.nonBlockingFailures,
          checkCommand: "npm run debug:analytics:bigquery"
        }),
        300_000
      );
    }
    if (!this.runtimeConfig.bigQueryEnabled) {
      warnOnce("analytics", "analytics bigquery_publishing_disabled_by_env", () => ({
        analyticsEnabled: this.env.ANALYTICS_ENABLED,
        hasProjectId: Boolean(this.env.GCP_PROJECT_ID),
        hasDataset: Boolean(this.env.ANALYTICS_DATASET),
        hasTable: Boolean(this.env.ANALYTICS_EVENTS_TABLE)
      }));
    }
  }
}
