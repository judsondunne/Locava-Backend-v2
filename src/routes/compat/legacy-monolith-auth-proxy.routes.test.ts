import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("legacy monolith auth proxy routes", () => {
  it("returns 503 JSON when LEGACY_MONOLITH_PROXY_BASE_URL is unset (not 404)", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      FIRESTORE_TEST_MODE: "disabled",
      LEGACY_MONOLITH_PROXY_BASE_URL: undefined,
      ENABLE_LEGACY_COMPAT_ROUTES: true
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signin/google",
      headers: { "content-type": "application/json" },
      payload: { accessToken: "test" }
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("LEGACY_MONOLITH_PROXY_BASE_URL");
    await app.close();
  });

  it("surfaces legacy_proxy_failed JSON when upstream monolith fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.reject(new Error("simulated_upstream_connection_refusal"))
      )
    );

    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      FIRESTORE_TEST_MODE: "disabled",
      LEGACY_MONOLITH_PROXY_BASE_URL: "https://classic.example.com",
      ENABLE_LEGACY_COMPAT_ROUTES: true
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signin/google",
        headers: { "content-type": "application/json" },
        payload: { accessToken: "test" }
      });
      expect(res.statusCode).toBe(502);
      const body = res.json() as { success?: boolean; error?: string; errorCode?: string };
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe("legacy_proxy_failed");
      expect(body.error).toContain("classic.example.com");
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
