import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../config/env.js";
import { BigQueryAnalyticsPublisher, getAnalyticsBigQueryRuntimeConfig } from "./analytics-publisher.js";

describe("analytics publisher runtime diagnostics", () => {
  it("uses the same runtime config helper expected by diagnostics script", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
      FIREBASE_CLIENT_EMAIL: "svc@example.com",
      FIREBASE_PRIVATE_KEY: "dummy",
    });
    const runtime = getAnalyticsBigQueryRuntimeConfig(env);
    expect(runtime).toMatchObject({
      enabled: true,
      projectId: "learn-32d72",
      dataset: "analytics_prod",
      table: "client_events",
      serviceAccountEmail: "svc@example.com",
      nonBlockingFailures: true,
    });
  });

  it("logs BigQuery publish failures as non-blocking diagnostics", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events",
    });
    const publisher = new BigQueryAnalyticsPublisher(env) as any;
    publisher.tableRef = {
      insert: vi.fn(async () => {
        throw new Error("Access Denied");
      }),
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
          properties: "{}",
        },
      ])
    ).rejects.toThrow("Access Denied");

    const payload = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload?.nonBlocking).toBe(true);
    expect(payload?.checkCommand).toBe("npm run debug:analytics:bigquery");
  });
});
