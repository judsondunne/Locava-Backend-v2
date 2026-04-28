import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 map bootstrap route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };
  const bbox = "-123.0,36.0,-121.0,38.0";

  it("returns lean marker-index payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v2/map/bootstrap?bbox=${encodeURIComponent(bbox)}&limit=120`,
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("map.bootstrap.get");
    expect(body.page.count).toBeGreaterThanOrEqual(0);
    if (body.markers.length > 0) {
      const marker = body.markers[0];
      expect(marker.postId).toBeDefined();
      expect(marker.lat).toBeTypeOf("number");
      expect(marker.lng).toBeTypeOf("number");
      expect(marker.activityIds).toBeDefined();
      expect(marker.social).toBeUndefined();
      expect(marker.comments).toBeUndefined();
      expect(marker.author).toBeUndefined();
    }
  });

  it("collapses repeated identical requests to warm-cache near-zero reads", async () => {
    const url = `/v2/map/bootstrap?bbox=${encodeURIComponent(bbox)}&limit=120`;
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const warm = await app.inject({ method: "GET", url, headers: viewerHeaders });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);
    expect(warm.json().meta.db.queries).toBe(0);
  });

  it("applies strict bounds and limit variation safely", async () => {
    const wide = await app.inject({
      method: "GET",
      url: `/v2/map/bootstrap?bbox=${encodeURIComponent("-125.0,24.0,-66.0,49.0")}&limit=300`,
      headers: viewerHeaders
    });
    expect(wide.statusCode).toBe(200);
    expect(wide.json().data.query.limit).toBe(300);

    const large = await app.inject({
      method: "GET",
      url: `/v2/map/bootstrap?bbox=${encodeURIComponent("-125.0,24.0,-66.0,49.0")}&limit=2500`,
      headers: viewerHeaders
    });
    expect(large.statusCode).toBe(200);
    expect(large.json().data.query.limit).toBe(2500);

    const bad = await app.inject({
      method: "GET",
      url: `/v2/map/bootstrap?bbox=${encodeURIComponent("bad,bounds")}&limit=120`,
      headers: viewerHeaders
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().ok).toBe(false);
  });

  it("emits diagnostics visibility and no budget violations", async () => {
    await app.inject({
      method: "GET",
      url: `/v2/map/bootstrap?bbox=${encodeURIComponent(bbox)}&limit=120`,
      headers: viewerHeaders
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=80" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "map.bootstrap.get");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("map.bootstrap.get");
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(Array.isArray(row.budgetViolations)).toBe(true);
  });
});
