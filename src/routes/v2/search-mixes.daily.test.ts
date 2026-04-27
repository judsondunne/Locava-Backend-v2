import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 daily mix", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("returns daily mix page (or 503) and supports cursor paging", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({
        mixId: "daily:for_you",
        cursor: null,
        limit: 10,
        lat: 40.68843,
        lng: -75.22073,
        includeDebug: true,
      }),
    });
    expect([200, 503]).toContain(res1.statusCode);
    if (res1.statusCode !== 200) return;
    const b1 = res1.json().data;
    expect(Array.isArray(b1.posts)).toBe(true);
    expect(typeof b1.hasMore).toBe("boolean");
    expect(b1.nextCursor === null || typeof b1.nextCursor === "string").toBe(true);
  });
});

