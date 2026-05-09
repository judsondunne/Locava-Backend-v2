import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("client telemetry routes", () => {
  it("accepts valid telemetry batch", async () => {
    const app = createApp({ NODE_ENV: "development" });
    const res = await app.inject({
      method: "POST",
      url: "/debug/client-telemetry/events",
      payload: {
        sessionId: "sess-1",
        appInstanceId: "app-1",
        platform: "ios",
        events: [
          {
            eventId: "evt-1",
            sessionId: "sess-1",
            clientTimestampMs: Date.now(),
            category: "route",
            name: "route.response_received"
          }
        ]
      }
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it("rejects oversized payload", async () => {
    process.env.CLIENT_TELEMETRY_MAX_PAYLOAD_BYTES = "1000";
    const app = createApp({ NODE_ENV: "development" });
    const huge = "x".repeat(2000);
    const res = await app.inject({
      method: "POST",
      url: "/debug/client-telemetry/events",
      payload: {
        sessionId: "sess-2",
        appInstanceId: "app-2",
        events: [
          {
            eventId: "evt-2",
            sessionId: "sess-2",
            clientTimestampMs: Date.now(),
            category: "app",
            name: huge
          }
        ]
      }
    });
    expect(res.statusCode).toBe(413);
    delete process.env.CLIENT_TELEMETRY_MAX_PAYLOAD_BYTES;
    await app.close();
  });

  it("accepts telemetry when NODE_ENV is production and ENABLE_CLIENT_DEBUG_LOG_INGEST is on", async () => {
    process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST = "1";
    const app = createApp({ NODE_ENV: "production" });
    const res = await app.inject({
      method: "POST",
      url: "/debug/client-telemetry/events",
      headers: { "x-locava-field-test-session-id": "fieldtest-test-abc" },
      payload: {
        sessionId: "sess-prod-1",
        appInstanceId: "app-prod-1",
        platform: "ios",
        fieldTestSessionId: "fieldtest-test-abc",
        events: [
          {
            eventId: "evt-prod-1",
            sessionId: "sess-prod-1",
            clientTimestampMs: Date.now(),
            category: "app",
            name: "app.launch"
          }
        ]
      }
    });
    expect(res.statusCode).toBe(202);
    delete process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST;
    await app.close();
  });

  it("stores session in memory", async () => {
    const app = createApp({ NODE_ENV: "development" });
    await app.inject({
      method: "POST",
      url: "/debug/client-telemetry/events",
      payload: {
        sessionId: "sess-3",
        appInstanceId: "app-3",
        platform: "android",
        events: [
          {
            eventId: "evt-3",
            sessionId: "sess-3",
            clientTimestampMs: Date.now(),
            category: "video",
            name: "video.first_frame"
          }
        ]
      }
    });
    const listRes = await app.inject({ method: "GET", url: "/debug/client-telemetry/sessions" });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.payload).toContain("sess-3");
    await app.close();
  });
});
