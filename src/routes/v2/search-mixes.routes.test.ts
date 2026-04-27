import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search mixes routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("bootstraps mix shelves (or returns 503 when upstream is unavailable)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/bootstrap?limit=8&includeDebug=1",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.data.routeName).toBe("search.mixes.bootstrap.get");
    expect(Array.isArray(body.data.mixes)).toBe(true);
    expect(typeof body.data.scoringVersion).toBe("string");
  });

  it("returns a paginated mix feed page (or 503 when upstream is unavailable)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify({
        mixId: "nearby:near_you",
        limit: 12,
        cursor: null,
        lat: null,
        lng: null,
        includeDebug: true,
      }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.data.routeName).toBe("search.mixes.feed.post");
    expect(body.data.mixId).toBe("nearby:near_you");
    expect(Array.isArray(body.data.posts)).toBe(true);
    expect(typeof body.data.hasMore).toBe("boolean");
  });
});

