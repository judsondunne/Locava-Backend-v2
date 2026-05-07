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
