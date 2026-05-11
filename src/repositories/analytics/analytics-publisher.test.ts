import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../config/env.js";
import {
  BigQueryAnalyticsPublisher,
  extractMissingBigQueryPermission,
  getAnalyticsBigQueryRuntimeConfig,
  resetAnalyticsPublisherFailureLogForTests
} from "./analytics-publisher.js";

const dummySaJson = JSON.stringify({
  type: "service_account",
  project_id: "unit-test",
  private_key:
    "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\\n-----END PRIVATE KEY-----\\n",
  client_email: "analytics-bq-unit@test.iam.gserviceaccount.com"
});

describe("analytics publisher runtime diagnostics", () => {
  beforeEach(() => {
    resetAnalyticsPublisherFailureLogForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(path.join(process.cwd(), ".analytics-spool"), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("uses the same runtime config helper expected by diagnostics script", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
      FIREBASE_CLIENT_EMAIL: "firebase@example.com",
      FIREBASE_PRIVATE_KEY: "dummy"
    });
    const runtime = getAnalyticsBigQueryRuntimeConfig(env);
    expect(runtime).toMatchObject({
      enabled: true,
      bigQueryEnabled: true,
      analyticsEnabled: true,
      projectId: "learn-32d72",
      dataset: "analytics_prod",
      table: "client_events",
      nonBlockingFailures: true
    });
    expect([
      "adc_default",
      "google_application_credentials",
      "analytics_service_account_json",
      "analytics_service_account_file"
    ]).toContain(runtime.credentialSource);
  });

  it("enables BigQuery when only ANALYTICS_BIGQUERY_PROJECT_ID is set (no GCP_PROJECT_ID)", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      ANALYTICS_BIGQUERY_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON: dummySaJson
    });
    const runtime = getAnalyticsBigQueryRuntimeConfig(env);
    expect(runtime.bigQueryEnabled).toBe(true);
    expect(runtime.projectId).toBe("learn-32d72");
  });

  it("prefers ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON over GOOGLE_APPLICATION_CREDENTIALS for metadata", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON: dummySaJson,
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/should-not-win-for-metadata.json"
    });
    const runtime = getAnalyticsBigQueryRuntimeConfig(env);
    expect(runtime.credentialSource).toBe("analytics_service_account_json");
    expect(runtime.serviceAccountEmail).toBe("analytics-bq-unit@test.iam.gserviceaccount.com");
  });

  it("extracts missing BigQuery permission from API error text", () => {
    const msg =
      "Permission bigquery.tables.updateData denied on table learn-32d72:analytics_prod.client_events (or it may not exist).";
    expect(extractMissingBigQueryPermission(msg)).toBe("bigquery.tables.updateData");
  });

  it("logs BigQuery publish failures as structured diagnostics without private keys", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON: dummySaJson
    });
    const publisher = new BigQueryAnalyticsPublisher(env) as any;
    publisher.tableRef = {
      insert: vi.fn(async () => {
        throw new Error(
          "Permission bigquery.tables.updateData denied on table learn-32d72:analytics_prod.client_events"
        );
      })
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      publisher.publish([
        {
          event: "app_open",
          schemaVersion: "1.0.0",
          userId: null,
          anonId: "anon-1",
          sessionId: "session-1",
          clientTime: new Date(),
          receivedAt: new Date(),
          platform: "ios",
          requestIp: null,
          userAgent: null,
          properties: "{}"
        }
      ])
    ).rejects.toThrow(/denied/);

    const payload = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload?.event).toBe("analytics_bigquery_publish_fail");
    expect(payload?.nonBlocking).toBe(true);
    expect(payload?.missingPermission).toBe("bigquery.tables.updateData");
    expect(payload?.checkCommand).toBe("npm run debug:analytics:bigquery");
    expect(payload?.credentialSource).toBe("analytics_service_account_json");
    expect(payload?.serviceAccountEmail).toBe("analytics-bq-unit@test.iam.gserviceaccount.com");
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(serialized).not.toMatch(/private_key/);
  });
});
