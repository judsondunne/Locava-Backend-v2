import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 users last-active route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("returns lastActiveMs (nullable) and route metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/users/some-user-id/last-active",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.userId).toBe("some-user-id");
    expect(body.routeName).toBe("users.lastactive.get");
    expect(body.lastActiveMs === null || typeof body.lastActiveMs === "number").toBe(true);
  });

  it("collapses repeated identical request via cache", async () => {
    const url = "/v2/users/some-user-id/last-active";
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=60" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "users.lastactive.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].dbOps.queries).toBe(0);
    expect(rows[0].dbOps.reads).toBe(0);
  });
});

