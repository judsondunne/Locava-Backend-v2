import { describe, expect, it, vi } from "vitest";
import { clientTelemetryService } from "./clientTelemetry.service.js";
import type { ClientTelemetryBatch } from "./clientTelemetry.schema.js";

function makeLogger() {
  return {
    info: vi.fn()
  };
}

function batch(events: ClientTelemetryBatch["events"]): ClientTelemetryBatch {
  return {
    sessionId: "session-1",
    appInstanceId: "app-instance-1",
    buildProfile: "production",
    appVersion: "1.0.0",
    platform: "ios",
    events
  };
}

describe("clientTelemetryService PHONE_PERF logging", () => {
  it("uses monotonicMs when provided", () => {
    const logger = makeLogger();
    clientTelemetryService.ingest(
      batch([
        {
          eventId: "e1",
          sessionId: "session-1",
          clientTimestampMs: 1000,
          monotonicMs: 209,
          category: "route",
          name: "route.request_start",
          method: "GET",
          path: "/v2/posts/details:batch"
        }
      ]),
      logger as any,
      false
    );
    const line = String(logger.info.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("+0209");
  });

  it("dedupes duplicate startup phases within 250ms", () => {
    const logger = makeLogger();
    clientTelemetryService.ingest(
      batch([
        {
          eventId: "e2",
          sessionId: "session-1",
          clientTimestampMs: 1100,
          category: "app",
          name: "app.startup_phase",
          meta: { phase: "launch" }
        },
        {
          eventId: "e3",
          sessionId: "session-1",
          clientTimestampMs: 1200,
          category: "app",
          name: "app.startup_phase",
          meta: { phase: "launch" }
        }
      ]),
      logger as any,
      false
    );
    const lines = logger.info.mock.calls.map((call) => String(call[0] ?? ""));
    const startupLines = lines.filter((line) => line.includes("app.startup_phase"));
    expect(startupLines.length).toBe(1);
    expect(startupLines[0]).toContain("phase=launch");
  });
});
