import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv, type AppEnv } from "../../config/env.js";
import type { AnalyticsPublisher, AnalyticsRow } from "../../repositories/analytics/analytics-publisher.js";
import { type RequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { registerV2AnalyticsEventsRoutes } from "./analytics-events.routes.js";
import { AnalyticsIngestService } from "../../services/analytics/analytics-ingest.service.js";
import { recordBackendRouteObservation } from "../../services/analytics/analytics-route-observer.js";
import { setAnalyticsIngestServiceForTests } from "../../services/analytics/analytics-runtime.js";

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_ENABLED: "true",
      ANALYTICS_QUEUE_MAX_ITEMS: "100",
      ANALYTICS_PUBLISH_BATCH_SIZE: "5",
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

async function buildMiniApp(env: AppEnv): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("config", env);
  app.setErrorHandler((error, _request, reply) => {
    const isValidationError = error instanceof Error && error.name === "ZodError";
    reply.status(isValidationError ? 400 : 500).send({
      ok: false,
      error: { code: isValidationError ? "validation_error" : "internal_error" }
    });
  });
  await registerV2AnalyticsEventsRoutes(app);
  return app;
}

function createRequestContext(): RequestContext {
  return {
    requestId: "req-1",
    route: "/v2/test",
    method: "GET",
    startNs: BigInt(0),
    payloadBytes: 12,
    dbOps: { reads: 0, writes: 0, queries: 0 },
    cache: { hits: 0, misses: 0 },
    dedupe: { hits: 0, misses: 0 },
    concurrency: { waits: 0 },
    entityCache: { hits: 0, misses: 0 },
    entityConstruction: { total: 0, types: {} },
    idempotency: { hits: 0, misses: 0 },
    invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: [],
    timeouts: [],
    surfaceTimings: {},
    orchestration: {
      surface: "feed_open",
      priority: "high",
      requestGroup: "bootstrap",
      visiblePostId: null,
      screenInstanceId: null,
      clientRequestId: null,
      hydrationMode: "cold",
      stale: false,
      canceled: false,
      deduped: false,
      queueWaitMs: 0
    }
  };
}

describe("analytics events routes", () => {
  beforeEach(() => {
    setAnalyticsIngestServiceForTests(null);
  });

  afterEach(() => {
    setAnalyticsIngestServiceForTests(null);
  });

  it("accepts valid batched events on the v2 route without waiting for the publisher", async () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);
    setAnalyticsIngestServiceForTests(service);
    const app = await buildMiniApp(buildEnv());

    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/analytics/events",
        payload: {
          events: [
            {
              eventId: "evt-1",
              event: "screen_view",
              sessionId: "session-1",
              anonId: "anon-1",
              properties: { screenName: "home_tab" }
            }
          ]
        }
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.data.accepted).toBe(1);
      expect(publisher.publishMock).not.toHaveBeenCalled();

      await service.flushNowForTests();
      expect(publisher.publishMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("returns 202 even when BigQuery publisher later fails", async () => {
    const publisher = createPublisher();
    publisher.publishMock.mockRejectedValueOnce(new Error("Access Denied"));
    const service = new AnalyticsIngestService(buildEnv(), publisher);
    setAnalyticsIngestServiceForTests(service);
    const app = await buildMiniApp(buildEnv());

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/analytics/v2/events",
        payload: {
          events: [
            {
              eventId: "evt-bq-fail",
              event: "app_open",
              sessionId: "session-fail",
              anonId: "anon-fail",
              properties: { source: "fail-path" },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(202);
      await service.flushNowForTests();
      expect(service.getDebugSnapshot().queueDepth).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("supports the legacy /api analytics alias and resolves userId from x-viewer-id", async () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);
    setAnalyticsIngestServiceForTests(service);
    const app = await buildMiniApp(buildEnv());

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/analytics/v2/events",
        headers: {
          "x-viewer-id": "header-user-1",
          "user-agent": "Locava/3.1 CFNetwork Darwin"
        },
        payload: {
          events: [{ eventId: "evt-legacy-1", event: "app_open", platform: "web", properties: { source: "cold" } }]
        }
      });

      expect(res.statusCode).toBe(202);
      await service.flushNowForTests();
      expect(publisher.rows[0]?.[0]?.userId).toBe("header-user-1");
      expect(publisher.rows[0]?.[0]?.platform).toBe("ios");
      expect(publisher.rows[0]?.[0]?.properties).toContain("\"clientPlatform\":\"web\"");
    } finally {
      await app.close();
    }
  });

  it("rejects malformed requests with a validation error", async () => {
    const publisher = createPublisher();
    const service = new AnalyticsIngestService(buildEnv(), publisher);
    setAnalyticsIngestServiceForTests(service);
    const app = await buildMiniApp(buildEnv());

    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/analytics/events",
        payload: { events: [] }
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("emits cheap backend route observations without touching product handlers", async () => {
    const publisher = createPublisher();
    const env = buildEnv();
    const service = new AnalyticsIngestService(env, publisher);
    setAnalyticsIngestServiceForTests(service);

    runWithRequestContext(createRequestContext(), () => {
      recordBackendRouteObservation({
        env,
        request: {
          method: "GET",
          url: "/v2/feed/bootstrap",
          headers: { "x-viewer-id": "route-user-1" },
          routeOptions: { url: "/v2/feed/bootstrap" },
          analyticsErrorCode: undefined
        } as never,
        reply: {
          statusCode: 200
        } as never,
        ctx: createRequestContext(),
        latencyMs: 14.2,
        budgetViolations: []
      });
    });

    await service.flushNowForTests();
    const routeRow = publisher.rows.flat().find((row) => row.event === "backend_route_observation");
    expect(routeRow).toBeTruthy();
    expect(routeRow?.userId).toBe("route-user-1");
    expect(routeRow?.properties).toContain("\"routeName\":\"/v2/feed/bootstrap\"");
    expect(routeRow?.properties).toContain("\"routePath\":\"/v2/feed/bootstrap\"");
  });
});
