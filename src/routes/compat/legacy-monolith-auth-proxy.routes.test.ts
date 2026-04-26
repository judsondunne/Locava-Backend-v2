import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("legacy monolith auth proxy routes", () => {
  it("returns 503 JSON when LEGACY_MONOLITH_PROXY_BASE_URL is unset (not 404)", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
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
  });
});
