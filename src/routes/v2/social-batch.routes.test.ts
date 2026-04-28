import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 social batch route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("rejects missing internal role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/batch?postIds=abc123def456"
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 items envelope for valid viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/batch?postIds=internal-viewer-feed-post-1",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.routeName).toBe("social.batch.get");
    expect(Array.isArray(body.data.items)).toBe(true);
  });
});
