import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

const HEAVY_USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

describe("v2 profile grid route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("allows anonymous viewer for profile grid (surface not internal-gated)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid`
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns first page with default limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid`,
      headers: {
        "x-viewer-id": "internal-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("profile.grid.get");
    expect(body.data.page.limit).toBe(12);
    expect(body.data.items.length).toBeLessThanOrEqual(12);
    expect(body.data.items[0].postId).toContain(HEAVY_USER_ID);
  });

  it("paginates with cursor", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid?limit=8`,
      headers: {
        "x-viewer-id": "internal-2",
        "x-viewer-roles": "internal"
      }
    });

    const firstBody = first.json();
    const cursor = firstBody.data.page.nextCursor as string;
    expect(cursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid?limit=8&cursor=${encodeURIComponent(cursor)}`,
      headers: {
        "x-viewer-id": "internal-2",
        "x-viewer-roles": "internal"
      }
    });

    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.data.items[0].postId).not.toBe(firstBody.data.items[0].postId);
  });

  it("enforces max limit and validates invalid limit", async () => {
    const bounded = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid?limit=24`,
      headers: {
        "x-viewer-id": "internal-3",
        "x-viewer-roles": "internal"
      }
    });
    expect(bounded.statusCode).toBe(200);
    expect(bounded.json().data.items.length).toBeLessThanOrEqual(24);

    const invalid = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid?limit=999`,
      headers: {
        "x-viewer-id": "internal-3",
        "x-viewer-roles": "internal"
      }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("falls back on invalid cursor and logs diagnostics", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/grid?cursor=bad-cursor`,
      headers: {
        "x-viewer-id": "internal-4",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(true);
    expect(body.data.fallbacks).toContain("invalid_cursor_fallback_to_start");

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=10" });
    const diag = diagnostics.json();
    const routeEntry = diag.data.recentRequests.find((r: { routeName?: string }) => r.routeName === "profile.grid.get");
    expect(routeEntry).toBeTruthy();
    expect(routeEntry.dbOps.reads).toBeGreaterThan(0);
    expect(typeof routeEntry.cache.hits).toBe("number");
  });
});
