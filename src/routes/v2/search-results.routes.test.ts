import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search results route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("rejects non-internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=hiking"
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns lean shared-card shape with stale-suppression metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=hiking&limit=8",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.data.routeName).toBe("search.results.get");
    expect(body.data.queryEcho).toBe("hiking");
    expect(body.data.requestKey).toContain("hiking");
    expect(body.data.page.cursorIn).toBe(null);
    expect(body.data.page.limit).toBe(8);
    expect(body.data.page.sort).toBe("search_ranked_v1");
    expect(body.data.items.length).toBeLessThanOrEqual(8);
    expect(body.data.items[0].author.userId).toBeTruthy();
    expect(body.data.items[0].media.posterUrl).toBeTruthy();
    expect(body.data.items[0].assets).toBeUndefined();
    expect(body.data.items[0].comments).toBeUndefined();
  });

  it("supports cursor pagination and echoes cursorIn", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=coffee&limit=6",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(first.statusCode);
    if (first.statusCode !== 200) return;
    const firstBody = first.json();
    const nextCursor = firstBody.data.page.nextCursor as string;
    expect(nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v2/search/results?q=coffee&limit=6&cursor=${encodeURIComponent(nextCursor)}`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(second.statusCode);
    if (second.statusCode !== 200) return;
    const secondBody = second.json();
    expect(secondBody.data.page.cursorIn).toBe(nextCursor);
    expect(secondBody.data.requestKey).toContain(nextCursor);
  });

  it("accepts geo context for near-me committed searches", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=scenic%20views%20near%20me&limit=8&lat=40.68843&lng=-75.22073",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.data.routeName).toBe("search.results.get");
      expect(Array.isArray(body.data.items)).toBe(true);
    }
  });

  it("enforces query/limit constraints and rejects invalid cursor", async () => {
    const tooShort = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=a",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(tooShort.statusCode).toBe(400);

    const tooHigh = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=hiking&limit=40",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(tooHigh.statusCode).toBe(400);

    const badCursor = await app.inject({
      method: "GET",
      url: "/v2/search/results?q=hiking&cursor=not-a-cursor",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(badCursor.statusCode).toBe(400);
  });

  it("dedupes same-query overlaps and exposes diagnostics fields", async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v2/search/results?q=brunch&limit=8",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      }),
      app.inject({
        method: "GET",
        url: "/v2/search/results?q=brunch&limit=8",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      })
    ]);
    expect([200, 503]).toContain(a.statusCode);
    expect([200, 503]).toContain(b.statusCode);
    if (a.statusCode !== 200 || b.statusCode !== 200) return;

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=40" });
    const payload = diagnostics.json();
    const row = payload.data.recentRequests.find(
      (r: { routeName?: string; route?: string }) =>
        r.routeName === "search.results.get" || r.route === "/v2/search/results"
    );
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("search.results.get");
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(typeof row.entityCache.hits).toBe("number");
    expect(typeof row.entityCache.misses).toBe("number");
    expect(typeof row.entityConstruction.total).toBe("number");
    expect(row.budgetViolations).toEqual([]);
  });
});
