import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search home bootstrap v1", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("GET /v2/search/home-bootstrap returns contract-shaped payload or 503", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/home-bootstrap?includeDebug=1&bypassCache=1",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(1);
    expect(Array.isArray(body.data.suggestedUsers)).toBe(true);
    expect(body.data.activityMixes).toEqual([]);
    expect(body.data.debug?.routeName).toBe("search.home_bootstrap.v1");
  });

  it("GET /v2/search/mixes/:activityKey/page returns or 503", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/hiking/page?limit=8&includeDebug=1",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(1);
    expect(body.data.activityKey).toBe("hiking");
    expect(Array.isArray(body.data.posts)).toBe(true);
  });

  it("GET /v2/search/mixes/castles/page canonicalizes activityKey to castle", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/castles/page?limit=8&includeDebug=1",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.activityKey).toBe("castle");
  });
});
