import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("compat story-users", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("returns story users quickly-shaped payload (or 503 when upstream unavailable)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/product/connections/user/internal-viewer/story-users",
      headers,
      payload: JSON.stringify({ limit: 10, cursor: null, seenPostIds: [], suggestedUserIds: [] }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.storyUsers)).toBe(true);
  });
});

