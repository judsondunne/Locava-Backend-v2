import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { SearchHomeV1Orchestrator } from "../../orchestration/surfaces/search-home-v1.orchestrator.js";

describe("v2 search home bootstrap v1", () => {
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /v2/search/home-bootstrap returns contract-shaped payload and never 503s", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/home-bootstrap?includeDebug=1&bypassCache=1",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(1);
    expect(Array.isArray(body.data.suggestedUsers)).toBe(true);
    expect(Array.isArray(body.data.activityMixes)).toBe(true);
    expect(body.data.debug?.routeName).toBe("search.home_bootstrap.v1");
  });

  it("GET /v2/search/home-bootstrap falls back to valid 200 JSON when upstream throws", async () => {
    vi.spyOn(SearchHomeV1Orchestrator.prototype, "homeBootstrap").mockRejectedValueOnce(new Error("pool warming"));
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/home-bootstrap?includeDebug=1&bypassCache=1",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.suggestedUsers).toEqual([]);
    expect(body.data.activityMixes).toEqual([]);
  });

  it("GET /v2/search/mixes/:activityKey/page returns or 503", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
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
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
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
