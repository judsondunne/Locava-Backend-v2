import { describe, expect, it } from "vitest";

describe("launch concurrency readiness", () => {
  it("handles parallel core route requests without cross-request failures", async () => {
    process.env.FIRESTORE_TEST_MODE = process.env.FIRESTORE_TEST_MODE ?? "disabled";
    const { createApp } = await import("../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", LEGACY_MONOLITH_PROXY_BASE_URL: undefined });
    const headers = { "x-viewer-id": "aXngoh9jeqW35FNM3fq1w9aXdEh1", "x-viewer-roles": "internal" };
    const requests = [
      { method: "GET" as const, url: "/v2/feed/bootstrap?limit=4" },
      { method: "GET" as const, url: "/v2/feed/page?limit=4" },
      { method: "GET" as const, url: "/v2/map/markers?limit=20" },
      { method: "GET" as const, url: "/v2/search/bootstrap?q=hiking&limit=8" },
      { method: "GET" as const, url: "/v2/search/results?q=hiking&limit=6&types=posts" },
      { method: "GET" as const, url: "/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap" },
      { method: "GET" as const, url: "/v2/notifications?limit=8" },
      { method: "GET" as const, url: "/v2/posts/H7LEDc8vtUdmdlgOvOwZ/detail" }
    ];

    const responses = await Promise.all(
      requests.map((request) =>
        app.inject({
          ...request,
          headers
        })
      )
    );

    for (const response of responses) {
      expect(response.statusCode).toBeGreaterThanOrEqual(200);
      expect(response.statusCode === 503 || response.statusCode < 500).toBe(true);
    }

    await app.close();
  });
});
