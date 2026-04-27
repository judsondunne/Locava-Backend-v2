import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 friends mix", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("returns friends mix with authorSource debug (or 503)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({
        mixId: "friends:from_people_you_follow",
        cursor: null,
        limit: 12,
        lat: 40.68843,
        lng: -75.22073,
        includeDebug: true,
      }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json().data;
    expect(Array.isArray(body.posts)).toBe(true);
    const debugItems = (body.debug?.items ?? []) as Array<{ authorSource?: string | null }>;
    if (debugItems.length > 0) {
      expect(debugItems.some((x) => x.authorSource === "following")).toBe(true);
    }
  });
});

