import { describe, expect, it, vi } from "vitest";
import { debugLog, rateLimitedLog, warnOnce } from "./debug-log.js";

describe("debug-log helpers", () => {
  it("does not emit debug logs when scope disabled", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prev = process.env.ENABLE_DEBUG_LOGS;
    process.env.ENABLE_DEBUG_LOGS = "false";
    debugLog("video", "TEST_EVENT", { a: 1 });
    expect(spy).not.toHaveBeenCalled();
    process.env.ENABLE_DEBUG_LOGS = prev;
    spy.mockRestore();
  });

  it("warnOnce emits once per key", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnOnce("analytics", "BIGQUERY_FAIL", { code: "x" });
    warnOnce("analytics", "BIGQUERY_FAIL", { code: "x" });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("rateLimitedLog throttles repeated logs", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prev = process.env.ENABLE_DEBUG_LOGS;
    const prevVideo = process.env.LOG_VIDEO_DEBUG;
    process.env.ENABLE_DEBUG_LOGS = "true";
    process.env.LOG_VIDEO_DEBUG = "1";
    rateLimitedLog("video", "R1", { a: 1 }, 999999);
    rateLimitedLog("video", "R1", { a: 1 }, 999999);
    expect(spy.mock.calls.length <= 1).toBe(true);
    process.env.ENABLE_DEBUG_LOGS = prev;
    process.env.LOG_VIDEO_DEBUG = prevVideo;
    spy.mockRestore();
  });
});
