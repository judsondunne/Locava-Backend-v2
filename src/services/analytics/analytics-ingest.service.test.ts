import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv, type AppEnv } from "../../config/env.js";
import type { AnalyticsPublisher, AnalyticsRow } from "../../repositories/analytics/analytics-publisher.js";
import { AnalyticsIngestService } from "./analytics-ingest.service.js";

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      ANALYTICS_QUEUE_MAX_ITEMS: "100",
      ANALYTICS_PUBLISH_BATCH_SIZE: "2",
      ANALYTICS_MAX_BATCH: "20",
      ANALYTICS_RETRY_MAX_ATTEMPTS: "2",
      ANALYTICS_RETRY_BASE_DELAY_MS: "100",
      ANALYTICS_RETRY_MAX_DELAY_MS: "500",
      ANALYTICS_DEBUG_RECENT_LIMIT: "20"
    }),
    ...overrides
  };
}

function createPublisher(): AnalyticsPublisher & {
  rows: AnalyticsRow[][];
  publishMock: ReturnType<typeof vi.fn<AnalyticsPublisher["publish"]>>;
} {
  const rows: AnalyticsRow[][] = [];
  const publishMock = vi.fn<AnalyticsPublisher["publish"]>(async (batch) => {
    rows.push(batch);
  });
  return {
    rows,
    publishMock,
    publish: publishMock,
    getDestination: () => ({
      enabled: true,
      projectId: "test-project",
      dataset: "analytics_prod",
      table: "client_events"
    })
  };
}

describe("AnalyticsIngestService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("normalizes legacy-compatible events and publishes dashboard rows", async () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);

    const accepted = service.acceptBatch({
      events: [
        {
          event: "screen_view",
          screenName: "home_tab",
          properties: { screenName: "home_tab" },
          platform: "ios",
          sessionId: "session-a",
          anonId: "anon-a"
        }
      ],
      requestUserId: "viewer-1",
      requestIp: "127.0.0.1",
      userAgent: "vitest"
    });

    expect(accepted.accepted).toBe(1);
    expect(accepted.dropped).toBe(0);

    await service.flushNowForTests();

    expect(publisher.rows).toHaveLength(1);
    expect(publisher.rows[0]).toHaveLength(1);
    expect(publisher.rows[0]?.[0]).toMatchObject({
      event: "screen_view",
      userId: "viewer-1",
      sessionId: "session-a",
      platform: "ios",
      requestIp: "127.0.0.1",
      userAgent: "vitest"
    });
    expect(publisher.rows[0]?.[0]?.properties).toContain("\"screenName\":\"home_tab\"");
    expect(publisher.rows[0]?.[0]?.properties).toContain("\"installId\":\"anon-a\"");
    expect(publisher.rows[0]?.[0]?.properties).toContain("\"clientPlatform\":\"ios\"");
  });

  it("dedupes repeated eventIds inside the ingest window", async () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);

    const first = service.acceptBatch({
      events: [{ eventId: "dup-1", event: "app_open", properties: { source: "cold" } }]
    });
    const second = service.acceptBatch({
      events: [{ eventId: "dup-1", event: "app_open", properties: { source: "cold" } }]
    });

    expect(first.accepted).toBe(1);
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(1);

    await service.flushNowForTests();
    expect(publisher.rows).toHaveLength(1);
    expect(publisher.rows[0]).toHaveLength(1);
  });

  it("records publisher failures without surfacing them to callers", async () => {
    const publisher = createPublisher();
    publisher.publishMock.mockRejectedValueOnce(new Error("bq_down"));
    publisher.publishMock.mockResolvedValueOnce(undefined);
    const service = new AnalyticsIngestService(buildEnv(), publisher);

    const accepted = service.acceptBatch({
      events: [{ eventId: "retry-1", event: "app_open", properties: { source: "resume" } }]
    });
    expect(accepted.accepted).toBe(1);

    await service.flushNowForTests();
    expect(service.getDebugSnapshot().queueDepth).toBe(1);

    await service.flushNowForTests();
    expect(service.getDebugSnapshot().queueDepth).toBe(0);
    expect(publisher.publishMock).toHaveBeenCalledTimes(2);
  });

  it("drops malformed known events instead of claiming they were queued", () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);

    const accepted = service.acceptBatch({
      events: [{ event: "screen_view", properties: {} }]
    });

    expect(accepted.accepted).toBe(0);
    expect(accepted.dropped).toBe(1);
    expect(service.getDebugSnapshot().recentFailures[0]?.error).toContain("screen_view requires");
  });
});
