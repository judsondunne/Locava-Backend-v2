import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

const HEAVY_USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

describe("v2 profile bootstrap route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("allows non-internal viewer for profile bootstrap", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap`,
      headers: { "x-viewer-id": "viewer-1" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("returns lean profile bootstrap for heavy user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap?gridLimit=12`,
      headers: {
        "x-viewer-id": "viewer-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.routeName).toBe("profile.bootstrap.get");
    expect(body.data.firstRender.counts.posts).toBeGreaterThanOrEqual(0);
    expect(body.data.firstRender.gridPreview.items.length).toBeLessThanOrEqual(12);
    expect(body.data.firstRender.gridPreview.nextCursor).not.toBeNull();
  });

  it("collapses repeated identical bootstrap to warm near-zero db ops", async () => {
    const url = `/v2/profiles/${HEAVY_USER_ID}/bootstrap?gridLimit=12`;
    const headers = {
      "x-viewer-id": "viewer-warm",
      "x-viewer-roles": "internal"
    };
    const first = await app.inject({ method: "GET", url, headers });
    const second = await app.inject({ method: "GET", url, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().meta.db.reads).toBe(0);
    expect(second.json().meta.db.queries).toBe(0);
  });

  it("returns base payload when deferred debug hint is set but no deferred enrichment is pending", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap?debugSlowDeferredMs=300`,
      headers: {
        "x-viewer-id": "viewer-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(false);
    expect(body.data.fallbacks).toEqual([]);
    expect(Array.isArray(body.data.firstRender.gridPreview.items)).toBe(true);
  });

  it("shows observability fields in diagnostics", async () => {
    await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap`,
      headers: {
        "x-viewer-id": "viewer-2",
        "x-viewer-roles": "internal"
      }
    });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=10" });
    expect(diagnostics.statusCode).toBe(200);
    const body = diagnostics.json();
    const profileEntry = body.data.recentRequests.find((row: { routeName?: string }) => row.routeName === "profile.bootstrap.get");

    expect(profileEntry).toBeTruthy();
    expect(profileEntry.dbOps.reads).toBeGreaterThan(0);
    expect(typeof profileEntry.cache.hits).toBe("number");
    expect(Array.isArray(profileEntry.fallbacks)).toBe(true);
  });
});
