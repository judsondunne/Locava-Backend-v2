import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";

const ROUTE = "/v2/debug/client-logs";

function clearFlag(): void {
  delete process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST;
}

function setFlag(value: string): void {
  process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST = value;
}

function buildEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "CLIENT_NET_END",
    method: "GET",
    urlPathOnly: "/v2/feed/for-you/simple",
    routeName: "feed.for_you.simple.list",
    requestKey: "GET:/v2/feed/for-you/simple",
    durationMs: 842,
    status: 200,
    ok: true,
    overlapCount: 0,
    inFlightCountForKey: 1,
    totalInFlightCount: 3,
    surface: "ForYouFeed",
    caller: "feedBootstrap",
    ...overrides
  };
}

function buildBatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientSessionId: "sess-debug-1",
    appBuildType: "profile",
    appVersion: "3.2.5",
    platform: "ios",
    deviceTime: Date.now(),
    surface: "App",
    entries: [buildEntry()],
    ...overrides
  };
}

describe("client debug log ingest route", () => {
  afterEach(() => {
    clearFlag();
    vi.restoreAllMocks();
  });

  it("returns 404 when ENABLE_CLIENT_DEBUG_LOG_INGEST is unset", async () => {
    clearFlag();
    const app = createApp({ NODE_ENV: "development" });
    const res = await app.inject({ method: "POST", url: ROUTE, payload: buildBatch() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
    await app.close();
  });

  it("accepts a valid batch when enabled and reports accepted count", async () => {
    setFlag("1");
    const app = createApp({ NODE_ENV: "development" });
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: buildBatch({ entries: [buildEntry(), buildEntry({ kind: "CLIENT_BOOT_TRACE", name: "app.boot" })] })
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, data: { accepted: 2 } });
    await app.close();
  });

  it("rejects oversized payload with 413", async () => {
    setFlag("1");
    process.env.CLIENT_DEBUG_LOG_MAX_BATCH_BYTES = "2048";
    const app = createApp({ NODE_ENV: "development" });
    const huge = "x".repeat(4096);
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: buildBatch({
        entries: [buildEntry({ errorMessage: huge.slice(0, 500), meta: { blob: huge } })]
      })
    });
    expect(res.statusCode).toBe(413);
    delete process.env.CLIENT_DEBUG_LOG_MAX_BATCH_BYTES;
    await app.close();
  });

  it("returns 400 for invalid payload shape", async () => {
    setFlag("1");
    const app = createApp({ NODE_ENV: "development" });
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: { not: "a batch" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "validation_error" } });
    await app.close();
  });

  it("redacts sensitive fields in printed output", async () => {
    setFlag("1");
    const app = createApp({ NODE_ENV: "development" });
    const infoSpy = vi.spyOn(app.log, "info").mockImplementation(() => app.log);
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: buildBatch({
        entries: [
          buildEntry({
            kind: "CLIENT_NET_ERROR",
            errorMessage: "auth failed",
            meta: {
              authorization: "Bearer abc.def.ghi.jklmnopqrstuvwxyz0123456789",
              email: "user@example.com",
              phone: "+15551234567",
              note: "ok"
            }
          })
        ]
      })
    });
    expect(res.statusCode).toBe(202);
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => app.log);
    const allLines = [...infoSpy.mock.calls, ...errorSpy.mock.calls]
      .map((args) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
      .join("\n");
    expect(allLines).not.toMatch(/Bearer\s+abc/);
    expect(allLines).not.toMatch(/abc\.def\.ghi/);
    expect(allLines).not.toMatch(/user@example\.com/);
    expect(allLines).not.toMatch(/\+15551234567/);
    expect(allLines).toMatch(/session=sess-debug-1/);
    await app.close();
  });

  it("truncates oversized strings and meta keys", async () => {
    setFlag("1");
    const app = createApp({ NODE_ENV: "development" });
    const big = "y".repeat(800);
    const meta: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) meta[`k${i}`] = "v";
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: buildBatch({
        entries: [buildEntry({ errorMessage: big.slice(0, 500), meta })]
      })
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });
});
